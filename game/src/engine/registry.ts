/**
 * Content registry + the extension API handed to generated modules.
 *
 * A module is an ES module whose default export is `{ id, name, setup(api) }`
 * (declarative keys such as `weapons`, `abilities`, `hooks` are accepted as sugar).
 * The same module file is loaded twice: in the simulation worker (rules, AI,
 * meta-systems) and in the renderer (panels, drawing, sound). Registration is
 * identical in both; each side simply uses the parts it needs.
 */
import type {
  AreaShape,
  EffectOp,
  Loose,
  ModuleFaultInfo,
  ModuleRecord,
  SpriteSpec,
  TileData,
  Vars,
  WeaponData,
} from './types';

export type HookFn = (event: Loose, ctx: Loose, owner?: Loose, extra?: Loose) => void;

export interface AbilityDef {
  id: string;
  name: string;
  description: string;
  module: string;
  kind: 'active' | 'passive';
  target: 'self' | 'unit' | 'tile' | 'none';
  filter: string; // enemy | ally | any | empty | other
  range: [number, number];
  los: boolean;
  area?: AreaShape;
  cost: { acts: number; hp: number; resources: Record<string, number>; items: Record<string, number> };
  cooldown: number;
  usesPerPhase: number;
  usesPerBattle: number;
  glyph: string;
  sound: string;
  fx: string;
  effects: EffectOp[];
  canUse?: (ctx: Loose, unit: Loose) => boolean | string;
  targets?: (ctx: Loose, unit: Loose) => Loose[];
  preview?: (ctx: Loose, unit: Loose, target: Loose) => string;
  use?: (ctx: Loose, unit: Loose, target: Loose) => void;
  ai?: (ctx: Loose, unit: Loose) => { target?: Loose; score: number } | null | undefined;
  hooks: Record<string, HookFn>;
}

export interface StatusDef {
  id: string;
  name: string;
  description: string;
  module: string;
  duration: number;
  maxStacks: number;
  stacking: 'add' | 'refresh' | 'replace';
  mods: Record<string, number>;
  blocks: string[];
  tick: EffectOp[];
  tone: string; // buff | debuff | neutral
  glyph: string;
  onApply?: (ctx: Loose, unit: Loose, status: Loose) => void;
  onTick?: (ctx: Loose, unit: Loose, status: Loose) => void;
  onExpire?: (ctx: Loose, unit: Loose, status: Loose) => void;
  hooks: Record<string, HookFn>;
}

export interface UnitTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  module: string;
  maxHp: number;
  mov: number;
  moveType: string;
  stats: Record<string, number>;
  weapons: Loose[];
  abilities: string[];
  tags: string[];
  sprite: SpriteSpec;
  ai: string;
  level: number;
  vars: Vars;
  actsPerTurn: number;
}

export interface TileDef extends TileData {
  module: string;
  onEnter?: (ctx: Loose, unit: Loose, at: Loose) => void;
  onEndPhase?: (ctx: Loose, unit: Loose) => void;
}

export interface WeaponDef extends WeaponData {
  module: string;
  onHit?: (ctx: Loose, event: Loose) => void;
}

export interface AiDef { id: string; module: string; description: string; plan: (ctx: Loose, unit: Loose) => Loose }
export interface ObjectiveDef { id: string; module: string; check: (ctx: Loose, cond: Loose) => boolean; describe?: (cond: Loose) => string }
export interface GeneratorDef { id: string; module: string; description: string; generate: (gen: Loose) => void }
export interface ModeDef {
  id: string;
  name: string;
  module: string;
  description: string;
  grid: boolean;
  init?: (ctx: Loose, spec: Loose) => void;
  commands: Record<string, (ctx: Loose, args: Loose) => void>;
  view?: { render: (ui: Loose) => Loose };
}
export interface ItemDef { id: string; name: string; description: string; kind: string; module: string; use?: (ctx: Loose, args: Loose) => Loose }
export interface PanelDef { id: string; title: string; module: string; scope: string; icon: string; render: (ui: Loose) => Loose }
export interface MatchupDef {
  module: string;
  attacker: { kind?: string; tag?: string; damageType?: string };
  defender: { kind?: string; tag?: string; classId?: string };
  might: number;
  hit: number;
  damagePct: number;
  note: string;
}
export interface EffectDef { id: string; module: string; duration: number; draw: (g: Loose, t: number, cue: Loose, env: Loose) => void }
interface HookEntry { fn: HookFn; module: string; priority: number; seq: number }
interface OwnerHook { kind: 'ability' | 'status' | 'tile'; id: string; fn: HookFn; module: string }

