import { randomUUID } from 'node:crypto';
import {
  CHAPTER_BUILD_JSON_SCHEMA,
  CHAPTER_PLAN_JSON_SCHEMA,
  buildBattleStateFromChapter,
  buildLocalFallbackChapter,
  validateChapterBuild,
  validateChapterPlan,
} from '../rules/campaign';
import type {
  ChapterPlan,
  FallbackModelEntry,
  GeneratedChapterPreview,
  GenerationProgressEvent,
  GenerationRole,
  ProviderInfo,
  RoleModelSelection,
} from '../shared/contracts';
import type { SaveStore } from './saveStore';
import type { T3SidecarManager } from './t3Sidecar';

const RULE_IR_PROMPT_GUIDE = `
Rule IR v1 DSL specification:
- Each RuleDefinition has:
  schemaVersion: 1
  id: lowercase identifier (e.g. "frost_step" or "frost_debt")
  rulesVersion: "r03-1"
  provenanceJobId: "draft"
  name: human-readable short title
  kind: "active" | "status"
  costs: { hp: integer >= 0, actions: integer >= 0 } (for active abilities, typically hp: 2..5, actions: 0)
  useKey: same string as id for active, "" for status
  usesPerPhase: 1 for active, 0 for status
  stackPolicy: "add"
  activationPolicy: "normal"
  listeners: array of { hook, scope, priority, maxPerRoot, maxPerPhase, effect }
- Allowed hook -> scope pairs:
  - "useActive" -> "ownerActor"
  - "kill" -> "ownerActor"
  - "statusExpiry" -> "ownedStatus"
  - "afterHeal" -> "ownerTarget"
  - "afterDamage" -> "ownerTarget"
- priority: 0, maxPerRoot: 1, maxPerPhase: 32
- Allowed effect ops:
  - { op: "sequence", effects: [...] }
  - { op: "grantAction", amount: 1, key: "<useKey>", kind: "any" }
  - { op: "applyStatus", statusId: "<status_def_id>", stacks: 1, expiry: "nextOwnPhaseStart" }
  - { op: "removeStatus", statusId: "<status_def_id>" }
  - { op: "heal", amount: <ruleExpr> }
  - { op: "dealDamage", amount: <ruleExpr> }
  - { op: "adjustCounter", key: "<name>", amount: <ruleExpr> }
- Allowed ruleExpr:
  - integer literal (e.g. 5)
  - { read: "stackCount" }
  - { read: "counter", key: "<name>" }
  - { op: "add" | "multiply" | "floorDivide", left: <ruleExpr>, right: <ruleExpr> }
- Every referenced statusId MUST exist as a kind: "status" RuleDefinition in rulePack.
- Trigger graph across hooks must be acyclic (no statusExpiry -> dealDamage -> kill -> dealDamage loops).
`.trim();

function buildPlanPrompt(premise: string): string {
  return [
    'You are the Campaign Architect for Chronicle Tactics, a turn-based tactical grid RPG.',
    'Design a compact, thematic tactical chapter plan from the player premise below.',
    'Choose one of the 4 map archetypes: bridge_assault, fortress_siege, forest_ambush, twin_path_escort.',
    'Choose objective: "rout" (defeat all enemies) or "seize" (reach the seize tile).',
    'Include 5 to 8 units total (2 to 4 faction="player", 2 to 4 faction="enemy"), with balanced stats and at least 1 player unit having grantActiveAbility=true.',
    '',
    `Premise: ${premise}`,
  ].join('\n');
}

function buildBuildPrompt(premise: string, plan: ChapterPlan): string {
  return [
    'You are the Chapter Chronicler & Rulesmith for Chronicle Tactics.',
    'Generate the signature Rule IR ability + optional status definition and opening chronicle line for the planned chapter.',
    'Keep it concise, crisp, and strictly compliant with the Rule IR v1 DSL below.',
    '',
    RULE_IR_PROMPT_GUIDE,
    '',
    `Premise: ${premise}`,
    `Planned Chapter: ${JSON.stringify(plan)}`,
  ].join('\n');
}

