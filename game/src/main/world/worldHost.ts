/**
 * Authoritative world host: owns the open campaign, its generated-module registry
 * and the running battle. Runs inside a worker thread in the app (so a runaway
 * generated module can be killed by the watchdog) and in-process in unit tests.
 */
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BattleCtx, applyBattleCommand, createBattle, describeSelection, forecastAttack, hashBattle, threatCells,
  type Forecast, type SelectionInfo,
} from '../../engine/battle';
import {
  addFacts, applyBattleResult, applyWorldOps, campaignDigest, campaignTransaction, installNewModules, newCampaign, runCampaignCommand,
  type CampaignTxn,
} from '../../engine/campaign';
import { ModuleFault, createRegistry, isFaulted, moduleSummaries, type Registry } from '../../engine/registry';
import { mix32 } from '../../engine/rng';
import type {
  BattleCommand, BattleRecord, BattleSnapshot2, BattleState, CampaignState, CampaignSummary, ChatMessage, Coord, Loose, ModuleFaultInfo,
  ModuleRecord, WorldEvent, WorldOp, WorldView,
} from '../../engine/types';
import { CampaignStore, HISTORY_LIMIT } from './campaignStore';
import { ModuleLoader } from './moduleLoader';

export type { BattleSnapshot2, WorldEvent, WorldView } from '../../engine/types';
export interface HostOptions { dbPath: string; workspacesDir: string; contentDir?: string; aiDelayMs?: number; trace?: (label: string | null) => void }

const CHAT_WINDOW = 300;

export function resolveContentDir(): string {
  const base = typeof __dirname === 'string' ? __dirname : process.cwd();
  const candidates = [path.resolve(base, '../content'), path.resolve(base, '../../content'), path.resolve(process.cwd(), 'dist/content'), path.resolve(process.cwd(), 'src/content')];
  return candidates.find((dir) => existsSync(path.join(dir, 'EXTENSION_API.md'))) ?? candidates[candidates.length - 1]!;
}

interface ActiveBattle { state: BattleState; spent: number; history: BattleState[]; base: number }

export class WorldHost {
  private readonly store: CampaignStore;
  private readonly workspacesDir: string;
  private readonly contentDir: string;
  private readonly aiDelayMs: number;
  private readonly trace: ((label: string | null) => void) | undefined;
  private readonly listeners = new Set<(event: WorldEvent) => void>();
  private campaign: CampaignState | null = null;
  private reg: Registry = createRegistry();
  private loader: ModuleLoader | null = null;
  private battle: ActiveBattle | null = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;

  constructor(options: HostOptions) {
    this.store = new CampaignStore(options.dbPath);
    this.workspacesDir = path.resolve(options.workspacesDir);
    this.contentDir = options.contentDir ?? resolveContentDir();
    this.aiDelayMs = options.aiDelayMs ?? 80;
    this.trace = options.trace;
    mkdirSync(this.workspacesDir, { recursive: true });
  }

