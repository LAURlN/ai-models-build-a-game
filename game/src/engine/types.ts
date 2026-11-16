/**
 * Limitless engine — shared data model.
 *
 * Everything in a BattleState / CampaignState is plain JSON so it can be saved,
 * hashed, rewound and mirrored to the renderer. Behaviour (functions) lives in
 * the content Registry, which is rebuilt from generated modules at load time.
 */

export interface Coord { x: number; y: number }
// Module-owned free-form state. Deliberately loose: generated content decides its shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Vars = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

export const ENGINE_VERSION = 'limitless-1';

// ---------------------------------------------------------------- content data

/** Declarative effect step ("Rule IR lite"): enough for simple inline content, never a ceiling. */
export interface EffectOp {
  op: string;
  [key: string]: Loose;
}

export interface AreaShape { shape: 'burst' | 'line' | 'cross' | 'cone' | 'all'; size: number }

export interface WeaponData {
  id: string;
  name: string;
  /** Free-form kind: "snare sling", "rebar spear", "pitchfork", "resonance whistle"… */
  kind: string;
  might: number;
  hit: number;
  crit: number;
  weight: number;
  range: [number, number];
  damageType: string;
  attackStat: string;
  defenseStat: string;
  los: boolean;
  counter: boolean;
  tags: string[];
  glyph: string;
  description: string;
  effects: EffectOp[];
  area?: AreaShape;
}

export interface StatusInstance {
  id: string;
  stacks: number;
  /** Remaining owner phases (decremented as each of the owner's phases ends); -1 = until removed. */
  duration: number;
  source?: string;
  data: Vars;
}

export interface SpriteSpec {
  /** Body plan drawn by the default renderer: humanoid, beast, bird, serpent, blob, construct, spirit, plant, machine, swarm… */
  body?: string;
  /** Hex colours, e.g. "#c0563a". */
  primary?: string;
  secondary?: string;
  accent?: string;
  /** Custom drawer id registered with api.drawUnit(). */
  drawer?: string;
  glyph?: string;
  scale?: number;
}

export interface UnitState {
  id: string;
  name: string;
  title: string;
  classId: string;
  faction: string;
  pos: Coord;
  hp: number;
  maxHp: number;
  mov: number;
  moveType: string;
  stats: Record<string, number>;
  weapons: WeaponData[];
  equipped: number;
  abilities: string[];
  statuses: StatusInstance[];
  tags: string[];
  vars: Vars;
  resources: Record<string, number>;
  acts: number;
  actsPerTurn: number;
  moved: boolean;
  alive: boolean;
  /** Why the unit left the field without dying: "captured", "fled", "extracted"… */
  gone?: string;
  ai: string;
  sprite: SpriteSpec;
  rosterId?: string;
  level: number;
  uses: Record<string, number>;
  cooldowns: Record<string, number>;
}

export interface TileData {
  id: string;
  name: string;
  /** Movement cost; Infinity-like values (>= 99) are impassable. */
  cost: number;
  costs?: Record<string, number>;
  blocksMove: boolean;
  blocksSight: boolean;
  defense: number;
  avoid: number;
  /** Default look used by the procedural renderer: plain, grass, forest, water, wall, stone, sand, road, crop, mud, snow, lava, metal, void, rubble, bridge… */
  look: string;
  color?: string;
  glyph?: string;
  tags: string[];
  description: string;
  /** Simple hazard handled by the engine: applied when a unit ends its faction phase on the tile. */
  hazard?: EffectOp[];
}

export interface FactionState {
  id: string;
  name: string;
  controller: 'player' | 'ai' | 'none';
  /** Hostile faction ids; "*" = everyone else. */
  hostileTo: string[];
  color: string;
  shape: string;
  resources: Record<string, number>;
  ai?: string;
}

export interface MapState {
  width: number;
  height: number;
  palette: string[];
  /** Row-major indices into palette. */
  cells: number[];
  defs: Record<string, TileData>;
}

export interface Condition {
  type: string;
  [key: string]: Loose;
}

export interface ObjectiveState {
  text: string;
  win: Condition[];
  lose: Condition[];
  turnLimit: number;
  onTimeout: string;
}

export interface LogEntry { id: number; round: number; faction: string; kind: string; text: string }

/** Presentation cue. Never part of the simulation hash. */
export interface FxCue {
  t: string;
  unit?: string;
  target?: string;
  at?: Coord;
  from?: Coord;
  to?: Coord;
  path?: Coord[];
  text?: string;
  tone?: string;
  id?: string;
  amount?: number;
  outcome?: string;
  params?: Vars;
}

export interface UnitDelta {
  id: string;
  hp: number;
  pos: Coord;
  alive: boolean;
  statuses: StatusInstance[];
  acts: number;
  gone?: string;
}

export interface TraceStep {
  id: string;
  actorId: string;
  actorName: string;
  summary: string;
  fx: FxCue[];
  after: UnitDelta[];
}

export interface BattleRules {
  critMultiplier: number;
  followUpThreshold: number;
  turnwheelCharges: number;
  [key: string]: Loose;
}

export interface BattleResultData {
  captured: Loose[];
  loot: { id: string; name: string; qty: number; data?: Vars }[];
  notes: string[];
  vars: Vars;
}

