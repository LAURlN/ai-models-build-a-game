/**
 * The Director runs the gameplay loop around the world host:
 *   player message → Narrator turn → world edits / helper agents / battle → aftermath.
 * Helpers run in parallel in the background while the chat continues; broken modules
 * are repaired automatically; a pending battle waits only for the content it needs.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localSummary, memoryDocs, planSummary, retrieve, RECENT_WINDOW } from '../../engine/memory';
import { slug } from '../../engine/registry';
import type { ActivityTask, BattleRecord, ChatMessage, DirectorStatus, Loose, ModuleFaultInfo, PendingBattle } from '../../engine/types';
import type { FallbackModelEntry, ProviderInfo, ProviderSettings, RoleModelSelection } from '../../shared/contracts';
import {
  ARCHIVE_SCHEMA, HELPER_SCHEMA, NARRATOR_SCHEMA, battleSpecReference, buildArchivePrompt, buildHelperPrompt, buildNarratorPrompt,
  normalizeNarratorTurn, type NarratorTurn,
} from './prompts';
import type { WorldApi } from './worldClient';
import { resolveContentDir, type WorldView } from './worldHost';

export interface SidecarLike {
  listProviders(): Promise<ProviderInfo[]>;
  gameGenerate(input: {
    attemptId: string; prompt: string; jsonSchema: unknown; modelSelection: { providerId: string; model: string; effort?: string };
    role?: string; timeoutMs?: number; agent?: { cwd: string };
  }): Promise<{ output: unknown; provider: string; model: string }>;
}

export type { DirectorStatus } from '../../engine/types';
export interface HelperRequest { title: string; kind: string; brief: string; files: string[] }
interface RepairContext { file: string; error: string; attempt: number }
interface QueuedHelper { task: ActivityTask; request: HelperRequest; repair?: RepairContext | undefined }

const MAX_REPAIRS = 2;
const TASK_LIMIT = 60;

export function storySelection(settings: ProviderSettings, role: 'narrator' | 'helper'): RoleModelSelection {
  return role === 'narrator' ? settings.narrator ?? settings.chronicler : settings.helper ?? settings.architect;
}

export class Director {
  private view: WorldView | null = null;
  private tasks: ActivityTask[] = [];
  private busy = false;
  private error: string | null = null;
  private retryAction: (() => Promise<void>) | null = null;
  private readonly queue: QueuedHelper[] = [];
  private running = 0;
  private readonly repairs = new Map<string, number>();
  /** Last brief that produced each file, so repair helpers know what the code was meant to do. */
  private readonly briefs = new Map<string, string>();
  private battleAttempts = 0;
  private archiving = false;
  private apiDoc = '';
  private readonly listeners = new Set<(status: DirectorStatus) => void>();
  private readonly idleWaiters: (() => void)[] = [];
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly world: WorldApi, private readonly sidecar: SidecarLike, private readonly settings: () => ProviderSettings, contentDir = resolveContentDir()) {
    try { this.apiDoc = readFileSync(path.join(contentDir, 'EXTENSION_API.md'), 'utf8'); } catch { this.apiDoc = 'See docs/EXTENSION_API.md in the workspace.'; }
    this.unsubscribe = world.subscribe((event) => {
      if (event.type === 'view') this.view = event.view;
      else if (event.type === 'faults') this.onFaults(event.faults);
    });
  }

  // ------------------------------------------------------------ status
  subscribe(listener: (status: DirectorStatus) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  status(): DirectorStatus { return { busy: this.busy, error: this.error, canRetry: !!this.retryAction, tasks: this.tasks.slice(-TASK_LIMIT) }; }
  private notify(): void {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
    if (this.isIdle()) while (this.idleWaiters.length) this.idleWaiters.shift()!();
  }
  private isIdle(): boolean { return !this.busy && this.running === 0 && this.queue.length === 0 && !this.archiving; }
  /** Resolves when no narrator turn, helper or archive job is in flight (used by tests and scripted flows). */
  whenIdle(): Promise<void> { return this.isIdle() ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.push(resolve)); }
  private addTask(kind: string, title: string, detail: string, status: ActivityTask['status'] = 'running'): ActivityTask {
    const task: ActivityTask = { id: randomUUID(), kind, title, detail, status, startedAt: Date.now(), finishedAt: null, files: [], model: '', error: null };
    this.tasks.push(task);
    if (this.tasks.length > TASK_LIMIT * 2) this.tasks.splice(0, this.tasks.length - TASK_LIMIT);
    this.notify();
    return task;
  }
  private finish(task: ActivityTask, status: 'done' | 'failed', patch: Partial<ActivityTask> = {}): void {
    Object.assign(task, patch, { status, finishedAt: Date.now() });
    this.notify();
  }
  private async refresh(): Promise<WorldView> { this.view = await this.world.view(); return this.view; }

  // ------------------------------------------------------------ campaign lifecycle
  async create(setting: string): Promise<WorldView> {
    this.reset();
    this.view = await this.world.createCampaign(setting);
    void this.narratorTurn('opening', '', '');
    return this.view;
  }
  async open(id: string): Promise<WorldView> {
    this.reset();
    this.view = await this.world.openCampaign(id);
    // A campaign that was closed mid-preparation picks its battle back up.
    if (this.view.campaign?.pendingBattle?.status === 'preparing') void this.checkPendingBattle();
    if (this.view.chatTotal === 0 && this.view.campaign) void this.narratorTurn('opening', '', '');
    for (const module of this.view.modules) if (module.status === 'error') this.scheduleRepair(module.file, module.error ?? 'Module failed to load.');
    return this.view;
  }
  async close(): Promise<void> { this.reset(); await this.world.closeCampaign(); this.view = null; }
  private reset(): void {
    this.queue.length = 0; this.repairs.clear(); this.briefs.clear(); this.tasks = []; this.error = null; this.retryAction = null; this.battleAttempts = 0;
    this.notify();
  }

  // ------------------------------------------------------------ model calls
  private async generate(role: 'narrator' | 'helper' | 'archivist', prompt: string, schema: unknown, options: { agent: boolean; timeoutMs: number }): Promise<{ output: unknown; model: string }> {
    const settings = this.settings();
    const primary = storySelection(settings, role === 'narrator' ? 'narrator' : 'helper');
    const seen = new Set<string>();
    const candidates = ([primary, ...(settings.fallbacks ?? [])] as (RoleModelSelection | FallbackModelEntry)[]).filter((c) => {
      const key = `${c.providerId}:${c.model}:${c.effort ?? ''}`;
      if (!c.providerId || !c.model || seen.has(key)) return false;
      seen.add(key); return true;
    });
    const providers = await this.sidecar.listProviders();
    const errors: string[] = [];
    for (const candidate of candidates) {
      const info = providers.find((p) => p.instanceId === candidate.providerId);
      if (!info || !info.installed || info.authStatus !== 'authenticated') {
        errors.push(`${candidate.providerId}/${candidate.model}: ${info?.message ?? 'provider not installed or not signed in'}`);
        continue;
      }
      try {
        const workspace = this.view?.workspace;
        const result = await this.sidecar.gameGenerate({
          attemptId: `${role}-${randomUUID()}`, prompt, jsonSchema: schema, role, timeoutMs: options.timeoutMs,
          modelSelection: { providerId: candidate.providerId, model: candidate.model, ...(candidate.effort ? { effort: candidate.effort } : {}) },
          ...(options.agent && workspace ? { agent: { cwd: workspace } } : {}),
        });
        return { output: result.output, model: `${result.provider} · ${result.model}${candidate.effort ? ` (${candidate.effort})` : ''}` };
      } catch (error) {
        errors.push(`${candidate.providerId}/${candidate.model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(errors.join(' | ') || 'No provider models are configured. Open Providers & Models.');
  }

  // ------------------------------------------------------------ narrator
  /** The player speaks. Stores the message at once; the Narrator answers asynchronously. */
  async say(text: string): Promise<void> {
    const message = text.trim();
    if (!message) return;
    const view = this.view ?? await this.refresh();
    if (!view.campaign) throw new Error('No campaign is open.');
    if (view.battle) throw new Error('Finish the battle first.');
    if (this.busy) throw new Error('The Narrator is still answering.');
    await this.world.appendChat('player', message);
    void this.narratorTurn('player', message, '');
  }
  async retry(): Promise<void> {
    const action = this.retryAction;
    if (!action || this.busy) return;
    this.retryAction = null; this.error = null;
    void action();
  }
  /** Leaves a finished battle: applies its result and lets the Narrator tell the aftermath. */
  async resolveBattle(): Promise<BattleRecord> {
    const record = await this.world.resolveBattle();
    void this.narratorTurn('battle_result', '', record.summary);
    return record;
  }

  private async narratorTurn(kind: 'opening' | 'player' | 'battle_result', playerMessage: string, battleResult: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = null; this.retryAction = null;
    const task = this.addTask('narrator', kind === 'opening' ? 'Narrator opens the story' : kind === 'battle_result' ? 'Narrator tells the aftermath' : 'Narrator is answering', '');
    try {
      await this.world.syncWorkspace();
      const view = await this.refresh();
      const campaign = view.campaign;
      if (!campaign) throw new Error('No campaign is open.');
      const digest = await this.world.digest();
      const recent = view.chat.slice(-RECENT_WINDOW);
      const oldestRecent = recent[0]?.seq ?? 1;
      const older = oldestRecent > 1 ? await this.world.chatRange(Math.max(1, oldestRecent - 400), oldestRecent - 1) : [];
      const query = [playerMessage, battleResult, campaign.scene.summary, campaign.scene.location].join(' ');
      const memories = retrieve(query, memoryDocs(campaign, older), 8, campaign.turn).map((d) => d.text);
      const prompt = buildNarratorPrompt({
        kind, setting: campaign.setting, digest, specReference: battleSpecReference(this.apiDoc), memories, recent,
        playerMessage, battleResult, moduleIds: view.modules.filter((m) => m.status !== 'error').map((m) => m.id), battlesFought: campaign.battles.length,
        activeHelpers: this.activeHelperTitles(),
      });
      const { output, model } = await this.generate('narrator', prompt, NARRATOR_SCHEMA, { agent: true, timeoutMs: 6 * 60_000 });
      if (this.disposed || this.view?.campaign?.id !== campaign.id) return;
      const turn = normalizeNarratorTurn(output);
      await this.world.appendChat('narrator', turn.narration);
      const notes = await this.world.applyNarratorTurn({ ops: turn.worldOps, facts: turn.memory, scene: turn.scene, suggestions: turn.suggestions, ending: turn.ending || null, advanceTurn: true });
      for (const command of turn.commands) {
        const result = await this.world.runCommand(command.name, command.args);
        if (!result.ok) notes.push(`Command ${command.name} failed: ${result.error}`);
      }
      for (const helper of turn.helpers) this.spawnHelper(helper);
      if (turn.battle.start) await this.prepareBattle(turn);
      this.finish(task, 'done', { model, detail: notes.length ? notes.join(' ') : `${turn.worldOps.length} world edits, ${turn.helpers.length} helper(s)${turn.battle.start ? ', battle' : ''}` });
      void this.maybeArchive();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.retryAction = () => this.narratorTurn(kind, playerMessage, battleResult);
      this.finish(task, 'failed', { error: this.error });
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  // ------------------------------------------------------------ helpers
  private activeHelperTitles(): string[] {
    return this.tasks.filter((t) => ['helper', 'repair'].includes(t.kind) && (t.status === 'running' || t.status === 'queued')).map((t) => t.title);
  }
  private helpersActive(): boolean { return this.running > 0 || this.queue.length > 0; }

  /** Queues a background helper agent. Returns its activity id. */
  spawnHelper(request: HelperRequest, repair?: RepairContext): string {
    const files = request.files.length ? request.files : [`modules/${slug(request.title, 'content')}.js`];
    if (!repair) for (const file of files) this.briefs.set(file, request.brief);
    const task = this.addTask(repair ? 'repair' : 'helper', request.title, request.brief.replace(/\s+/g, ' ').slice(0, 220), 'queued');
    this.queue.push({ task, request: { ...request, files }, repair });
    this.pump();
    return task.id;
  }
  private pump(): void {
    const limit = Math.max(1, Math.min(8, this.settings().helperConcurrency ?? 3));
    while (this.running < limit && this.queue.length) {
      const next = this.queue.shift()!;
      this.running++;
      void this.runHelper(next).finally(() => { this.running--; this.pump(); this.notify(); void this.checkPendingBattle(); });
    }
  }
  private async runHelper({ task, request, repair }: QueuedHelper): Promise<void> {
    task.status = 'running'; task.startedAt = Date.now();
    this.notify();
    const campaignId = this.view?.campaign?.id;
    try {
      await this.world.syncWorkspace();
      const view = await this.refresh();
      const digest = await this.world.digest();
      const source = repair ? await this.world.moduleSource(repair.file) : '';
      const prompt = buildHelperPrompt({ title: request.title, kind: request.kind, brief: request.brief, files: request.files, apiDoc: this.apiDoc, digest, recent: view.chat.slice(-8), repair: repair ? { ...repair, source } : undefined });
      const { output, model } = await this.generate('helper', prompt, HELPER_SCHEMA, { agent: true, timeoutMs: 12 * 60_000 });
      if (this.disposed || this.view?.campaign?.id !== campaignId) return;
      const result = (output && typeof output === 'object' ? output : {}) as Record<string, Loose>;
      const files = Array.isArray(result.files) ? result.files.map(String) : request.files;
      const { errors } = await this.world.reloadModules();
      const broken = errors.filter((m) => request.files.includes(m.file) || files.includes(m.file));
      const summary = typeof result.summary === 'string' && result.summary ? result.summary : `Finished ${request.title}.`;
      this.finish(task, broken.length ? 'failed' : 'done', { model, files, detail: summary, error: broken.length ? broken.map((m) => `${m.file}: ${(m.error ?? '').split('\n')[0]}`).join(' | ') : null });
      if (!broken.length) await this.world.appendChat('system', `✦ ${repair ? 'Repaired' : 'Built'}: ${request.title} — ${summary}${typeof result.notes === 'string' && result.notes ? ` (${result.notes.slice(0, 400)})` : ''}`, 'helper');
      for (const module of errors) this.scheduleRepair(module.file, module.error ?? 'Module failed to load.');
    } catch (error) {
      this.finish(task, 'failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // ------------------------------------------------------------ automatic repair
  private scheduleRepair(file: string, error: string): void {
    if (!file) return;
    if (this.queue.some((q) => q.repair?.file === file)) return;
    if (this.tasks.some((t) => t.kind === 'repair' && (t.status === 'running' || t.status === 'queued') && t.title.includes(file))) return;
    const attempt = (this.repairs.get(file) ?? 0) + 1;
    if (attempt > MAX_REPAIRS) {
      if (attempt === MAX_REPAIRS + 1) {
        this.repairs.set(file, attempt);
        void this.world.appendChat('system', `⚠ ${file} is still failing after ${MAX_REPAIRS} repair attempts and stays disabled: ${error.split('\n')[0]}`, 'error').catch(() => {});
      }
      return;
    }
    this.repairs.set(file, attempt);
    const original = this.briefs.get(file);
    this.spawnHelper({ title: `Repair ${file}`, kind: 'fix', brief: `Repair ${file}. The game reported:\n${error}${original ? `\n\nThe file was originally written for this brief:\n${original}` : ''}`, files: [file] }, { file, error, attempt });
  }
  private onFaults(faults: ModuleFaultInfo[]): void {
    for (const fault of faults) {
      const module = this.view?.modules.find((m) => m.id === fault.moduleId);
      const file = module?.file ?? `modules/${fault.moduleId}.js`;
      void this.world.appendChat('system', `⚠ ${module?.name ?? fault.moduleId} hit an error (${fault.where}: ${fault.message}). It is switched off while a helper repairs it; play continues.`, 'error').catch(() => {});
      this.scheduleRepair(file, `${fault.where}: ${fault.message}\n${fault.stack}`);
    }
  }

  // ------------------------------------------------------------ battles
  private async prepareBattle(turn: NarratorTurn): Promise<void> {
    const view = this.view;
    if (!view?.campaign) return;
    const b = turn.battle;
    let specFile = b.specFile || `battles/${slug(b.title, 'battle')}.json`;
    if (path.isAbsolute(specFile) || specFile.includes('..')) specFile = `battles/${slug(b.title, 'battle')}.json`;
    const full = path.join(view.workspace, specFile);
    let brief = b.buildBrief;
    let inline = false;
    if (b.specJson) {
      try {
        const parsed = JSON.parse(b.specJson);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, JSON.stringify({ title: b.title, intro: b.intro, ...parsed }, null, 2));
        inline = true;
      } catch (error) {
        brief = `${brief}\nThe Narrator's inline spec was not valid JSON (${error instanceof Error ? error.message : error}). Write a valid spec to ${specFile} that realises it:\n${b.specJson.slice(0, 6000)}`.trim();
      }
    }
    if (brief && !inline) {
      this.spawnHelper({ title: `Battle: ${b.title}`, kind: 'battle', brief: `Write the battle spec JSON file ${specFile} for "${b.title}". ${b.intro}\n${brief}`, files: [specFile] });
    }
    this.battleAttempts = 0;
    const pending: PendingBattle = { title: b.title, intro: b.intro, specFile, specJson: null, status: 'preparing', waitingOn: this.activeHelperTitles(), error: null };
    await this.world.patchCampaign({ pendingBattle: pending });
    await this.checkPendingBattle();
  }

  private checking = false;
  private async checkPendingBattle(): Promise<void> {
    if (this.checking || this.disposed) return;
    this.checking = true;
    try {
      const view = await this.refresh();
      const pending = view.campaign?.pendingBattle;
      if (!pending || pending.status !== 'preparing' || view.battle) return;
      if (this.helpersActive()) {
        const waitingOn = this.activeHelperTitles();
        if (waitingOn.join('|') !== pending.waitingOn.join('|')) await this.world.patchCampaign({ pendingBattle: { ...pending, waitingOn } });
        return;
      }
      const file = path.join(view.workspace, pending.specFile ?? '');
      const task = this.addTask('battle', `Staging: ${pending.title}`, pending.specFile ?? '');
      let failure: string | null = null;
      try {
        if (!pending.specFile || !existsSync(file)) throw new Error(`Battle spec ${pending.specFile} was not written.`);
        await this.world.reloadModules();
        const spec = JSON.parse(readFileSync(file, 'utf8'));
        const result = await this.world.startBattle({ title: pending.title, intro: pending.intro, ...spec });
        if (!result.ok) throw new Error(result.error ?? 'The battle could not be built.');
        this.finish(task, 'done', { detail: 'Battle is ready.' });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        this.finish(task, 'failed', { error: failure });
      }
      if (failure) {
        if (++this.battleAttempts <= MAX_REPAIRS) {
          this.spawnHelper({ title: `Repair battle: ${pending.title}`, kind: 'battle', brief: `The battle spec ${pending.specFile} for "${pending.title}" could not be started: ${failure}\nRewrite ${pending.specFile} as a valid spec (see the battle spec reference). ${pending.intro}`, files: [pending.specFile ?? `battles/${slug(pending.title)}.json`] });
        } else {
          await this.world.patchCampaign({ pendingBattle: { ...pending, status: 'failed', waitingOn: [], error: failure } });
          await this.world.appendChat('system', `⚠ The battle "${pending.title}" could not be staged: ${failure}. Keep playing — the Narrator can try again.`, 'error');
        }
      }
    } catch { /* the next helper completion re-checks */ } finally { this.checking = false; }
  }

  // ------------------------------------------------------------ long-campaign memory
  private async maybeArchive(): Promise<void> {
    const campaign = this.view?.campaign;
    if (!campaign || this.archiving) return;
    const plan = planSummary(campaign.summarizedThrough, this.view!.chatTotal);
    if (!plan) return;
    this.archiving = true;
    const task = this.addTask('archivist', 'Archivist condenses earlier scenes', `messages ${plan.from}–${plan.to}`);
    try {
      const chunk: ChatMessage[] = await this.world.chatRange(plan.from, plan.to);
      let summary: string, facts: string[] = [], model = 'local';
      try {
        const result = await this.generate('archivist', buildArchivePrompt(campaign.summary, chunk), ARCHIVE_SCHEMA, { agent: false, timeoutMs: 3 * 60_000 });
        const output = (result.output && typeof result.output === 'object' ? result.output : {}) as Record<string, Loose>;
        if (typeof output.summary !== 'string' || !output.summary.trim()) throw new Error('empty summary');
        summary = output.summary.trim(); facts = Array.isArray(output.facts) ? output.facts.map(String).slice(0, 8) : []; model = result.model;
      } catch { summary = localSummary(campaign.summary, chunk); }
      if (this.view?.campaign?.id === campaign.id) await this.world.patchCampaign({ summary, summarizedThrough: plan.to }, facts);
      this.finish(task, 'done', { model, detail: `Folded messages ${plan.from}–${plan.to} into the running summary.` });
    } catch (error) {
      this.finish(task, 'failed', { error: error instanceof Error ? error.message : String(error) });
    } finally { this.archiving = false; this.notify(); }
  }

  dispose(): void { this.disposed = true; this.unsubscribe(); this.listeners.clear(); this.queue.length = 0; }
}