export interface Registry {
  modules: Record<string, ModuleRecord & { usage: string }>;
  faults: Record<string, ModuleFaultInfo>;
  weapons: Record<string, WeaponDef>;
  abilities: Record<string, AbilityDef>;
  statuses: Record<string, StatusDef>;
  units: Record<string, UnitTemplate>;
  tiles: Record<string, TileDef>;
  items: Record<string, ItemDef>;
  ai: Record<string, AiDef>;
  objectives: Record<string, ObjectiveDef>;
  generators: Record<string, GeneratorDef>;
  modes: Record<string, ModeDef>;
  matchups: MatchupDef[];
  hooks: Map<string, HookEntry[]>;
  ownerHooks: Map<string, OwnerHook[]>;
  commands: Record<string, { module: string; fn: (ctx: Loose, args: Loose) => Loose; description: string }>;
  battleCommands: Record<string, { module: string; fn: (ctx: Loose, args: Loose) => Loose }>;
  panels: PanelDef[];
  unitDrawers: Record<string, { module: string; fn: (g: Loose, unit: Loose, env: Loose) => void }>;
  tileDrawers: Record<string, { module: string; fn: (g: Loose, tile: Loose, env: Loose) => void }>;
  effects: Record<string, EffectDef>;
  sounds: Record<string, Loose>;
  music: Record<string, Loose>;
  seq: number;
  /** Optional breadcrumb: called with the module about to run generated code (null when done). Used by the watchdog. */
  trace?: (moduleId: string | null) => void;
}

export class ModuleFault extends Error {
  readonly moduleId: string;
  readonly where: string;
  readonly original: unknown;
  constructor(moduleId: string, where: string, original: unknown) {
    super(`[${moduleId}] ${where}: ${original instanceof Error ? original.message : String(original)}`);
    this.moduleId = moduleId;
    this.where = where;
    this.original = original;
  }
  info(): ModuleFaultInfo {
    const o = this.original;
    return {
      moduleId: this.moduleId,
      where: this.where,
      message: o instanceof Error ? o.message : String(o),
      stack: o instanceof Error && o.stack ? o.stack.split('\n').slice(0, 8).join('\n') : '',
    };
  }
}

export function createRegistry(): Registry {
  return {
    modules: {}, faults: {}, weapons: {}, abilities: {}, statuses: {}, units: {}, tiles: {}, items: {}, ai: {},
    objectives: {}, generators: {}, modes: {}, matchups: [], hooks: new Map(), ownerHooks: new Map(),
    commands: {}, battleCommands: {}, panels: [], unitDrawers: {}, tileDrawers: {}, effects: {}, sounds: {}, music: {},
    seq: 0,
  };
}

// ---------------------------------------------------------------- normalizers (tolerant: keep the game running)

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length ? v : fallback);
const list = (v: unknown): Loose[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const strings = (v: unknown): string[] => list(v).map(String);
const record = (v: unknown): Record<string, Loose> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Loose>) : {});
const numbers = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(record(v)).map(([k, x]) => [k, num(x, 0)]).filter(([, x]) => Number.isFinite(x as number)));
export const slug = (v: unknown, fallback = 'thing'): string =>
  String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

function rangeOf(v: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(v) && v.length >= 2) {
    const a = Math.max(0, Math.round(num(v[0], fallback[0]))), b = Math.max(0, Math.round(num(v[1], fallback[1])));
    return [Math.min(a, b), Math.max(a, b)];
  }
  if (typeof v === 'number' && Number.isFinite(v)) return [Math.min(1, Math.round(v)), Math.max(0, Math.round(v))];
  return fallback;
}