export interface BattleState {
  engine: string;
  id: string;
  title: string;
  intro: string;
  seed: number;
  rngPos: number;
  mode: string;
  map: MapState;
  factions: Record<string, FactionState>;
  order: string[];
  phaseIndex: number;
  round: number;
  commandOrdinal: number;
  units: UnitState[];
  objective: ObjectiveState;
  rules: BattleRules;
  status: 'ongoing' | 'ended';
  outcome: string | null;
  endReason: string | null;
  vars: Vars;
  /** Snapshot of campaign inventory/vars; authoritative while the battle runs, written back on resolve. */
  world: { inventory: InventoryItem[]; vars: Vars };
  result: BattleResultData;
  log: LogEntry[];
  logSeq: number;
  unitSeq: number;
  /** Cosmetic — excluded from hashes. */
  fx: FxCue[];
  trace: TraceStep[] | null;
}

// ---------------------------------------------------------------- commands

export type BattleCommand =
  | { type: 'move'; unit: string; to: Coord }
  | { type: 'attack'; unit: string; target: string; weapon?: number; from?: Coord }
  | { type: 'ability'; unit: string; ability: string; target?: Loose }
  | { type: 'wait'; unit: string }
  | { type: 'equip'; unit: string; weapon: number }
  | { type: 'endPhase' }
  | { type: 'retreat' }
  | { type: 'abort' }
  | { type: 'custom'; name: string; args?: Loose }
  | { type: 'aiPhase' };

export interface ModuleFaultInfo {
  moduleId: string;
  where: string;
  message: string;
  stack: string;
}

export interface CommandOutcome {
  ok: boolean;
  state: BattleState;
  error: string | null;
  faults: ModuleFaultInfo[];
}

// ---------------------------------------------------------------- campaign

export interface InventoryItem { id: string; name: string; qty: number; kind: string; description: string; data: Vars }

export interface RosterUnit {
  id: string;
  name: string;
  title: string;
  classId: string;
  template?: string;
  status: string; // active | reserve | dead | captured | away | …
  hp: number;
  maxHp: number;
  mov: number;
  moveType: string;
  stats: Record<string, number>;
  weapons: Loose[];
  abilities: string[];
  tags: string[];
  vars: Vars;
  sprite: SpriteSpec;
  level: number;
  xp: number;
  notes: string;
  ai?: string;
}

export interface WorldEntity { id: string; name: string; description: string; [key: string]: Loose }

export interface MemoryFact { id: number; text: string; turn: number; tags: string[] }

export interface BattleRecord {
  id: string;
  title: string;
  turn: number;
  outcome: string;
  reason: string;
  rounds: number;
  summary: string;
  casualties: string[];
  captured: string[];
  loot: string[];
}

export interface ModuleRecord {
  id: string;
  file: string;
  name: string;
  description: string;
  status: 'loaded' | 'error' | 'faulted';
  error: string | null;
  provides: Record<string, string[]>;
}

export interface CampaignState {
  engine: string;
  id: string;
  title: string;
  setting: string;
  seed: number;
  rngPos: number;
  createdAt: number;
  updatedAt: number;
  turn: number;
  status: 'active' | 'ended';
  ending: string | null;
  scene: { location: string; summary: string; mood: string };
  roster: RosterUnit[];
  inventory: InventoryItem[];
  factions: WorldEntity[];
  relationships: WorldEntity[];
  places: WorldEntity[];
  threads: WorldEntity[];
  facts: MemoryFact[];
  factSeq: number;
  summary: string;
  summarizedThrough: number;
  battles: BattleRecord[];
  vars: Vars;
  rules: Vars;
  installed: string[];
  activeBattleId: string | null;
  pendingBattle: PendingBattle | null;
  suggestions: string[];
}

export interface PendingBattle {
  title: string;
  intro: string;
  specFile: string | null;
  specJson: string | null;
  status: 'preparing' | 'ready' | 'failed';
  waitingOn: string[];
  error: string | null;
}

export interface ChatMessage {
  seq: number;
  role: 'player' | 'narrator' | 'system';
  text: string;
  turn: number;
  at: number;
  kind?: string;
}

export interface WorldOp {
  op: string;
  target: string;
  value?: Loose;
}

export interface ActivityTask {
  id: string;
  kind: string; // narrator | helper | repair | battle | archivist
  title: string;
  detail: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  files: string[];
  model: string;
  error: string | null;
}

// ---------------------------------------------------------------- read models shared with the renderer

export interface BattleSnapshot2 { state: BattleState; hash: string; rewindsLeft: number; canRewind: boolean; revision: number }
export interface WorldView {
  revision: number;
  campaign: CampaignState | null;
  chat: ChatMessage[];
  chatTotal: number;
  modules: (ModuleRecord & { usage: string })[];
  moduleFiles: { file: string; hash: string }[];
  battle: BattleSnapshot2 | null;
  workspace: string;
}
export type WorldEvent = { type: 'view'; view: WorldView } | { type: 'faults'; faults: ModuleFaultInfo[] };
export interface CampaignSummary { id: string; title: string; setting: string; updatedAt: number; turn: number; battles: number; status: string; inBattle: boolean }
export interface DirectorStatus { busy: boolean; error: string | null; canRetry: boolean; tasks: ActivityTask[] }