function buildRepairPrompt(
  premise: string,
  plan: ChapterPlan,
  brokenBuild: unknown,
  validationErrors: string[],
): string {
  return [
    'REPAIR_ATTEMPT: Your previous ChapterBuild JSON failed deterministic Rule IR compilation/validation.',
    'Fix ONLY the validation errors listed below while preserving the chapter theme.',
    '',
    'Validation errors:',
    ...validationErrors.map((e) => `- ${e}`),
    '',
    RULE_IR_PROMPT_GUIDE,
    '',
    `Premise: ${premise}`,
    `Planned Chapter: ${JSON.stringify(plan)}`,
    `Previous Invalid JSON: ${JSON.stringify(brokenBuild)}`,
  ].join('\n');
}

export class GenerationCoordinator {
  private currentAttemptId: string | null = null;
  private currentEpoch = 0;
  private latestStatus: GenerationProgressEvent = {
    attemptId: '',
    epoch: 0,
    stage: 'idle',
    message: 'Ready to forge a new chapter.',
  };
  private readonly cancelledAttempts = new Set<string>();
  private readonly listeners = new Set<(event: GenerationProgressEvent) => void>();

  constructor(
    private readonly sidecar: T3SidecarManager,
    private readonly store: SaveStore,
  ) {}

  subscribe(listener: (event: GenerationProgressEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): GenerationProgressEvent {
    const latestPublished = this.store.getLatestPublishedGeneration();
    if (this.latestStatus.stage === 'idle' && latestPublished) {
      return {
        attemptId: latestPublished.attemptId,
        epoch: latestPublished.epoch,
        stage: latestPublished.source === 'local_fallback' ? 'fallback' : 'completed',
        message: `Loaded last chapter: ${latestPublished.title}`,
        preview: latestPublished,
      };
    }
    return this.latestStatus;
  }

  private emit(event: GenerationProgressEvent): void {
    this.latestStatus = event;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  startGeneration(rawPremise: string): { attemptId: string; epoch: number } {
    const premise = rawPremise.trim() || 'Hold the ashen crossing against the vanguard.';
    const prevAttempt = this.currentAttemptId;
    if (prevAttempt) {
      this.cancelledAttempts.add(prevAttempt);
      void this.sidecar.gameCancel(prevAttempt).catch(() => {});
    }

    const attemptId = randomUUID();
    const jobId = `job_${attemptId}`;
    const epoch = this.store.beginGenerationAttempt(jobId, attemptId, 'chapter', premise);

    this.currentAttemptId = attemptId;
    this.currentEpoch = epoch;
    this.emit({
      attemptId,
      epoch,
      stage: 'planning',
      message: 'Architect is drafting the chapter layout & roster...',
    });

    void this.runPipeline(jobId, attemptId, epoch, premise);
    return { attemptId, epoch };
  }

  async cancelGeneration(attemptId: string): Promise<{ cancelled: boolean }> {
    this.cancelledAttempts.add(attemptId);
    const dbCancelled = this.store.markGenerationCancelled(attemptId);
    const sidecarRes = await this.sidecar.gameCancel(attemptId).catch(() => ({ cancelled: false }));
    if (this.currentAttemptId === attemptId) {
      this.emit({
        attemptId,
        epoch: this.currentEpoch,
        stage: 'cancelled',
        message: 'Chapter generation cancelled.',
      });
    }
    return { cancelled: dbCancelled || sidecarRes.cancelled };
  }

  private isAborted(attemptId: string, epoch: number): boolean {
    return (
      this.cancelledAttempts.has(attemptId) ||
      this.currentAttemptId !== attemptId ||
      this.currentEpoch !== epoch
    );
  }

  private async tryCandidates(
    role: GenerationRole,
    attemptId: string,
    epoch: number,
    prompt: string,
    jsonSchema: unknown,
  ): Promise<
    | { ok: true; output: unknown; provider: string; model: string }
    | { ok: false; cancelled: boolean; reason: string }
  > {
    const settings = this.store.getProviderSettings();
    const primary: RoleModelSelection = role === 'architect' ? settings.architect : settings.chronicler;
    const rawCandidates: Array<RoleModelSelection | FallbackModelEntry> = [
      primary,
      ...(settings.fallbacks ?? []),
    ];

    const seen = new Set<string>();
    const candidates = rawCandidates.filter((c) => {
      if (!c.providerId || !c.model) return false;
      const key = `${c.providerId}:${c.model}:${c.effort ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (candidates.length === 0) {
      return { ok: false, cancelled: false, reason: 'No provider models configured.' };
    }

    let providers: ProviderInfo[] = [];
    try {
      providers = await this.sidecar.listProviders();
    } catch (err) {
      return {
        ok: false,
        cancelled: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (this.isAborted(attemptId, epoch)) {
      return { ok: false, cancelled: true, reason: 'Cancelled' };
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      if (this.isAborted(attemptId, epoch)) {
        return { ok: false, cancelled: true, reason: 'Cancelled' };
      }

      const providerInfo = providers.find((p) => p.instanceId === candidate.providerId);
      if (!providerInfo || !providerInfo.installed || providerInfo.authStatus !== 'authenticated') {
        errors.push(
          `${candidate.providerId}/${candidate.model}: ${
            providerInfo?.message ?? 'provider not installed or unauthenticated'
          }`,
        );
        continue;
      }

      const modelInfo = providerInfo.models.find((m) => m.slug === candidate.model);
      if (modelInfo && !modelInfo.selectable) {
        errors.push(
          `${candidate.providerId}/${candidate.model}: ${modelInfo.disabledReason ?? 'model not selectable'}`,
        );
        continue;
      }

      try {
        const res = await this.sidecar.gameGenerate({
          attemptId,
          prompt,
          jsonSchema,
          modelSelection: candidate,
          role,
        });
        if (this.isAborted(attemptId, epoch)) {
          return { ok: false, cancelled: true, reason: 'Cancelled' };
        }
        return { ok: true, output: res.output, provider: res.provider, model: res.model };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('cancelled')) {
          return { ok: false, cancelled: true, reason: msg };
        }
        errors.push(`${candidate.providerId}/${candidate.model}: ${msg}`);
      }
    }

    return {
      ok: false,
      cancelled: false,
      reason: errors.join(' | ') || 'All configured providers failed.',
    };
  }

  private async runPipeline(
    jobId: string,
    attemptId: string,
    epoch: number,
    premise: string,
  ): Promise<void> {
    try {
      // 1. Plan
      const planAttempt = await this.tryCandidates(
        'architect',
        attemptId,
        epoch,
        buildPlanPrompt(premise),
        CHAPTER_PLAN_JSON_SCHEMA,
      );
      if (planAttempt.ok === false) {
        if (planAttempt.cancelled || this.isAborted(attemptId, epoch)) return;
        this.publishFallback(jobId, attemptId, epoch, premise, `Plan step unavailable: ${planAttempt.reason}`);
        return;
      }

      const planValidation = validateChapterPlan(planAttempt.output);
      if (!planValidation.ok) {
        this.publishFallback(
          jobId,
          attemptId,
          epoch,
          premise,
          `Plan schema rejected: ${planValidation.errors.join('; ')}`,
        );
        return;
      }
      const plan = planValidation.plan;

      if (this.isAborted(attemptId, epoch)) return;

      // 2. Build
      this.emit({
        attemptId,
        epoch,
        stage: 'building',
        message: `Chronicler is compiling Rule IR for "${plan.title}"...`,
      });

      const buildAttempt = await this.tryCandidates(
        'chronicler',
        attemptId,
        epoch,
        buildBuildPrompt(premise, plan),
        CHAPTER_BUILD_JSON_SCHEMA,
      );
      if (buildAttempt.ok === false) {
        if (buildAttempt.cancelled || this.isAborted(attemptId, epoch)) return;
        this.publishFallback(jobId, attemptId, epoch, premise, `Build step failed: ${buildAttempt.reason}`);
        return;
      }

      // 3. Validate
      if (this.isAborted(attemptId, epoch)) return;
      this.emit({
        attemptId,
        epoch,
        stage: 'validating',
        message: 'Validating generated Rule IR & chapter constraints...',
      });

      let buildValidation = validateChapterBuild(buildAttempt.output, attemptId);
      let repaired = false;
      let providerUsed = buildAttempt.provider;
      let modelUsed = buildAttempt.model;

      // 4. Repair (max 1)
      if (!buildValidation.ok) {
        if (this.isAborted(attemptId, epoch)) return;
        this.emit({
          attemptId,
          epoch,
          stage: 'repairing',
          message: `Repairing Rule IR (${buildValidation.errors[0] ?? 'validation failed'})...`,
        });

        const repairAttempt = await this.tryCandidates(
          'chronicler',
          attemptId,
          epoch,
          buildRepairPrompt(premise, plan, buildAttempt.output, buildValidation.errors),
          CHAPTER_BUILD_JSON_SCHEMA,
        );
        if (repairAttempt.ok === false) {
          if (repairAttempt.cancelled || this.isAborted(attemptId, epoch)) return;
          this.publishFallback(
            jobId,
            attemptId,
            epoch,
            premise,
            `Repair step failed: ${repairAttempt.reason}`,
          );
          return;
        }

        repaired = true;
        providerUsed = repairAttempt.provider;
        modelUsed = repairAttempt.model;
        buildValidation = validateChapterBuild(repairAttempt.output, attemptId);

        if (!buildValidation.ok) {
          this.publishFallback(
            jobId,
            attemptId,
            epoch,
            premise,
            `Rule IR rejected after repair: ${buildValidation.errors.join('; ')}`,
          );
          return;
        }
      }

      if (this.isAborted(attemptId, epoch)) return;

      // 5. Publish
      this.emit({
        attemptId,
        epoch,
        stage: 'publishing',
        message: `Publishing "${plan.title}" to local ledger...`,
      });

      const preview = buildBattleStateFromChapter({
        attemptId,
        epoch,
        source: 'generated',
        premise,
        plan,
        build: buildValidation.build,
        compiledPack: buildValidation.compiledPack,
        activeAbilityId: buildValidation.activeAbilityId,
        providerUsed,
        modelUsed,
        repaired,
        fallbackReason: null,
      });

      if (this.isAborted(attemptId, epoch)) return;
      const published = this.store.tryPublishGeneration(jobId, attemptId, epoch, preview);
      if (!published) return;

      this.emit({
        attemptId,
        epoch,
        stage: 'completed',
        message: repaired
          ? `Forged "${preview.title}" after automatic Rule IR repair.`
          : `Forged "${preview.title}" via ${providerUsed} (${modelUsed}).`,
        preview,
      });
    } catch (err) {
      if (this.isAborted(attemptId, epoch)) return;
      this.publishFallback(
        jobId,
        attemptId,
        epoch,
        premise,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private publishFallback(
    jobId: string,
    attemptId: string,
    epoch: number,
    premise: string,
    reason: string,
  ): void {
    if (this.isAborted(attemptId, epoch)) return;
    const preview: GeneratedChapterPreview = buildLocalFallbackChapter(
      premise,
      attemptId,
      epoch,
      reason,
    );
    const published = this.store.tryPublishGeneration(jobId, attemptId, epoch, preview);
    if (!published) return;
    this.emit({
      attemptId,
      epoch,
      stage: 'fallback',
      message: `Local Fallback published (${reason}).`,
      preview,
    });
  }
}