function areaOf(v: unknown): AreaShape | undefined {
  const r = record(v);
  if (!r.shape) return undefined;
  const shape = ['burst', 'line', 'cross', 'cone', 'all'].includes(String(r.shape)) ? (String(r.shape) as AreaShape['shape']) : 'burst';
  return { shape, size: Math.max(0, Math.round(num(r.size, 1))) };
}

export function normalizeEffects(v: unknown): EffectOp[] {
  return list(v).filter((e) => e && typeof e === 'object' && typeof e.op === 'string') as EffectOp[];
}

export function normalizeWeapon(raw: unknown, fallbackId = 'weapon'): WeaponData {
  const r = typeof raw === 'string' ? { name: raw } : record(raw);
  const name = str(r.name, str(r.id, 'Improvised strike'));
  const damageType = str(r.damageType ?? r.type, 'physical');
  const magical = /mag|arcane|spell|psy|elemental|spirit/i.test(damageType);
  const range = rangeOf(r.range ?? (r.minRange !== undefined ? [r.minRange, r.maxRange ?? r.minRange] : undefined), [1, 1]);
  const area = areaOf(r.area);
  return {
    id: str(r.id, slug(name, fallbackId)),
    name,
    kind: str(r.kind ?? r.tag, slug(name)),
    might: Math.round(num(r.might ?? r.power, 4)),
    hit: Math.round(num(r.hit ?? r.accuracy, 85)),
    crit: Math.round(num(r.crit, 0)),
    weight: Math.round(num(r.weight, 0)),
    range,
    damageType,
    attackStat: str(r.attackStat, magical ? 'mag' : 'str'),
    defenseStat: str(r.defenseStat, magical ? 'res' : 'def'),
    los: r.los === undefined ? range[1] > 1 : !!r.los,
    counter: r.counter === undefined ? true : !!r.counter,
    tags: strings(r.tags),
    glyph: str(r.glyph, ''),
    description: str(r.description, ''),
    effects: normalizeEffects(r.effects ?? r.onHitEffects),
    ...(area ? { area } : {}),
  };
}

export function normalizeTile(raw: unknown, id: string): TileData {
  const r = record(raw);
  const blocksMove = !!(r.blocksMove ?? r.impassable ?? false);
  const cost = Math.max(1, num(r.cost, blocksMove ? 99 : 1));
  const hazard = normalizeEffects(r.hazard);
  return {
    id,
    name: str(r.name, id),
    cost,
    ...(r.costs ? { costs: numbers(r.costs) } : {}),
    blocksMove: blocksMove || cost >= 99,
    blocksSight: !!(r.blocksSight ?? false),
    defense: Math.round(num(r.defense, 0)),
    avoid: Math.round(num(r.avoid, 0)),
    look: str(r.look, id),
    ...(typeof r.color === 'string' ? { color: r.color } : {}),
    ...(typeof r.glyph === 'string' ? { glyph: r.glyph } : {}),
    tags: strings(r.tags),
    description: str(r.description, ''),
    ...(hazard.length ? { hazard } : {}),
  };
}

export function normalizeSprite(raw: unknown): SpriteSpec {
  const r = record(raw);
  const out: SpriteSpec = {};
  for (const key of ['body', 'primary', 'secondary', 'accent', 'drawer', 'glyph'] as const) {
    if (typeof r[key] === 'string') out[key] = r[key];
  }
  if (typeof r.scale === 'number') out.scale = r.scale;
  return out;
}

function normalizeTemplate(raw: unknown, id: string, module: string): UnitTemplate {
  const r = record(raw);
  const stats = numbers(r.stats);
  return {
    id,
    module,
    name: str(r.name, id),
    title: str(r.title ?? r.className, str(r.name, id)),
    description: str(r.description, ''),
    maxHp: Math.max(1, Math.round(num(r.maxHp ?? r.hp, 20))),
    mov: Math.max(0, Math.round(num(r.mov ?? r.move, 4))),
    moveType: str(r.moveType, 'foot'),
    stats,
    weapons: list(r.weapons ?? r.weapon),
    abilities: strings(r.abilities),
    tags: strings(r.tags),
    sprite: normalizeSprite(r.sprite),
    ai: str(r.ai, ''),
    level: Math.max(1, Math.round(num(r.level, 1))),
    vars: { ...record(r.vars) },
    actsPerTurn: Math.max(1, Math.round(num(r.actsPerTurn, 1))),
  };
}

