import { Schema } from 'effect';
import type { Forecast, SelectionInfo } from '../engine/battle';
import type {
  BattleCommand, BattleRecord, BattleSnapshot2, CampaignSummary, Coord as EngineCoord, DirectorStatus, WorldView,
} from '../engine/types';

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 10;
export const MAX_TURNS = 16;
export const RULES_VERSION = 'r03-1';

export const CoordSchema = Schema.Struct({
  x: Schema.Int.pipe(Schema.between(0, 9)),
  y: Schema.Int.pipe(Schema.between(0, 9)),
});
export type Coord = typeof CoordSchema.Type;
export type Faction = 'player' | 'enemy';
export type Phase = Faction;
export type ObjectiveType = 'rout' | 'seize';
export type MapArchetypeId = 'bridge_assault' | 'fortress_siege' | 'forest_ambush' | 'twin_path_escort';
export type EndReason =
  | 'all_enemies_defeated'
  | 'all_allies_defeated'
  | 'objective_seized'
  | 'concede'
  | 'expiry'
  | 'technical_abort';

export const GameCommandSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('SELECT_UNIT'), unitId: Schema.NullOr(Schema.NonEmptyString) }),
  Schema.Struct({ type: Schema.Literal('MOVE_UNIT'), unitId: Schema.NonEmptyString, to: CoordSchema }),
  Schema.Struct({ type: Schema.Literal('ATTACK_UNIT'), attackerId: Schema.NonEmptyString, targetId: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal('WAIT_UNIT'), unitId: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal('USE_ABILITY'), unitId: Schema.NonEmptyString, abilityId: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal('END_PHASE') }),
  Schema.Struct({ type: Schema.Literal('CONCEDE') }),
  Schema.Struct({ type: Schema.Literal('TECHNICAL_ABORT') }),
);
export type GameCommand = typeof GameCommandSchema.Type;
export const EngineCommandSchema = Schema.Union(
  GameCommandSchema,
  Schema.Struct({ type: Schema.Literal('RUN_ENEMY_PHASE') }),
);
export type EngineCommand = typeof EngineCommandSchema.Type;
export const decodeGameCommand = Schema.decodeUnknownEither(GameCommandSchema, { onExcessProperty: 'error' });
export const decodeEngineCommand = Schema.decodeUnknownEither(EngineCommandSchema, { onExcessProperty: 'error' });

export type RuleExpr =
  | number
  | { read: 'stackCount' }
  | { read: 'counter'; key: string }
  | { op: 'add' | 'multiply' | 'floorDivide'; left: RuleExpr; right: RuleExpr };

export type RuleEffect =
  | { op: 'sequence'; effects: RuleEffect[] }
  | { op: 'grantAction'; amount: number; key: string; kind: 'any' }
  | { op: 'applyStatus'; statusId: string; stacks: number; expiry: 'nextOwnPhaseStart' }
  | { op: 'removeStatus'; statusId: string }
  | { op: 'heal' | 'dealDamage'; amount: RuleExpr }
  | { op: 'adjustCounter'; key: string; amount: RuleExpr };

export type RuleHook = 'useActive' | 'kill' | 'statusExpiry' | 'afterHeal' | 'afterDamage';

export interface RuleListener {
  hook: RuleHook;
  scope: 'ownerActor' | 'ownerTarget' | 'ownedStatus';
  priority: number;
  maxPerRoot: number;
  maxPerPhase: number;
  effect: RuleEffect;
}

export interface RuleDefinition {
  schemaVersion: 1;
  id: string;
  rulesVersion: string;
  provenanceJobId: string;
  name: string;
  kind: 'active' | 'status';
  costs: { hp: number; actions: number };
  useKey: string;
  usesPerPhase: number;
  stackPolicy: 'add';
  activationPolicy: 'normal' | 'blockOrdinaryAction';
  listeners: RuleListener[];
}

export interface CompiledRuleDefinition extends RuleDefinition {
  contentHash: string;
  rulesText: string;
  bound: number;
}

export type CompiledRulePack = Record<string, CompiledRuleDefinition>;

export interface Weapon {
  id: string;
  name?: string;
  tag: 'sword' | 'axe' | 'lance' | 'bow' | 'tome';
  might: number;
  weight: number;
  hit: number;
  crit: number;
  minRange: number;
  maxRange: number;
  damageType: 'physical' | 'magical';
  lineOfSight: boolean;
}

export interface StatusInstance {
  id: string;
  definitionId: string;
  definitionHash: string;
  stacks: number;
  expiry: number;
  payload: Record<string, string | number>;
}

export interface UnitState {
  id: string;
  name: string;
  title: string;
  classId: string;
  faction: Faction;
  pos: Coord;
  hp: number;
  maxHp: number;
  str: number;
  mag: number;
  skl: number;
  spd: number;
  lck: number;
  def: number;
  res: number;
  mov: number;
  weapon: Weapon;
  abilities: string[];
  statuses: StatusInstance[];
  counters: Record<string, number>;
  actionCredits: number;
  bonusCredits: number;
  phaseUses: Record<string, number>;
  hasMoved: boolean;
  hasActed: boolean;
  alive: boolean;
}