  subscribe(listener: (event: WorldEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: WorldEvent): void { for (const listener of this.listeners) listener(event); }
  private emitView(): void { this.emit({ type: 'view', view: this.view() }); }
  private reportFaults(faults: ModuleFaultInfo[]): void { if (faults.length) this.emit({ type: 'faults', faults }); }

  // ------------------------------------------------------------ campaigns
  listCampaigns(): CampaignSummary[] { return this.store.listCampaigns(); }
  workspaceOf(id: string): string { return path.join(this.workspacesDir, id); }
  get workspace(): string { return this.campaign ? this.workspaceOf(this.campaign.id) : ''; }
  private need(): CampaignState { if (!this.campaign) throw new Error('No campaign is open.'); return this.campaign; }

  private prepareWorkspace(id: string): void {
    const dir = this.workspaceOf(id);
    for (const sub of ['modules', 'battles', 'state', 'chat', 'docs', 'examples', 'notes']) mkdirSync(path.join(dir, sub), { recursive: true });
    if (!existsSync(path.join(dir, 'package.json'))) writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'chronicle-campaign-workspace', private: true, type: 'module' }, null, 2));
    try {
      if (existsSync(path.join(this.contentDir, 'EXTENSION_API.md'))) cpSync(path.join(this.contentDir, 'EXTENSION_API.md'), path.join(dir, 'docs/EXTENSION_API.md'));
      const examples = path.join(this.contentDir, 'examples');
      if (existsSync(examples)) for (const file of readdirSync(examples)) cpSync(path.join(examples, file), path.join(dir, 'examples', file));
    } catch { /* documentation copies are best-effort */ }
    writeFileSync(path.join(dir, 'README.md'), [
      '# Campaign workspace', '',
      '- `modules/*.js` — generated content modules, hot-loaded by the game (see `docs/EXTENSION_API.md`, `examples/`).',
      '- `battles/*.json` — battle specs the Narrator can start.',
      '- `state/campaign.json`, `state/modules.json` — read-only mirror of the live campaign (rewritten before every agent run).',
      '- `chat/transcript.md` — the full Narrator↔player history.',
      '- `notes/` — scratch space for agents.', '',
    ].join('\n'));
  }

  async createCampaign(setting: string): Promise<WorldView> {
    const id = `c${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const campaign = newCampaign(id, setting, Date.now());
    this.store.saveCampaign(campaign);
    return this.openCampaign(id);
  }

  async openCampaign(id: string): Promise<WorldView> {
    this.closeCampaign();
    const campaign = this.store.loadCampaign(id);
    if (!campaign) throw new Error(`Campaign '${id}' was not found.`);
    this.campaign = campaign;
    this.prepareWorkspace(id);
    this.reg = createRegistry();
    if (this.trace) this.reg.trace = this.trace;
    this.loader = new ModuleLoader(this.reg, this.workspaceOf(id), this.trace);
    for (const [file, hash, message] of this.pendingBlocks) this.loader.block(file, hash, message);
    await this.loader.sync();
    // Watchdog quarantines survive the worker restart (registration itself clears faults, so apply them after loading).
    for (const [moduleId, info] of this.pendingQuarantine) if (this.reg.modules[moduleId]) this.reg.faults[moduleId] = info;
    this.applyTxn(installNewModules(this.campaign, this.reg));
    if (campaign.activeBattleId) {
      const stored = this.store.loadBattle(campaign.activeBattleId);
      if (stored) {
        this.battle = { state: stored.state, spent: stored.spent, history: stored.history.length ? stored.history : [stored.state], base: stored.firstIndex };
        this.scheduleAi();
      } else { this.campaign.activeBattleId = null; this.commit(this.campaign); }
    }
    this.syncWorkspace();
    return this.view();
  }

  closeCampaign(): void {
    this.clearAi();
    this.campaign = null; this.battle = null; this.loader = null; this.reg = createRegistry();
  }

  deleteCampaign(id: string): void {
    if (this.campaign?.id === id) this.closeCampaign();
    this.store.deleteCampaign(id);
    const dir = this.workspaceOf(id);
    if (path.dirname(dir) === this.workspacesDir && existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }

  view(): WorldView {
    const c = this.campaign;
    const total = c ? this.store.chatCount(c.id) : 0;
    return {
      revision: ++this.revision,
      campaign: c,
      chat: c ? this.store.chatRange(c.id, Math.max(1, total - CHAT_WINDOW + 1), total) : [],
      chatTotal: total,
      modules: moduleSummaries(this.reg),
      moduleFiles: this.loader?.versions() ?? [],
      battle: this.snapshot(),
      workspace: this.workspace,
    };
  }

  private commit(next: CampaignState, notes: string[] = []): void {
    next.updatedAt = Date.now();
    this.campaign = next;
    this.store.saveCampaign(next);
    for (const note of notes) this.store.appendChat(next.id, { role: 'system', text: note, turn: next.turn, at: Date.now(), kind: 'world' });
  }
  private applyTxn(txn: CampaignTxn): { ok: boolean; error: string | null; value?: Loose } {
    this.reportFaults(txn.faults);
    if (txn.ok && (txn.campaign !== this.campaign || txn.notes.length)) this.commit(txn.campaign, txn.notes);
    return { ok: txn.ok, error: txn.error, value: txn.value };
  }

  // ------------------------------------------------------------ chat + world state
  appendChat(role: ChatMessage['role'], text: string, kind?: string): ChatMessage {
    const c = this.need();
    const message = this.store.appendChat(c.id, { role, text, turn: c.turn, at: Date.now(), ...(kind ? { kind } : {}) });
    this.emitView();
    return message;
  }
  chatCount(): number { return this.store.chatCount(this.need().id); }
  chatRange(from: number, to: number): ChatMessage[] { return this.store.chatRange(this.need().id, from, to); }

  /** Applies a batch of changes from the Narrator in one commit. */
  applyNarratorTurn(update: { ops?: WorldOp[]; facts?: string[]; scene?: Partial<CampaignState['scene']>; suggestions?: string[]; ending?: string | null; advanceTurn?: boolean }): string[] {
    const c = structuredClone(this.need());
    const notes = applyWorldOps(c, update.ops ?? []);
    if (update.scene) c.scene = { ...c.scene, ...Object.fromEntries(Object.entries(update.scene).filter(([, v]) => typeof v === 'string' && v)) };
    if (update.suggestions) c.suggestions = update.suggestions.slice(0, 5);
    if (update.advanceTurn) c.turn += 1;
    addFacts(c, update.facts ?? [], ['narrator']);
    if (update.ending) { c.status = 'ended'; c.ending = update.ending; }
    this.commit(c);
    this.emitView();
    return notes;
  }
  patchCampaign(patch: Partial<Pick<CampaignState, 'summary' | 'summarizedThrough' | 'pendingBattle' | 'title' | 'suggestions'>>, facts: string[] = []): void {
    const c = structuredClone(this.need());
    Object.assign(c, patch);
    addFacts(c, facts, ['archive']);
    this.commit(c);
    this.emitView();
  }
  digest(): string { return campaignDigest(this.need(), this.reg); }

  runCommand(name: string, args: Loose): { ok: boolean; error: string | null } {
    if (this.battle && this.battle.state.status === 'ongoing') return { ok: false, error: 'Finish the battle first.' };
    const result = this.applyTxn(runCampaignCommand(this.need(), this.reg, name, args));
    this.emitView();
    return { ok: result.ok, error: result.error };
  }

  // ------------------------------------------------------------ modules
  private readonly pendingBlocks: [string, string, string][] = [];
  private readonly pendingQuarantine: [string, ModuleFaultInfo][] = [];
  /** Called by the watchdog after it had to kill a hung worker. */
  quarantine(label: string, message: string): void {
    if (label.startsWith('load:')) {
      const [, file = '', hash = ''] = label.split(':');
      this.pendingBlocks.push([file, hash, message]);
      this.loader?.block(file, hash, message);
    } else {
      const info = { moduleId: label, where: 'watchdog', message, stack: '' };
      this.pendingQuarantine.push([label, info]);
      this.reg.faults[label] = info;
    }
  }
  async reloadModules(): Promise<{ changed: ModuleRecord[]; errors: ModuleRecord[] }> {
    this.need();
    const { changed, all } = await this.loader!.sync();
    this.applyTxn(installNewModules(this.need(), this.reg));
    this.emitView();
    return { changed, errors: all.filter((m) => m.status === 'error') };
  }
  moduleSource(file: string): string {
    const full = path.resolve(this.workspace, file);
    return full.startsWith(this.workspace) && existsSync(full) ? readFileSync(full, 'utf8') : '';
  }

  /** Mirrors live state into the workspace so agents can read it with their own tools. */
  syncWorkspace(): void {
    const c = this.campaign;
    if (!c) return;
    const dir = this.workspace;
    try {
      writeFileSync(path.join(dir, 'state/campaign.json'), JSON.stringify(c, null, 2));
      writeFileSync(path.join(dir, 'state/modules.json'), JSON.stringify(moduleSummaries(this.reg), null, 2));
      if (this.battle) writeFileSync(path.join(dir, 'state/battle.json'), JSON.stringify({ ...this.battle.state, fx: [], trace: null }, null, 2));
      const total = this.store.chatCount(c.id);
      const lines = this.store.chatRange(c.id, 1, total).map((m) => `## [${m.seq}] ${m.role === 'player' ? 'Player' : m.role === 'narrator' ? 'Narrator' : `World (${m.kind ?? 'system'})`} — turn ${m.turn}\n\n${m.text}\n`);
      writeFileSync(path.join(dir, 'chat/transcript.md'), `# Transcript — ${c.title}\n\nSetting: ${c.setting}\n\n${lines.join('\n')}`);
    } catch { /* mirror is best-effort */ }
  }

  // ------------------------------------------------------------ battles
  private snapshot(): BattleSnapshot2 | null {
    const b = this.battle;
    if (!b) return null;
    const charges = Number(b.state.rules.turnwheelCharges ?? 3);
    return { state: b.state, hash: hashBattle(b.state), rewindsLeft: Math.max(0, charges - b.spent), canRewind: b.history.length > 1 && b.spent < charges, revision: this.revision };
  }
  private isPlayerDecision(state: BattleState): boolean {
    return state.status === 'ongoing' && state.factions[state.order[state.phaseIndex] ?? '']?.controller === 'player';
  }
  private persistBattle(boundary: boolean): void {
    const b = this.battle, c = this.campaign;
    if (!b || !c) return;
    if (boundary) {
      b.history.push(b.state);
      if (b.history.length > HISTORY_LIMIT) { b.history.shift(); b.base += 1; }
    }
    this.store.saveBattle(c.id, b.state, b.spent, boundary ? b.base + b.history.length - 1 : null);
  }

  startBattle(spec: Loose): { ok: boolean; error: string | null } {
    const c = this.need();
    if (this.battle) return { ok: false, error: 'A battle is already running.' };
    const faults: ModuleFaultInfo[] = [];
    try {
      let built: Loose = spec;
      const txn = campaignTransaction(c, this.reg, (ctx) => { const ev = { spec: structuredClone(spec) }; ctx.emit('battle:build', ev); return ev.spec; });
      faults.push(...txn.faults);
      if (txn.ok && txn.value && typeof txn.value === 'object') built = txn.value;
      const seed = mix32(c.seed, c.battles.length * 7919 + c.turn) || 1;
      let state: BattleState | null = null;
      for (let attempt = 0; attempt < 12 && !state; attempt++) {
        try {
          state = createBattle(built, this.reg, { roster: c.roster, inventory: c.inventory, vars: c.vars, rules: c.rules.battle ?? {} }, { id: `b${c.battles.length + 1}-${Date.now().toString(36)}`, seed });
        } catch (error) {
          if (error instanceof ModuleFault && !isFaulted(this.reg, error.moduleId)) { this.reg.faults[error.moduleId] = error.info(); faults.push(error.info()); continue; }
          throw error;
        }
      }
      if (!state) throw new Error('Battle could not be built.');
      this.battle = { state, spent: 0, history: [], base: 0 };
      this.persistBattle(true);
      const next = structuredClone(c);
      next.activeBattleId = state.id; next.pendingBattle = null; next.scene.mood = 'battle';
      this.commit(next);
      this.store.appendChat(next.id, { role: 'system', text: `⚔ ${state.title} — ${state.objective.text.replace(/[.\s]+$/, '')}. ${state.units.length} units on a ${state.map.width}×${state.map.height} field.`, turn: next.turn, at: Date.now(), kind: 'battle-start' });
      this.reportFaults(faults);
      this.scheduleAi();
      this.emitView();
      return { ok: true, error: null };
    } catch (error) {
      this.reportFaults(faults);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  battleCommand(cmd: BattleCommand, internal = false): { ok: boolean; error: string | null; snapshot: BattleSnapshot2 | null } {
    const b = this.battle;
    if (!b) return { ok: false, error: 'No battle is running.', snapshot: null };
    if (!cmd || typeof cmd !== 'object' || (cmd.type === 'aiPhase' && !internal)) return { ok: false, error: 'Invalid command.', snapshot: this.snapshot() };
    const outcome = applyBattleCommand(b.state, cmd, this.reg);
    this.reportFaults(outcome.faults);
    if (!outcome.ok) return { ok: false, error: outcome.error, snapshot: this.snapshot() };
    b.state = outcome.state;
    this.persistBattle(true);
    this.scheduleAi();
    if (!internal) this.emitView();
    return { ok: true, error: null, snapshot: this.snapshot() };
  }

  private clearAi(): void { if (this.aiTimer) clearTimeout(this.aiTimer); this.aiTimer = null; }
  private scheduleAi(): void {
    this.clearAi();
    const b = this.battle;
    if (!b || b.state.status !== 'ongoing' || this.isPlayerDecision(b.state)) return;
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      const result = this.battleCommand({ type: 'aiPhase' }, true);
      if (!result.ok && this.battle) {
        // Never strand the player in a phase that cannot resolve.
        const draft = structuredClone(this.battle.state);
        draft.fx = []; draft.trace = null;
        try { new BattleCtx(draft, this.reg).endPhase(); }
        catch { draft.status = 'ended'; draft.outcome = 'aborted'; draft.endReason = `engine fault: ${result.error ?? 'unknown'}`; }
        draft.commandOrdinal++;
        this.battle.state = draft;
        this.persistBattle(true);
        this.scheduleAi();
      }
      this.emitView();
    }, this.aiDelayMs);
  }

  battleSelect(unitId: string): SelectionInfo | null { return this.battle ? describeSelection(this.battle.state, this.reg, unitId) : null; }
  battleForecast(attackerId: string, targetId: string, weapon?: number, from?: Coord | null): Forecast | null {
    return this.battle ? forecastAttack(this.battle.state, this.reg, attackerId, targetId, weapon, from) : null;
  }
  battleThreat(): Coord[] { return this.battle ? threatCells(this.battle.state, this.reg) : []; }
  battlePreview(unitId: string, abilityId: string, target: Loose): string {
    const b = this.battle;
    if (!b) return '';
    try {
      const ctx = new BattleCtx(structuredClone(b.state), this.reg);
      ctx.simulate = true;
      const unit = ctx.unit(unitId), def = ctx.abilityDef(abilityId);
      if (!unit || !def?.preview || isFaulted(this.reg, def.module)) return '';
      const resolved = ctx.unit(target) ?? (target && typeof target === 'object' && typeof target.x === 'number' ? ctx.unitAt(target) ?? target : target);
      return String(def.preview(ctx, unit, resolved) ?? '');
    } catch { return ''; }
  }

  battleRewind(): BattleSnapshot2 {
    const b = this.battle;
    const charges = Number(b?.state.rules.turnwheelCharges ?? 3);
    if (!b || b.spent >= charges || b.history.length < 2) throw new Error('No Turnwheel rewinds available.');
    let index = b.history.length - 2;
    while (index > 0 && !this.isPlayerDecision(b.history[index]!)) index--;
    b.history.length = index + 1;
    b.state = structuredClone(b.history[index]!);
    b.state.fx = []; b.state.trace = null;
    b.spent += 1;
    this.store.truncateHistory(b.state.id, b.base + index);
    this.persistBattle(false);
    this.scheduleAi();
    ++this.revision;
    this.emitView();
    return this.snapshot()!;
  }

  /** Folds a finished battle into the campaign and returns the record for the Narrator. */
  resolveBattle(): BattleRecord {
    const b = this.battle, c = this.need();
    if (!b) throw new Error('No battle to resolve.');
    if (b.state.status !== 'ended') throw new Error('The battle is still running.');
    this.clearAi();
    const txn = applyBattleResult(c, b.state, this.reg);
    this.reportFaults(txn.faults);
    let record: BattleRecord;
    if (txn.ok && txn.value) { record = txn.value; this.commit(txn.campaign, txn.notes); }
    else {
      const next = structuredClone(c);
      record = { id: b.state.id, title: b.state.title, turn: next.turn, outcome: b.state.outcome ?? 'ended', reason: b.state.endReason ?? '', rounds: b.state.round, summary: `${b.state.title} — ${b.state.outcome}.`, casualties: [], captured: [], loot: [] };
      next.battles.push(record); next.activeBattleId = null; next.pendingBattle = null;
      this.commit(next, [`(The battle result could not be fully applied: ${txn.error})`]);
    }
    const after = structuredClone(this.need());
    after.scene.mood = record.outcome === 'victory' ? 'story' : 'tense';
    this.commit(after);
    this.store.appendChat(c.id, { role: 'system', text: record.summary, turn: c.turn, at: Date.now(), kind: 'battle' });
    this.store.dropBattleHistory(b.state.id);
    this.battle = null;
    this.syncWorkspace();
    this.emitView();
    return record;
  }

  dispose(): void { this.clearAi(); this.listeners.clear(); this.store.close(); }
}