function normalizeAbility(raw: unknown, id: string, module: string): AbilityDef {
  const r = record(raw);
  const cost = record(r.cost);
  const hasUse = typeof r.use === 'function' || normalizeEffects(r.effects).length > 0;
  const kind = r.kind === 'passive' || (!hasUse && r.kind !== 'active') ? 'passive' : 'active';
  const target = ['self', 'unit', 'tile', 'none'].includes(String(r.target)) ? (String(r.target) as AbilityDef['target']) : 'self';
  const area = areaOf(r.area);
  const fn = <T>(v: unknown): T | undefined => (typeof v === 'function' ? (v as T) : undefined);
  const canUse = fn<AbilityDef['canUse']>(r.canUse), targets = fn<AbilityDef['targets']>(r.targets);
  const preview = fn<AbilityDef['preview']>(r.preview), use = fn<AbilityDef['use']>(r.use), ai = fn<AbilityDef['ai']>(r.ai);
  return {
    id,
    module,
    name: str(r.name, id),
    description: str(r.description, ''),
    kind,
    target,
    filter: str(r.filter, target === 'tile' ? 'any' : 'enemy'),
    range: rangeOf(r.range, target === 'self' || target === 'none' ? [0, 0] : [1, 1]),
    los: !!r.los,
    ...(area ? { area } : {}),
    cost: {
      acts: Math.max(0, Math.round(num(cost.acts ?? cost.actions ?? cost.ap, 1))),
      hp: Math.max(0, Math.round(num(cost.hp, 0))),
      resources: numbers(cost.resources),
      items: numbers(cost.items),
    },
    cooldown: Math.max(0, Math.round(num(r.cooldown, 0))),
    usesPerPhase: Math.max(0, Math.round(num(r.usesPerPhase, 0))),
    usesPerBattle: Math.max(0, Math.round(num(r.usesPerBattle, 0))),
    glyph: str(r.glyph, ''),
    sound: str(r.sound, ''),
    fx: str(r.fx, ''),
    effects: normalizeEffects(r.effects),
    ...(canUse ? { canUse } : {}),
    ...(targets ? { targets } : {}),
    ...(preview ? { preview } : {}),
    ...(use ? { use } : {}),
    ...(ai ? { ai } : {}),
    hooks: Object.fromEntries(Object.entries(record(r.hooks)).filter(([, f]) => typeof f === 'function')) as Record<string, HookFn>,
  };
}

function normalizeStatus(raw: unknown, id: string, module: string): StatusDef {
  const r = record(raw);
  const fn = <T>(v: unknown): T | undefined => (typeof v === 'function' ? (v as T) : undefined);
  const onApply = fn<StatusDef['onApply']>(r.onApply), onTick = fn<StatusDef['onTick']>(r.onTick), onExpire = fn<StatusDef['onExpire']>(r.onExpire);
  return {
    id,
    module,
    name: str(r.name, id),
    description: str(r.description, ''),
    duration: Math.round(num(r.duration, 2)),
    maxStacks: Math.max(1, Math.round(num(r.maxStacks, 99))),
    stacking: ['add', 'refresh', 'replace'].includes(String(r.stacking)) ? (String(r.stacking) as StatusDef['stacking']) : 'refresh',
    mods: numbers(r.mods),
    blocks: strings(r.blocks),
    tick: normalizeEffects(r.tick),
    tone: str(r.tone, 'neutral'),
    glyph: str(r.glyph, ''),
    ...(onApply ? { onApply } : {}),
    ...(onTick ? { onTick } : {}),
    ...(onExpire ? { onExpire } : {}),
    hooks: Object.fromEntries(Object.entries(record(r.hooks)).filter(([, f]) => typeof f === 'function')) as Record<string, HookFn>,
  };
}