export type BattleEventKind = 'system' | 'move' | 'attack' | 'phase' | 'outcome' | 'rule';
export interface BattleEvent {
  id: number;
  turn: number;
  phase: Phase;
  kind: BattleEventKind;
  message: string;
}
export type Terrain = 'plain' | 'wall' | 'cover';

export interface StrikeTrace {
  actorId: string;
  targetId: string;
  role: 'initial' | 'counter' | 'follow-up';
  hitBP: number;
  critBP: number;
  baseDamage: number;
  outcome: 'hit' | 'miss' | 'crit';
  hpBefore: number;
  hpAfter: number;
}

export interface EnemyPhaseStep {
  id: string;
  kind: 'status' | 'move' | 'attack';
  actorId: string;
  actorName: string;
  targetId?: string;
  targetName?: string;
  from?: Coord;
  to?: Coord;
  path?: Coord[];
  strikes?: StrikeTrace[];
  triggers?: string[];
  hpAfter: number;
  targetHpAfter?: number;
  summary: string;
}

export interface BattleState {
  rulesVersion: string;
  seed: number;
  boardWidth: number;
  boardHeight: number;
  terrain: Terrain[][];
  turn: number;
  maxTurns: number;
  phase: Phase;
  phaseOrdinal: number;
  phaseCommands: number;
  status: 'ongoing' | 'victory' | 'defeat';
  endReason: EndReason | null;
  selectedUnitId: string | null;
  commandOrdinal: number;
  rngPosition: number;
  units: UnitState[];
  events: BattleEvent[];
  listenerCounts: Record<string, number>;
  chapterId?: string;
  chapterTitle?: string;
  chapterPremise?: string;
  chapterSource?: 'builtin' | 'generated' | 'local_fallback';
  provenanceJobId?: string;
  objectiveType?: ObjectiveType;
  seizeTile?: Coord | null;
  rulePack?: CompiledRulePack;
  enemyPhaseTrace?: EnemyPhaseStep[];
}

export interface ForecastBranch {
  label: string;
  hp: Record<string, number>;
  strikes: StrikeTrace[];
  triggers: string[];
}
export interface CombatForecast {
  attackerId: string;
  targetId: string;
  branches: ForecastBranch[];
  liabilities: string[];
  cost: string;
}
export interface BattleSnapshot {
  revision: number;
  state: BattleState;
  reachableTiles: Coord[];
  attackableTargetIds: string[];
  stateHash: string;
  lastError: string | null;
  rewindsLeft: number;
  canRewind: boolean;
  hasSave: boolean;
}
export interface DispatchResponse {
  ok: boolean;
  error: string | null;
  snapshot: BattleSnapshot;
}

export type GenerationRole = 'architect' | 'chronicler';
export type ModelEffortOption = 'low' | 'medium' | 'high' | 'xhigh' | '';

export interface RoleModelSelection {
  providerId: string;
  model: string;
  effort?: ModelEffortOption;
}

export interface FallbackModelEntry {
  providerId: string;
  model: string;
  effort?: ModelEffortOption;
}

export interface ProviderSettings {
  architect: RoleModelSelection;
  chronicler: RoleModelSelection;
  fallbacks: FallbackModelEntry[];
  /** Campaign Narrator (chat, direction). Falls back to the Chronicler slot when unset. */
  narrator?: RoleModelSelection;
  /** Helper agents that build content code. Falls back to the Architect slot when unset. */
  helper?: RoleModelSelection;
  /** How many helper agents may run in parallel (default 3). */
  helperConcurrency?: number;
}

export interface ProviderModelInfo {
  slug: string;
  name: string;
  isCustom: boolean;
  supportsTextGeneration: boolean;
  supportedEffortLevels: string[];
  defaultEffort: string | null;
  selectable: boolean;
  disabledReason: string | null;
}

export interface ProviderAuthActionInfo {
  methodId: string;
  kind: string;
  label: string;
  available: boolean;
  reason?: string;
}

export interface InteractiveAuthFlow {
  flowId: string;
  providerId: string;
  phase: string;
  message: string | null;
  url?: string;
  userCode?: string;
  canCancel: boolean;
}

export interface ProviderInfo {
  instanceId: string;
  driverKind: string;
  name: string;
  enabled: boolean;
  installed: boolean;
  status: 'ready' | 'warning' | 'error' | 'disabled';
  authStatus: 'authenticated' | 'unauthenticated' | 'unknown';
  authLabel: string;
  accountEmail?: string;
  message: string | null;
  models: ProviderModelInfo[];
  authMethods: ProviderAuthActionInfo[];
  activeFlow: InteractiveAuthFlow | null;
}

export interface SidecarHealthStatus {
  connected: boolean;
  fakeMode: boolean;
  pid: number | null;
  baseDir: string;
  lastError: string | null;
}