// ---------------------------------------------------------------- module API

function addOwnerHooks(reg: Registry, kind: OwnerHook['kind'], id: string, module: string, hooks: Record<string, HookFn>): void {
  for (const [name, fn] of Object.entries(hooks)) {
    const arr = reg.ownerHooks.get(name) ?? [];
    const existing = arr.findIndex((h) => h.kind === kind && h.id === id);
    if (existing >= 0) arr.splice(existing, 1);
    arr.push({ kind, id, fn, module });
    reg.ownerHooks.set(name, arr);
  }
}

/** The object passed to `setup(api)`. Every `define*` returns the normalized definition. */
export function createModuleApi(reg: Registry, moduleId: string, env: Vars = {}) {
  const provides = (kind: string, id: string): void => {
    const rec = reg.modules[moduleId];
    if (!rec) return;
    (rec.provides[kind] ??= []).includes(id) || rec.provides[kind]!.push(id);
  };
  const idOf = (raw: Loose, fallback: string): string => str(record(raw).id, slug(record(raw).name, fallback));
  const api = {
    moduleId,
    /** 'sim' in the rules worker, 'view' in the renderer. */
    side: (env.side as string) ?? 'sim',
    env,
    /** Free text that is shown to the Narrator: how to use this module in stories and battle specs. */
    describe(text: string): void {
      const rec = reg.modules[moduleId];
      if (rec) rec.usage = [rec.usage, String(text)].filter(Boolean).join('\n');
    },
    defineWeapon(raw: Loose) {
      const data = normalizeWeapon(raw);
      const def: WeaponDef = { ...data, module: moduleId, ...(typeof raw?.onHit === 'function' ? { onHit: raw.onHit } : {}) };
      reg.weapons[def.id] = def; provides('weapons', def.id); return def;
    },
    defineAbility(raw: Loose) {
      const def = normalizeAbility(raw, idOf(raw, 'ability'), moduleId);
      reg.abilities[def.id] = def; addOwnerHooks(reg, 'ability', def.id, moduleId, def.hooks); provides('abilities', def.id); return def;
    },
    defineStatus(raw: Loose) {
      const def = normalizeStatus(raw, idOf(raw, 'status'), moduleId);
      reg.statuses[def.id] = def; addOwnerHooks(reg, 'status', def.id, moduleId, def.hooks); provides('statuses', def.id); return def;
    },
    /** Unit template: a class, creature species, enemy archetype, NPC… */
    defineUnit(raw: Loose) {
      const def = normalizeTemplate(raw, idOf(raw, 'unit'), moduleId);
      reg.units[def.id] = def; provides('units', def.id); return def;
    },
    defineClass(raw: Loose) { return api.defineUnit(raw); },
    defineTile(raw: Loose) {
      const id = idOf(raw, 'tile');
      const def: TileDef = {
        ...normalizeTile(raw, id), module: moduleId,
        ...(typeof raw?.onEnter === 'function' ? { onEnter: raw.onEnter } : {}),
        ...(typeof raw?.onEndPhase === 'function' ? { onEndPhase: raw.onEndPhase } : {}),
      };
      reg.tiles[id] = def; provides('tiles', id); return def;
    },
    defineItem(raw: Loose) {
      const r = record(raw), id = idOf(raw, 'item');
      const def: ItemDef = { id, module: moduleId, name: str(r.name, id), description: str(r.description, ''), kind: str(r.kind, 'item'), ...(typeof r.use === 'function' ? { use: r.use } : {}) };
      reg.items[id] = def; provides('items', id); return def;
    },
    defineAi(raw: Loose) {
      const r = record(raw), id = idOf(raw, 'ai');
      if (typeof r.plan !== 'function') throw new Error(`defineAi('${id}') needs a plan(ctx, unit) function`);
      reg.ai[id] = { id, module: moduleId, description: str(r.description, ''), plan: r.plan }; provides('ai', id); return reg.ai[id]!;
    },
    /** Win/lose condition usable in battle specs as `{ type: id, ...params }`. */
    defineObjective(raw: Loose) {
      const r = record(raw), id = idOf(raw, 'objective');
      if (typeof r.check !== 'function') throw new Error(`defineObjective('${id}') needs a check(ctx, cond) function`);
      reg.objectives[id] = { id, module: moduleId, check: r.check, ...(typeof r.describe === 'function' ? { describe: r.describe } : {}) };
      provides('objectives', id); return reg.objectives[id]!;
    },
    defineMapGenerator(raw: Loose) {
      const r = record(raw), id = idOf(raw, 'generator');
      if (typeof r.generate !== 'function') throw new Error(`defineMapGenerator('${id}') needs a generate(gen) function`);
      reg.generators[id] = { id, module: moduleId, description: str(r.description, ''), generate: r.generate }; provides('generators', id); return reg.generators[id]!;
    },
    /** A new encounter mode. `grid: false` replaces the board with the mode's own view. */
    defineMode(raw: Loose) {
      const r = record(raw), id = idOf(raw, 'mode');
      const commands = Object.fromEntries(Object.entries(record(r.commands)).filter(([, f]) => typeof f === 'function')) as ModeDef['commands'];
      const def: ModeDef = {
        id, module: moduleId, name: str(r.name, id), description: str(r.description, ''), grid: r.grid === undefined ? true : !!r.grid, commands,
        ...(typeof r.init === 'function' ? { init: r.init } : {}),
        ...(r.view && typeof r.view.render === 'function' ? { view: { render: r.view.render } } : {}),
      };
      reg.modes[id] = def; provides('modes', id); return def;
    },
    matchup(raw: Loose) {
      const r = record(raw);
      const def: MatchupDef = {
        module: moduleId, attacker: record(r.attacker), defender: record(r.defender),
        might: num(r.might, 0), hit: num(r.hit, 0), damagePct: num(r.damagePct, 100), note: str(r.note, ''),
      };
      reg.matchups.push(def); provides('matchups', def.note || `${JSON.stringify(def.attacker)}>${JSON.stringify(def.defender)}`); return def;
    },
    /** Subscribe to an engine or campaign event. Lower priority runs first. */
    on(name: string, fn: HookFn, options: { priority?: number } = {}) {
      if (typeof fn !== 'function') throw new Error(`api.on('${name}') needs a function`);
      const arr = reg.hooks.get(name) ?? [];
      arr.push({ fn, module: moduleId, priority: num(options.priority, 0), seq: reg.seq++ });
      arr.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      reg.hooks.set(name, arr); provides('hooks', name);
    },
    /** Campaign-level command, callable from panels (`ui.send`) and by the Narrator (`commands` in its reply). */
    command(name: string, fn: (ctx: Loose, args: Loose) => Loose, description = '') {
      if (typeof fn !== 'function') throw new Error(`api.command('${name}') needs a function`);
      reg.commands[name] = { module: moduleId, fn, description }; provides('commands', name);
    },
    /** Custom in-battle command, callable from panels and actions (`ui.battleSend`). */
    battleCommand(name: string, fn: (ctx: Loose, args: Loose) => Loose) {
      if (typeof fn !== 'function') throw new Error(`api.battleCommand('${name}') needs a function`);
      reg.battleCommands[name] = { module: moduleId, fn }; provides('battleCommands', name);
    },
    /** UI panel. scope: 'story' | 'battle' | 'both'. render(ui) returns a DOM node (see ui.h). */
    panel(raw: Loose) {
      const r = record(raw), id = idOf(raw, 'panel');
      if (typeof r.render !== 'function') throw new Error(`api.panel('${id}') needs a render(ui) function`);
      const def: PanelDef = { id, module: moduleId, title: str(r.title ?? r.name, id), scope: str(r.scope, 'both'), icon: str(r.icon, '◆'), render: r.render };
      reg.panels = reg.panels.filter((p) => p.id !== id).concat(def); provides('panels', id); return def;
    },
    drawUnit(id: string, fn: (g: Loose, unit: Loose, env: Loose) => void) { reg.unitDrawers[id] = { module: moduleId, fn }; provides('unitDrawers', id); },
    drawTile(id: string, fn: (g: Loose, tile: Loose, env: Loose) => void) { reg.tileDrawers[id] = { module: moduleId, fn }; provides('tileDrawers', id); },
    effect(id: string, raw: Loose) {
      const r = record(raw);
      if (typeof r.draw !== 'function') throw new Error(`api.effect('${id}') needs a draw(g, t, cue, env) function`);
      reg.effects[id] = { id, module: moduleId, duration: Math.max(60, num(r.duration, 500)), draw: r.draw }; provides('effects', id);
    },
    /** Procedural sound recipe (see docs: voices of oscillators/noise with envelopes). */
    sound(id: string, recipe: Loose) { reg.sounds[id] = recipe; provides('sounds', id); },
    /** Music theme for a mood: 'story', 'tense', 'battle', 'danger', 'victory', 'defeat' or any custom mood. */
    music(mood: string, theme: Loose) { reg.music[mood] = theme; provides('music', mood); },
  };
  return api;
}

export type ModuleApi = ReturnType<typeof createModuleApi>;

/** Removes everything a module registered (used before reloading a repaired module). */
export function unregisterModule(reg: Registry, moduleId: string): void {
  const drop = <T extends { module: string }>(table: Record<string, T>): void => {
    for (const [key, def] of Object.entries(table)) if (def.module === moduleId) delete table[key];
  };
  drop(reg.weapons); drop(reg.abilities); drop(reg.statuses); drop(reg.units); drop(reg.tiles); drop(reg.items); drop(reg.ai);
  drop(reg.objectives); drop(reg.generators); drop(reg.modes); drop(reg.commands); drop(reg.battleCommands);
  drop(reg.unitDrawers); drop(reg.tileDrawers); drop(reg.effects);
  reg.matchups = reg.matchups.filter((m) => m.module !== moduleId);
  reg.panels = reg.panels.filter((p) => p.module !== moduleId);
  for (const [name, arr] of reg.hooks) reg.hooks.set(name, arr.filter((h) => h.module !== moduleId));
  for (const [name, arr] of reg.ownerHooks) reg.ownerHooks.set(name, arr.filter((h) => h.module !== moduleId));
  const rec = reg.modules[moduleId];
  if (rec) for (const id of rec.provides.sounds ?? []) delete reg.sounds[id];
  if (rec) for (const id of rec.provides.music ?? []) delete reg.music[id];
  delete reg.modules[moduleId];
  delete reg.faults[moduleId];
}