export type GenerationStage =
  | 'idle'
  | 'planning'
  | 'building'
  | 'validating'
  | 'repairing'
  | 'publishing'
  | 'completed'
  | 'fallback'
  | 'cancelled'
  | 'failed';

export interface ChapterPlanUnit {
  id: string;
  name: string;
  title: string;
  faction: Faction;
  weaponTag: 'sword' | 'axe' | 'lance' | 'bow' | 'tome';
  weaponName: string;
  hp: number;
  str: number;
  mag: number;
  skl: number;
  spd: number;
  lck: number;
  def: number;
  res: number;
  mov: number;
  grantActiveAbility: boolean;
}

export interface ChapterPlan {
  schemaVersion: 1;
  title: string;
  archetype: MapArchetypeId;
  objective: ObjectiveType;
  maxTurns: number;
  summary: string;
  units: ChapterPlanUnit[];
}

export interface ChapterBuild {
  schemaVersion: 1;
  abilityName: string;
  statusName: string;
  abilitySummary: string;
  introChronicle: string;
  rulePack: RuleDefinition[];
}

export interface GeneratedChapterPreview {
  attemptId: string;
  epoch: number;
  source: 'generated' | 'local_fallback';
  title: string;
  premise: string;
  archetype: MapArchetypeId;
  objective: ObjectiveType;
  summary: string;
  abilityName: string;
  abilityRulesText: string;
  units: Array<{ name: string; title: string; faction: Faction; weaponTag: string }>;
  providerUsed: string;
  modelUsed: string;
  repaired: boolean;
  fallbackReason: string | null;
  battleState: BattleState;
}

export interface GenerationProgressEvent {
  attemptId: string;
  epoch: number;
  stage: GenerationStage;
  message: string;
  preview?: GeneratedChapterPreview;
}

export interface WorldBridge {
  list(): Promise<CampaignSummary[]>;
  create(setting: string): Promise<WorldView>;
  open(id: string): Promise<WorldView>;
  close(): Promise<void>;
  remove(id: string): Promise<void>;
  view(): Promise<WorldView>;
  status(): Promise<DirectorStatus>;
  say(text: string): Promise<void>;
  retry(): Promise<void>;
  command(name: string, args: unknown): Promise<{ ok: boolean; error: string | null }>;
  battleCommand(command: BattleCommand): Promise<{ ok: boolean; error: string | null; snapshot: BattleSnapshot2 | null }>;
  battleSelect(unitId: string): Promise<SelectionInfo | null>;
  battleForecast(attackerId: string, targetId: string, weapon?: number, from?: EngineCoord | null): Promise<Forecast | null>;
  battleThreat(): Promise<EngineCoord[]>;
  battlePreview(unitId: string, abilityId: string, target: unknown): Promise<string>;
  battleRewind(): Promise<BattleSnapshot2>;
  battleResolve(): Promise<BattleRecord>;
  onView(listener: (view: WorldView) => void): () => void;
  onStatus(listener: (status: DirectorStatus) => void): () => void;
}

export interface ChronicleApi {
  world: WorldBridge;
  getSnapshot(): Promise<BattleSnapshot>;
  dispatch(command: GameCommand): Promise<DispatchResponse>;
  forecast(attackerId: string, targetId: string): Promise<CombatForecast>;
  save(): Promise<BattleSnapshot>;
  load(): Promise<BattleSnapshot>;
  rewind(): Promise<BattleSnapshot>;
  restart(): Promise<BattleSnapshot>;
  onSnapshot(listener: (snapshot: BattleSnapshot) => void): () => void;

  getSidecarStatus(): Promise<SidecarHealthStatus>;
  listProviders(): Promise<ProviderInfo[]>;
  refreshProviders(): Promise<ProviderInfo[]>;
  startProviderAuth(instanceId: string, methodId?: string): Promise<ProviderInfo>;
  respondProviderAuth(
    instanceId: string,
    flowId: string,
    response: { type: 'browser'; action: 'complete' | 'decline' } | { type: 'code'; code: string },
  ): Promise<ProviderInfo>;
  completeProviderAuth(instanceId: string, flowId: string): Promise<ProviderInfo>;
  cancelProviderAuth(instanceId: string, flowId: string): Promise<ProviderInfo>;
  logoutProvider(instanceId: string): Promise<ProviderInfo>;
  onProvidersUpdated(listener: (providers: ProviderInfo[]) => void): () => void;

  getProviderSettings(): Promise<ProviderSettings>;
  saveProviderSettings(settings: ProviderSettings): Promise<ProviderSettings>;

  startGeneration(premise: string): Promise<{ attemptId: string; epoch: number }>;
  cancelGeneration(attemptId: string): Promise<{ cancelled: boolean }>;
  getGenerationStatus(): Promise<GenerationProgressEvent>;
  onGenerationProgress(listener: (event: GenerationProgressEvent) => void): () => void;
  launchChapter(state: BattleState): Promise<BattleSnapshot>;
}