const SUGAR: [string, string][] = [
  ['weapons', 'defineWeapon'], ['abilities', 'defineAbility'], ['statuses', 'defineStatus'], ['units', 'defineUnit'],
  ['classes', 'defineUnit'], ['tiles', 'defineTile'], ['items', 'defineItem'], ['ai', 'defineAi'], ['objectives', 'defineObjective'],
  ['generators', 'defineMapGenerator'], ['modes', 'defineMode'], ['panels', 'panel'], ['matchups', 'matchup'],
];

/**
 * Registers one module export. Never throws: a broken module is recorded with
 * status 'error' so the game keeps running and a repair helper can be sent.
 */
export function registerModule(reg: Registry, exported: unknown, source: { file: string; fallbackId: string }, env: Vars = {}): ModuleRecord {
  const mod = record(exported && typeof exported === 'object' && 'default' in (exported as object) ? (exported as Loose).default : exported);
  const id = slug(mod.id, slug(source.fallbackId, 'module'));
  unregisterModule(reg, id);
  const rec: ModuleRecord & { usage: string } = {
    id, file: source.file, name: str(mod.name, id), description: str(mod.description, ''), status: 'loaded', error: null, provides: {}, usage: '',
  };
  reg.modules[id] = rec;
  try {
    if (!exported || (typeof mod.setup !== 'function' && !SUGAR.some(([key]) => key in mod) && !mod.hooks && !mod.commands)) {
      throw new Error('Module must `export default { id, name, setup(api) { … } }` (or declarative keys such as weapons/abilities/hooks).');
    }
    const api = createModuleApi(reg, id, env) as Loose;
    for (const [key, method] of SUGAR) {
      const value = mod[key];
      if (!value) continue;
      const entries = Array.isArray(value) ? value.map((v: Loose) => [v?.id, v]) : Object.entries(value);
      for (const [entryId, raw] of entries) api[method](entryId && raw && typeof raw === 'object' && !raw.id ? { id: entryId, ...raw } : raw);
    }
    for (const [name, fn] of Object.entries(record(mod.hooks))) api.on(name, fn as HookFn);
    for (const [name, fn] of Object.entries(record(mod.commands))) api.command(name, fn as Loose);
    for (const [name, fn] of Object.entries(record(mod.battleCommands))) api.battleCommand(name, fn as Loose);
    for (const [name, recipe] of Object.entries(record(mod.sounds))) api.sound(name, recipe);
    for (const [name, theme] of Object.entries(record(mod.music))) api.music(name, theme);
    if (typeof mod.usage === 'string') api.describe(mod.usage);
    if (typeof mod.setup === 'function') mod.setup(api);
  } catch (error) {
    const kept = { ...rec };
    unregisterModule(reg, id);
    reg.modules[id] = { ...kept, status: 'error', error: error instanceof Error ? `${error.message}\n${(error.stack ?? '').split('\n').slice(1, 5).join('\n')}` : String(error), provides: {} };
  }
  return reg.modules[id]!;
}

export function recordLoadError(reg: Registry, file: string, fallbackId: string, error: unknown): ModuleRecord {
  const id = slug(fallbackId, 'module');
  unregisterModule(reg, id);
  reg.modules[id] = {
    id, file, name: id, description: '', status: 'error', provides: {}, usage: '',
    error: error instanceof Error ? `${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 5).join('\n')}` : String(error),
  };
  return reg.modules[id]!;
}

// ---------------------------------------------------------------- guarded invocation

export function isFaulted(reg: Registry, moduleId: string): boolean {
  return moduleId in reg.faults;
}

/** Runs generated code, attributing any exception to its module. */
/** A deliberate `throw new Error('message')` (plain Error) from a command or ability is a rejection shown to the player, not a bug. */
export function isRejection(error: unknown): error is Error {
  return !!error && typeof error === 'object' && (error as Error).name === 'Error' && typeof (error as Error).message === 'string' && !(error instanceof ModuleFault);
}

export function invoke<T>(reg: Registry, moduleId: string, where: string, fn: () => T, options: { allowRejection?: boolean } = {}): T | undefined {
  if (moduleId !== 'core' && isFaulted(reg, moduleId)) return undefined;
  reg.trace?.(moduleId);
  try {
    return fn();
  } catch (error) {
    if (error instanceof ModuleFault) throw error;
    if (moduleId === 'core') throw error;
    if (options.allowRejection && isRejection(error)) throw new Error(error.message);
    throw new ModuleFault(moduleId, where, error);
  } finally { reg.trace?.(null); }
}

export function hasHook(reg: Registry, name: string): boolean {
  return (reg.hooks.get(name)?.length ?? 0) > 0 || (reg.ownerHooks.get(name)?.length ?? 0) > 0;
}

export function emitGlobal(reg: Registry, name: string, event: Loose, ctx: Loose): void {
  const handlers = reg.hooks.get(name);
  if (!handlers || handlers.length === 0) return;
  for (const h of [...handlers]) invoke(reg, h.module, `hook ${name}`, () => h.fn(event, ctx));
}

export function moduleSummaries(reg: Registry): (ModuleRecord & { usage: string })[] {
  return Object.values(reg.modules).map((m) => ({
    ...m,
    status: m.status === 'loaded' && isFaulted(reg, m.id) ? 'faulted' : m.status,
    error: m.error ?? (reg.faults[m.id] ? `${reg.faults[m.id]!.where}: ${reg.faults[m.id]!.message}` : null),
  }));
}
