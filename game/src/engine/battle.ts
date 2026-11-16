/**
 * Limitless battle kernel.
 *
 * Deterministic and transactional: a command runs on a structured clone of the
 * state with a counter-based RNG; if generated code throws, the clone is discarded,
 * the offending module is quarantined and the command is retried without it.
 * Nothing here caps units, map size, factions, weapon kinds or ability counts.
 */
import { runAiPhase } from './ai';
import {
  BLOCKED, areaCells, baseTileCost, inBounds, lineOfSight, manhattan, nearestFree, pathField, pathTo, ringCells, sameCoord,
  setTile, tileAt, tileIdAt, type PathField,
} from './grid';
import { buildMap, CORE_TILES, stripFunctions } from './mapgen';
import {
  ModuleFault, createModuleApi, createRegistry, emitGlobal, hasHook, invoke, isFaulted, normalizeSprite, normalizeWeapon, slug,
  type AbilityDef, type Registry, type StatusDef,
} from './registry';
import { hashJson, hashString, makeRng, type Rng } from './rng';
import {
  ENGINE_VERSION,
  type BattleCommand, type BattleState, type CommandOutcome, type Condition, type Coord, type EffectOp, type FactionState, type FxCue,
  type InventoryItem, type Loose, type ModuleFaultInfo, type ObjectiveState, type RosterUnit, type StatusInstance, type UnitState,
  type Vars, type WeaponData,
} from './types';

const LOG_LIMIT = 400;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const toNum = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);
const asCoord = (v: Loose): Coord | null => {
  if (Array.isArray(v) && v.length >= 2) return { x: Math.round(toNum(v[0])), y: Math.round(toNum(v[1])) };
  if (v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number') return { x: Math.round(v.x), y: Math.round(v.y) };
  return null;
};

export interface CombatNumbers {
  power: number;
  defense: number;
  damage: number;
  hit: number;
  crit: number;
  notes: string[];
}

export interface WorldSeed {
  roster: RosterUnit[];
  inventory: InventoryItem[];
  vars: Vars;
  rules?: Vars;
}

/** Inline (data-only) definitions shipped inside a battle spec live in a private mini-registry per state. */
const inlineCache = new WeakMap<object, Registry>();
function inlineRegistry(state: BattleState): Registry {
  const raw = (state.vars.__inline ?? {}) as Loose;
  let cached = inlineCache.get(raw);
  if (!cached) {
    cached = createRegistry();
    cached.modules.inline = { id: 'inline', file: '', name: 'inline', description: '', status: 'loaded', error: null, provides: {}, usage: '' };
    const api = createModuleApi(cached, 'inline') as Loose;
    for (const [id, def] of Object.entries(raw.abilities ?? {})) api.defineAbility({ id, ...(def as object) });
    for (const [id, def] of Object.entries(raw.statuses ?? {})) api.defineStatus({ id, ...(def as object) });
    inlineCache.set(raw, cached);
  }
  return cached;
}

export class BattleCtx {
  readonly state: BattleState;
  readonly reg: Registry;
  readonly rng: Rng;
  private occ: Map<number, UnitState> | null = null;
  private depth = 0;
  private fuel = 400_000;
  /** True while forecasting: hooks must not rely on side effects persisting. */
  simulate = false;

  constructor(state: BattleState, reg: Registry, forced?: number[]) {
    this.state = state;
    this.reg = reg;
    this.rng = makeRng(state, forced);
  }

  // ------------------------------------------------------------ lookups
  get vars(): Vars { return this.state.vars; }
  get world(): BattleState['world'] { return this.state.world; }
  get result(): BattleState['result'] { return this.state.result; }
  get map(): BattleState['map'] { return this.state.map; }
  get round(): number { return this.state.round; }
  get phaseFaction(): string { return this.state.order[this.state.phaseIndex] ?? ''; }

  unit(ref: Loose): UnitState | undefined {
    if (!ref) return undefined;
    if (typeof ref === 'string') return this.state.units.find((u) => u.id === ref);
    return typeof ref === 'object' && typeof ref.id === 'string' ? this.state.units.find((u) => u.id === ref.id) : undefined;
  }
  units(filter?: (u: UnitState) => boolean): UnitState[] {
    return this.state.units.filter((u) => u.alive && (!filter || filter(u)));
  }
  private occupancy(): Map<number, UnitState> {
    if (!this.occ) {
      this.occ = new Map();
      for (const u of this.state.units) if (u.alive) this.occ.set(u.pos.y * this.state.map.width + u.pos.x, u);
    }
    return this.occ;
  }
  invalidate(): void { this.occ = null; }
  unitAt(x: number | Coord, y?: number): UnitState | undefined {
    const c = typeof x === 'number' ? { x, y: y ?? 0 } : x;
    return this.occupancy().get(c.y * this.state.map.width + c.x);
  }
  faction(id: string): FactionState | undefined { return this.state.factions[id]; }
  isPlayerControlled(u: UnitState): boolean { return this.state.factions[u.faction]?.controller === 'player'; }
  isHostile(a: Loose, b: Loose): boolean {
    const fa = typeof a === 'string' ? a : a?.faction, fb = typeof b === 'string' ? b : b?.faction;
    if (!fa || !fb || fa === fb) return false;
    const A = this.state.factions[fa], B = this.state.factions[fb];
    const hostile = (from: FactionState | undefined, to: string): boolean => !!from && (from.hostileTo.includes(to) || from.hostileTo.includes('*'));
    return hostile(A, fb) || hostile(B, fa);
  }
  allies(u: UnitState): UnitState[] { return this.units((o) => o.id !== u.id && !this.isHostile(u, o)); }
  enemies(u: UnitState): UnitState[] { return this.units((o) => this.isHostile(u, o)); }
  distance(a: Loose, b: Loose): number {
    const pa = a?.pos ?? asCoord(a), pb = b?.pos ?? asCoord(b);
    return pa && pb ? manhattan(pa, pb) : Infinity;
  }
  tile(x: number | Coord, y?: number) { const c = typeof x === 'number' ? { x, y: y ?? 0 } : x; return tileAt(this.state.map, c.x, c.y); }
  tileId(x: number | Coord, y?: number): string { const c = typeof x === 'number' ? { x, y: y ?? 0 } : x; return tileIdAt(this.state.map, c.x, c.y); }
  inBounds(x: number, y: number): boolean { return inBounds(this.state.map, x, y); }
  los(a: Loose, b: Loose): boolean {
    const pa = a?.pos ?? asCoord(a), pb = b?.pos ?? asCoord(b);
    return !!pa && !!pb && lineOfSight(this.state.map, pa, pb);
  }
  unitsInRadius(centre: Loose, radius: number, filter?: (u: UnitState) => boolean): UnitState[] {
    const c = centre?.pos ?? asCoord(centre);
    return c ? this.units((u) => manhattan(u.pos, c) <= radius && (!filter || filter(u))) : [];
  }
  cellsInRange(centre: Loose, min: number, max: number): Coord[] {
    const c = centre?.pos ?? asCoord(centre);
    return c ? ringCells(this.state.map, c, min, max) : [];
  }
  hasStatus(u: Loose, id: string): boolean { return !!this.unit(u)?.statuses.some((s) => s.id === id); }
  status(u: Loose, id: string): StatusInstance | undefined { return this.unit(u)?.statuses.find((s) => s.id === id); }
  hasAbility(u: Loose, id: string): boolean { return !!this.unit(u)?.abilities.includes(id); }
  abilityDef(id: string): AbilityDef | undefined { return this.reg.abilities[id] ?? inlineRegistry(this.state).abilities[id]; }
  statusDef(id: string): StatusDef | undefined { return this.reg.statuses[id] ?? inlineRegistry(this.state).statuses[id]; }
  weaponOf(u: UnitState, index = u.equipped): WeaponData | undefined { return u.weapons[index] ?? u.weapons[0]; }
  item(id: string): InventoryItem | undefined { return this.state.world.inventory.find((i) => i.id === id); }
  itemCount(id: string): number { return this.item(id)?.qty ?? 0; }

  /** Effective stat: base + status modifiers + `stat:calc` hooks. */
  stat(u: UnitState, key: string): number {
    let value = key === 'mov' ? u.mov : key === 'maxHp' ? u.maxHp : key === 'hp' ? u.hp : u.stats[key] ?? 0;
    for (const inst of u.statuses) {
      const mod = this.statusDef(inst.id)?.mods[key];
      if (mod) value += mod * Math.max(1, inst.stacks);
    }
    if (hasHook(this.reg, 'stat:calc')) {
      const ev = { unit: u, stat: key, value };
      this.emit('stat:calc', ev);
      value = toNum(ev.value, value);
    }
    return value;
  }
  movOf(u: UnitState): number { return Math.max(0, Math.round(this.stat(u, 'mov'))); }
  isBlocked(u: UnitState, what: string): boolean {
    return u.statuses.some((inst) => this.statusDef(inst.id)?.blocks.includes(what));
  }

  // ------------------------------------------------------------ presentation + log
  cue(cue: FxCue): void { this.state.fx.push(cue); }
  log(text: string, kind = 'info'): void {
    const s = this.state;
    s.log.push({ id: ++s.logSeq, round: s.round, faction: this.phaseFaction, kind, text: String(text) });
    if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
  }
  /** Floating text over a unit or tile: the standard "visible feedback" for a custom mechanic. */
  float(where: Loose, text: string, tone = 'info'): void {
    const u = this.unit(where), at = u?.pos ?? asCoord(where);
    if (at) this.cue({ t: 'float', at: { ...at }, text: String(text), tone, ...(u ? { unit: u.id } : {}) });
  }
  /** Plays a registered visual effect (api.effect) or a built-in one: ring, burst, beam, sparkle, shock, ripple. */
  fx(id: string, params: Vars = {}): void {
    const at = this.unit(params.at)?.pos ?? asCoord(params.at), from = this.unit(params.from)?.pos ?? asCoord(params.from), to = this.unit(params.to)?.pos ?? asCoord(params.to);
    this.cue({ t: 'fx', id, ...(at ? { at: { ...at } } : {}), ...(from ? { from: { ...from } } : {}), ...(to ? { to: { ...to } } : {}), params: { color: params.color, size: params.size } });
  }
  sound(id: string): void { this.cue({ t: 'sound', id }); }

  // ------------------------------------------------------------ events
  tick(cost = 1): void {
    this.fuel -= cost;
    if (this.fuel < 0) throw new Error('Battle command exceeded its evaluation budget (possible infinite trigger loop).');
  }
  /** Fires a hook: global `api.on` handlers first, then hooks owned by abilities/statuses of involved units. */
  emit<T extends Vars>(name: string, event: T): T {
    const global = this.reg.hooks.get(name), owned = this.reg.ownerHooks.get(name);
    if (!global?.length && !owned?.length) return event;
    this.tick();
    if (++this.depth > 24) { this.depth = 0; throw new Error(`Hook recursion too deep at '${name}'.`); }
    try {
      if (global?.length) emitGlobal(this.reg, name, event, this);
      if (owned?.length) {
        const ev = event as Loose, scoped = !!(ev.unit || ev.target);
        for (const h of [...owned]) {
          if (isFaulted(this.reg, h.module)) continue;
          for (const unit of [...this.state.units]) {
            if (scoped ? ev.unit?.id !== unit.id && ev.target?.id !== unit.id : !unit.alive) continue;
            if (h.kind === 'ability') {
              if (unit.abilities.includes(h.id)) invoke(this.reg, h.module, `ability ${h.id} hook ${name}`, () => h.fn(event, this, unit));
            } else if (h.kind === 'status') {
              const inst = unit.statuses.find((s) => s.id === h.id);
              if (inst) invoke(this.reg, h.module, `status ${h.id} hook ${name}`, () => h.fn(event, this, unit, inst));
            }
          }
        }
      }
    } finally { this.depth = Math.max(0, this.depth - 1); this.occ = null; }
    return event;
  }

  // ------------------------------------------------------------ movement
  tileCost(u: UnitState, x: number, y: number): number {
    const tile = tileAt(this.state.map, x, y);
    let cost = baseTileCost(tile, u.moveType);
    if (hasHook(this.reg, 'move:cost')) {
      const ev = { unit: u, x, y, tile, cost };
      this.emit('move:cost', ev);
      cost = toNum(ev.cost, cost);
    }
    return cost;
  }
  reach(u: UnitState, budget = this.movOf(u)): PathField {
    const occ = this.occupancy(), phasing = u.tags.includes('phasing');
    return pathField(this.state.map, u.pos, budget, (index, x, y) => {
      const other = occ.get(index);
      if (other && other.id !== u.id && !phasing && this.isHostile(u, other)) return BLOCKED;
      return this.tileCost(u, x, y);
    });
  }
  reachable(u: UnitState, budget = this.movOf(u)): Coord[] {
    const field = this.reach(u, budget), occ = this.occupancy(), out: Coord[] = [];
    for (let i = 0; i < field.dist.length; i++) {
      if (i !== field.start && Number.isFinite(field.dist[i]!) && !occ.has(i)) out.push({ x: i % field.width, y: Math.floor(i / field.width) });
    }
    return out;
  }
  path(u: UnitState, to: Coord): Coord[] { return pathTo(this.reach(u), to); }

  /** Walks a unit along a path (hooks per step). Returns the cells actually travelled. */
  walk(u: UnitState, path: Coord[]): Coord[] {
    const travelled: Coord[] = [{ ...u.pos }];
    let lastFree = 0;
    for (const step of path.slice(1)) {
      this.tick();
      u.pos = { ...step }; this.occ = null; travelled.push({ ...step });
      const occupied = this.state.units.some((o) => o.alive && o.id !== u.id && sameCoord(o.pos, step));
      if (!occupied) lastFree = travelled.length - 1;
      const tileId = this.tileId(step), def = this.reg.tiles[tileId];
      if (def?.onEnter) invoke(this.reg, def.module, `tile ${tileId}.onEnter`, () => def.onEnter!(this, u, step));
      let stop = false;
      if (hasHook(this.reg, 'move:step')) {
        const ev = { unit: u, x: step.x, y: step.y, tile: this.tile(step), stop: false };
        this.emit('move:step', ev); stop = !!ev.stop;
      }
      if (!u.alive || stop) break;
    }
    if (u.alive && lastFree !== travelled.length - 1) { travelled.length = lastFree + 1; u.pos = { ...travelled[lastFree]! }; }
    this.occ = null;
    return travelled;
  }
  /** Voluntary move within the unit's reach. */
  move(unit: Loose, to: Loose): boolean {
    const u = this.unit(unit), dest = asCoord(to);
    if (!u || !u.alive || !dest || !this.inBounds(dest.x, dest.y)) return false;
    if (sameCoord(u.pos, dest)) return true;
    const path = this.path(u, dest);
    if (!path.length || this.unitAt(dest)) return false;
    const ev = { unit: u, to: dest, path, cancel: false, reason: '' };
    this.emit('move:before', ev);
    if (ev.cancel) return false;
    const from = { ...u.pos }, travelled = this.walk(u, path);
    this.cue({ t: 'move', unit: u.id, from, to: { ...u.pos }, path: travelled });
    this.emit('move:after', { unit: u, from, to: { ...u.pos }, path: travelled });
    return true;
  }
  /** Instant relocation to the nearest free cell at/near `to`. */
  teleport(unit: Loose, to: Loose): boolean {
    const u = this.unit(unit), wanted = asCoord(to);
    if (!u || !wanted) return false;
    const free = nearestFree(this.state.map, wanted, (x, y) => !this.tile(x, y).blocksMove && (!this.unitAt(x, y) || this.unitAt(x, y)!.id === u.id));
    if (!free) return false;
    const from = { ...u.pos };
    u.pos = free; this.occ = null;
    this.cue({ t: 'teleport', unit: u.id, from, to: { ...free } });
    return true;
  }
  /** Forced movement in a direction; stops at blockers. Returns cells moved. */
  push(unit: Loose, dx: number, dy: number, distance = 1): number {
    const u = this.unit(unit);
    if (!u || !u.alive) return 0;
    const from = { ...u.pos }, path: Coord[] = [from];
    let moved = 0;
    for (let i = 0; i < distance; i++) {
      const next = { x: u.pos.x + Math.sign(dx), y: u.pos.y + Math.sign(dy) };
      if (!this.inBounds(next.x, next.y) || this.tile(next).blocksMove || this.unitAt(next)) break;
      u.pos = next; this.occ = null; path.push({ ...next }); moved++;
    }
    if (moved) this.cue({ t: 'move', unit: u.id, from, to: { ...u.pos }, path, tone: 'forced' });
    return moved;
  }
  setTile(x: number, y: number, tileId: string): void {
    const def = this.reg.tiles[tileId] ?? CORE_TILES[tileId];
    setTile(this.state.map, x, y, tileId, def ? stripFunctions(def) : undefined);
    if (!this.state.map.defs[tileId]) this.state.map.defs[tileId] = { ...CORE_TILES.plain!, id: tileId, name: tileId, look: tileId };
    this.cue({ t: 'tile', at: { x, y }, id: tileId });
  }

  // ------------------------------------------------------------ hp, statuses, resources
  damage(target: Loose, amount: number, opts: { source?: Loose; type?: string; cause?: string; silent?: boolean } = {}): number {
    const t = this.unit(target);
    if (!t || !t.alive) return 0;
    this.tick();
    const source = this.unit(opts.source) ?? null;
    const ev = { unit: source, target: t, amount: Math.max(0, Math.round(toNum(amount))), type: opts.type ?? 'true', cause: opts.cause ?? 'effect' };
    this.emit('damage:before', ev);
    const lost = clamp(Math.round(toNum(ev.amount)), 0, t.hp);
    t.hp -= lost;
    if (!opts.silent) this.cue({ t: 'damage', unit: t.id, at: { ...t.pos }, amount: lost });
    if (opts.cause !== 'attack') this.log(`${t.name} loses ${lost} HP (${t.hp}/${t.maxHp}).`, 'damage');
    this.emit('damage:after', { ...ev, amount: lost });
    if (t.hp <= 0 && t.alive) this.defeat(t, source);
    return lost;
  }
  heal(target: Loose, amount: number, opts: { source?: Loose } = {}): number {
    const t = this.unit(target);
    if (!t || !t.alive) return 0;
    const ev = { unit: this.unit(opts.source) ?? null, target: t, amount: Math.max(0, Math.round(toNum(amount))) };
    this.emit('heal:before', ev);
    const gained = clamp(Math.round(toNum(ev.amount)), 0, t.maxHp - t.hp);
    t.hp += gained;
    this.cue({ t: 'heal', unit: t.id, at: { ...t.pos }, amount: gained });
    this.log(`${t.name} recovers ${gained} HP (${t.hp}/${t.maxHp}).`, 'heal');
    this.emit('heal:after', { ...ev, amount: gained });
    return gained;
  }
  defeat(target: Loose, killer?: Loose): boolean {
    const t = this.unit(target);
    if (!t || !t.alive) return false;
    const ev = { unit: this.unit(killer) ?? null, target: t, prevent: false };
    this.emit('unit:defeated', ev);
    if (ev.prevent) { t.hp = Math.max(1, t.hp); return false; }
    t.hp = 0; t.alive = false; t.acts = 0; this.occ = null;
    this.log(`${t.name} is defeated.`, 'defeat');
    this.cue({ t: 'defeat', unit: t.id, at: { ...t.pos } });
    return true;
  }
  /** Takes a unit off the field without killing it: "captured", "fled", "extracted"… */
  remove(target: Loose, reason = 'removed'): boolean {
    const t = this.unit(target);
    if (!t || !t.alive) return false;
    t.alive = false; t.gone = reason; t.acts = 0; this.occ = null;
    this.log(`${t.name} leaves the field (${reason}).`, 'info');
    this.cue({ t: 'remove', unit: t.id, at: { ...t.pos }, text: reason });
    this.emit('unit:removed', { target: t, reason });
    return true;
  }
  applyStatus(target: Loose, id: string, opts: { duration?: number; stacks?: number; data?: Vars; source?: Loose } = {}): StatusInstance | null {
    const t = this.unit(target);
    if (!t || !t.alive) return null;
    const def = this.statusDef(id);
    const stacks = Math.max(1, Math.round(toNum(opts.stacks, 1))), duration = Math.round(toNum(opts.duration, def?.duration ?? 2));
    let inst = t.statuses.find((s) => s.id === id);
    if (inst) {
      if (def?.stacking === 'add') inst.stacks = Math.min(def.maxStacks, inst.stacks + stacks);
      if (def?.stacking === 'replace') { inst.stacks = stacks; inst.data = { ...(opts.data ?? {}) }; }
      inst.duration = duration < 0 ? -1 : Math.max(inst.duration, duration);
      if (opts.data && def?.stacking !== 'replace') Object.assign(inst.data, opts.data);
    } else {
      inst = { id, stacks: Math.min(def?.maxStacks ?? 99, stacks), duration, data: { ...(opts.data ?? {}) }, ...(this.unit(opts.source) ? { source: this.unit(opts.source)!.id } : {}) };
      t.statuses.push(inst);
    }
    const name = def?.name ?? id;
    this.log(`${t.name} gains ${name}${inst.stacks > 1 ? ` ×${inst.stacks}` : ''}.`, 'status');
    this.cue({ t: 'status', unit: t.id, at: { ...t.pos }, id, text: name, tone: def?.tone ?? 'neutral' });
    if (def?.onApply) invoke(this.reg, def.module, `status ${id}.onApply`, () => def.onApply!(this, t, inst));
    this.emit('status:applied', { target: t, status: inst, def });
    return inst;
  }
  removeStatus(target: Loose, id: string, expired = false): boolean {
    const t = this.unit(target);
    const inst = t?.statuses.find((s) => s.id === id);
    if (!t || !inst) return false;
    t.statuses = t.statuses.filter((s) => s !== inst);
    const def = this.statusDef(id);
    if (expired) {
      this.log(`${def?.name ?? id} ends on ${t.name}.`, 'status');
      this.cue({ t: 'status-end', unit: t.id, at: { ...t.pos }, id, text: def?.name ?? id });
      if (def?.onExpire) invoke(this.reg, def.module, `status ${id}.onExpire`, () => def.onExpire!(this, t, inst));
      this.emit('status:expired', { target: t, status: inst, def });
    }
    return true;
  }
  grantAction(target: Loose, amount = 1): void {
    const t = this.unit(target);
    if (!t || !t.alive) return;
    t.acts += Math.max(0, Math.round(amount)); t.moved = false;
    this.cue({ t: 'float', unit: t.id, at: { ...t.pos }, text: `+${amount} action`, tone: 'buff' });
  }
  /** Unit resource pools ("focus", "ammo", "mana"…). Returns the new value. */
  addResource(target: Loose, key: string, amount: number): number {
    const t = this.unit(target);
    if (!t) return 0;
    t.resources[key] = (t.resources[key] ?? 0) + toNum(amount);
    return t.resources[key]!;
  }
  addItem(id: string, qty = 1, extra: Partial<InventoryItem> = {}): InventoryItem {
    let item = this.item(id);
    if (!item) {
      item = { id, name: extra.name ?? this.reg.items[id]?.name ?? id, qty: 0, kind: extra.kind ?? this.reg.items[id]?.kind ?? 'item', description: extra.description ?? this.reg.items[id]?.description ?? '', data: { ...(extra.data ?? {}) } };
      this.state.world.inventory.push(item);
    }
    item.qty += qty;
    return item;
  }
  useItem(id: string, qty = 1): boolean {
    const item = this.item(id);
    if (!item || item.qty < qty) return false;
    item.qty -= qty;
    if (item.qty <= 0) this.state.world.inventory = this.state.world.inventory.filter((i) => i !== item);
    return true;
  }
  /** Adds loot to the battle result (collected into the campaign inventory afterwards). */
  loot(id: string, qty = 1, name = id, data?: Vars): void {
    this.state.result.loot.push({ id, name, qty, ...(data ? { data } : {}) });
    this.log(`Loot: ${name} ×${qty}.`, 'loot');
  }
  /** Captures a unit: removes it from the field and records a roster-ready snapshot in the result. */
  capture(target: Loose, by?: Loose): boolean {
    const t = this.unit(target);
    if (!t || !t.alive) return false;
    this.state.result.captured.push(unitToRoster(t));
    this.remove(t, 'captured');
    this.emit('unit:captured', { unit: this.unit(by) ?? null, target: t });
    return true;
  }
  spawn(spec: Loose, near?: Loose): UnitState | null {
    const s = this.state;
    const unit = instantiateUnit(spec ?? {}, this.reg, `${slug(spec?.id ?? spec?.template ?? spec?.name, 'unit')}-${++s.unitSeq}`);
    if (!s.factions[unit.faction]) s.factions[unit.faction] = normalizeFaction({ id: unit.faction }, Object.keys(s.factions).length);
    if (!s.order.includes(unit.faction)) s.order.push(unit.faction);
    const wanted = asCoord(spec?.pos) ?? this.unit(near)?.pos ?? asCoord(near) ?? { x: Math.floor(s.map.width / 2), y: Math.floor(s.map.height / 2) };
    const free = nearestFree(s.map, wanted, (x, y) => this.tileCost(unit, x, y) < BLOCKED && !this.unitAt(x, y));
    if (!free) return null;
    unit.pos = free; unit.acts = 0;
    s.units.push(unit); this.occ = null;
    this.cue({ t: 'spawn', unit: unit.id, at: { ...free } });
    this.emit('unit:spawned', { target: unit });
    return unit;
  }
  endBattle(outcome: string, reason = ''): void {
    const s = this.state;
    if (s.status === 'ended') return;
    s.status = 'ended'; s.outcome = String(outcome || 'ended'); s.endReason = String(reason || outcome || '');
    this.log(`${s.outcome.toUpperCase()}: ${s.endReason}.`, 'outcome');
    this.cue({ t: 'outcome', outcome: s.outcome, text: s.endReason });
    this.emit('battle:end', { outcome: s.outcome, reason: s.endReason });
  }

  // ------------------------------------------------------------ combat
  private attackSpeed(u: UnitState, weapon: WeaponData | undefined): number {
    return this.stat(u, 'spd') - Math.max(0, (weapon?.weight ?? 0) - this.stat(u, 'str'));
  }
  inWeaponRange(a: UnitState, b: UnitState, weapon: WeaponData, from: Coord = a.pos): boolean {
    const d = manhattan(from, b.pos);
    return d >= weapon.range[0] && d <= weapon.range[1] && (!weapon.los || lineOfSight(this.state.map, from, b.pos));
  }
  /** Pure combat numbers for one strike (no randomness). Modules adjust them through `combat:calc`. */
  combat(a: UnitState, b: UnitState, weapon: WeaponData): CombatNumbers {
    const notes: string[] = [];
    let might = weapon.might, hitBonus = 0, pct = 100;
    const defWeapon = this.weaponOf(b);
    for (const m of this.reg.matchups) {
      if (isFaulted(this.reg, m.module)) continue;
      const A = m.attacker, D = m.defender;
      const attackerOk = (!A.kind || A.kind === weapon.kind) && (!A.tag || weapon.tags.includes(A.tag) || a.tags.includes(A.tag)) && (!A.damageType || A.damageType === weapon.damageType);
      const defenderOk = (!D.tag || b.tags.includes(D.tag)) && (!D.classId || D.classId === b.classId) && (!D.kind || D.kind === defWeapon?.kind);
      if (!attackerOk || !defenderOk) continue;
      might += m.might; hitBonus += m.hit; pct = (pct * m.damagePct) / 100;
      if (m.note) notes.push(m.note);
    }
    const tile = this.tile(b.pos);
    const power = this.stat(a, weapon.attackStat) + might;
    const defense = weapon.damageType === 'true' ? 0 : this.stat(b, weapon.defenseStat) + tile.defense;
    const ev = {
      unit: a, target: b, weapon, power, defense, notes,
      damage: Math.max(0, Math.floor(((power - defense) * pct) / 100)),
      hit: weapon.hit + 2 * this.stat(a, 'skl') + this.stat(a, 'lck') - 2 * this.attackSpeed(b, defWeapon) - this.stat(b, 'lck') - tile.avoid + hitBonus,
      crit: weapon.crit + Math.floor(this.stat(a, 'skl') / 2) - this.stat(b, 'lck'),
      simulate: this.simulate,
    };
    this.emit('combat:calc', ev);
    return {
      power: ev.power, defense: ev.defense, notes: ev.notes,
      damage: Math.max(0, Math.round(toNum(ev.damage))), hit: clamp(Math.round(toNum(ev.hit)), 0, 100), crit: clamp(Math.round(toNum(ev.crit)), 0, 100),
    };
  }
  counterWeapon(defender: UnitState, attacker: UnitState): WeaponData | null {
    if (this.isBlocked(defender, 'counter') || this.isBlocked(defender, 'act') || this.isBlocked(defender, 'attack')) return null;
    const w = this.weaponOf(defender);
    return w && w.counter && this.inWeaponRange(defender, attacker, w) ? w : null;
  }
  followUp(a: UnitState, aw: WeaponData, b: UnitState, bw: WeaponData | undefined): 'attacker' | 'defender' | null {
    const threshold = toNum(this.state.rules.followUpThreshold, 4);
    if (threshold <= 0) return null;
    const diff = this.attackSpeed(a, aw) - this.attackSpeed(b, bw);
    return diff >= threshold ? 'attacker' : diff <= -threshold ? 'defender' : null;
  }
  private strike(a: UnitState, b: UnitState, weapon: WeaponData, role: string): Loose {
    this.tick();
    const c = this.combat(a, b, weapon);
    const hit = this.rng.next() * 100 < c.hit;
    const crit = hit && c.crit > 0 && this.rng.next() * 100 < c.crit;
    const ev = {
      unit: a, target: b, weapon, role, outcome: !hit ? 'miss' : crit ? 'crit' : 'hit',
      damage: hit ? c.damage * (crit ? toNum(this.state.rules.critMultiplier, 3) : 1) : 0, hit: c.hit, crit: c.crit,
    };
    this.emit('strike', ev);
    const landed = ev.outcome !== 'miss';
    const hpBefore = b.hp;
    const dealt = landed ? this.damage(b, ev.damage, { source: a, type: weapon.damageType, cause: 'attack', silent: true }) : 0;
    this.cue({ t: 'strike', unit: a.id, target: b.id, from: { ...a.pos }, to: { ...b.pos }, outcome: ev.outcome, amount: dealt, id: weapon.glyph || weapon.kind, text: role });
    this.log(`${a.name} → ${b.name} (${weapon.name}, ${role}): ${ev.outcome}${landed ? `, ${dealt} damage (${b.hp}/${b.maxHp})` : ''}. Hit ${c.hit}%, crit ${c.crit}%.`, 'attack');
    if (landed) {
      if (weapon.effects.length) this.runEffects(weapon.effects, { source: a, target: b });
      const def = this.reg.weapons[weapon.id];
      if (def?.onHit) invoke(this.reg, def.module, `weapon ${weapon.id}.onHit`, () => def.onHit!(this, { ...ev, damage: dealt }));
    }
    return { actor: a.id, target: b.id, role, outcome: ev.outcome, damage: dealt, hpBefore, hpAfter: b.hp };
  }
  /** Full exchange: strike, counter, follow-up; splash for area weapons. */
  attack(attacker: Loose, target: Loose, weaponIndex?: number): Loose[] {
    const a = this.unit(attacker), b = this.unit(target);
    if (!a || !b || !a.alive || !b.alive) return [];
    if (weaponIndex !== undefined && a.weapons[weaponIndex]) a.equipped = weaponIndex;
    const weapon = this.weaponOf(a);
    if (!weapon) return [];
    const before = { unit: a, target: b, weapon, cancel: false, reason: '' };
    this.emit('attack:before', before);
    if (before.cancel) { this.log(before.reason || `${a.name}'s attack is prevented.`, 'info'); return []; }
    const strikes: Loose[] = [];
    const counter = this.counterWeapon(b, a);
    const follow = this.followUp(a, weapon, b, this.weaponOf(b));
    strikes.push(this.strike(a, b, weapon, 'attack'));
    if (weapon.area) {
      for (const cell of areaCells(this.state.map, weapon.area.shape, weapon.area.size, b.pos, a.pos)) {
        const other = this.unitAt(cell);
        if (other && other.id !== b.id && other.alive && this.isHostile(a, other)) strikes.push(this.strike(a, other, weapon, 'splash'));
      }
    }
    if (counter && a.alive && b.alive && this.inWeaponRange(b, a, counter)) strikes.push(this.strike(b, a, counter, 'counter'));
    if (follow === 'attacker' && a.alive && b.alive && this.inWeaponRange(a, b, weapon)) strikes.push(this.strike(a, b, weapon, 'follow-up'));
    if (follow === 'defender' && counter && a.alive && b.alive && this.inWeaponRange(b, a, counter)) strikes.push(this.strike(b, a, counter, 'follow-up'));
    this.emit('attack:after', { unit: a, target: b, weapon, strikes });
    return strikes;
  }

  // ------------------------------------------------------------ declarative effects ("Rule IR lite")
  private amountOf(op: EffectOp, source: UnitState | undefined, target: UnitState | undefined): number {
    let value = toNum(op.amount, 0);
    if (typeof op.stat === 'string') {
      const of = op.of === 'target' ? target : source;
      if (of) value += this.stat(of, op.stat) * toNum(op.times, 1);
    }
    if (typeof op.percentMaxHp === 'number' && target) value += Math.floor((target.maxHp * op.percentMaxHp) / 100);
    if (typeof op.defenseStat === 'string' && target) value -= this.stat(target, op.defenseStat);
    return Math.max(0, Math.round(value));
  }
  /** Runs data-defined effect steps. `env.target` may be a unit or a tile; `env.area` widens it. */
  runEffects(ops: EffectOp[], env: { source?: Loose; target?: Loose; area?: Loose }): void {
    const source = this.unit(env.source);
    const centre = this.unit(env.target)?.pos ?? asCoord(env.target) ?? source?.pos;
    for (const op of ops) {
      this.tick();
      const area = env.area ?? op.area;
      let subjects: UnitState[];
      if (op.to === 'source' || op.to === 'self') subjects = source ? [source] : [];
      else if (area && centre) {
        const cells = areaCells(this.state.map, String(area.shape ?? 'burst'), toNum(area.size, 1), centre, source?.pos ?? centre);
        const affects = String(op.affects ?? 'enemy');
        subjects = cells.map((c) => this.unitAt(c)).filter((u): u is UnitState => !!u && u.alive).filter((u) =>
          affects === 'any' || !source ? true : affects === 'ally' ? !this.isHostile(source, u) : this.isHostile(source, u));
      } else subjects = this.unit(env.target) ? [this.unit(env.target)!] : [];
      switch (op.op) {
        case 'damage': for (const t of subjects) this.damage(t, this.amountOf(op, source, t), { source, type: String(op.type ?? 'true') }); break;
        case 'heal': for (const t of subjects) this.heal(t, this.amountOf(op, source, t), { source }); break;
        case 'status': for (const t of subjects) this.applyStatus(t, String(op.id ?? op.status), { ...(op.duration !== undefined ? { duration: toNum(op.duration) } : {}), stacks: toNum(op.stacks, 1), source }); break;
        case 'removeStatus': for (const t of subjects) this.removeStatus(t, String(op.id ?? op.status)); break;
        case 'push': case 'pull':
          for (const t of subjects) {
            if (!source) continue;
            const sign = op.op === 'push' ? 1 : -1, dx = t.pos.x - source.pos.x, dy = t.pos.y - source.pos.y;
            if (Math.abs(dx) >= Math.abs(dy)) this.push(t, sign * (dx || 1), 0, toNum(op.distance, 1)); else this.push(t, 0, sign * dy, toNum(op.distance, 1));
          }
          break;
        case 'teleport': if (source && centre) this.teleport(source, centre); break;
        case 'swap':
          for (const t of subjects) if (source) { const p = { ...source.pos }; source.pos = { ...t.pos }; t.pos = p; this.occ = null; this.cue({ t: 'teleport', unit: source.id, to: { ...source.pos } }); this.cue({ t: 'teleport', unit: t.id, to: { ...t.pos } }); }
          break;
        case 'grantAction': for (const t of subjects) this.grantAction(t, toNum(op.amount, 1)); break;
        case 'resource': for (const t of subjects) this.addResource(t, String(op.key ?? 'resource'), toNum(op.amount, 1)); break;
        case 'summon':
          for (let i = 0; i < Math.max(1, toNum(op.count, 1)); i++) this.spawn({ template: op.template, faction: op.faction ?? source?.faction, ...(op.unit ?? {}) }, centre ?? source);
          break;
        case 'tile':
          if (centre) for (const c of area ? areaCells(this.state.map, String(area.shape ?? 'burst'), toNum(area.size, 1), centre, source?.pos ?? centre) : [centre]) this.setTile(c.x, c.y, String(op.tile ?? 'plain'));
          break;
        case 'capture': for (const t of subjects) this.capture(t, source); break;
        case 'remove': for (const t of subjects) this.remove(t, String(op.reason ?? 'removed')); break;
        case 'var': this.state.vars[String(op.key)] = toNum(this.state.vars[String(op.key)], 0) + toNum(op.amount, 1); break;
        case 'loot': this.loot(String(op.id ?? 'loot'), toNum(op.qty, 1), String(op.name ?? op.id ?? 'Loot')); break;
        case 'float': if (centre) this.float(centre, String(op.text ?? ''), String(op.tone ?? 'info')); break;
        case 'fx': this.fx(String(op.id ?? 'ring'), { at: centre, from: source, to: centre, color: op.color }); break;
        case 'sound': this.sound(String(op.id ?? 'ability')); break;
        case 'log': this.log(String(op.text ?? ''), 'info'); break;
        case 'end': this.endBattle(String(op.outcome ?? 'victory'), String(op.reason ?? 'effect')); break;
        default: this.log(`(Unknown effect op '${op.op}' ignored.)`, 'info');
      }
    }
  }

  // ------------------------------------------------------------ abilities
  abilityBlockReason(u: UnitState, def: AbilityDef): string | null {
    if (def.kind !== 'active') return 'Passive';
    if (def.module !== 'inline' && isFaulted(this.reg, def.module)) return 'Faulted — a helper is repairing this ability';
    if (!u.alive) return 'Defeated';
    if (this.isBlocked(u, 'ability') || (def.cost.acts > 0 && this.isBlocked(u, 'act'))) return 'Blocked by a status';
    if (u.acts < def.cost.acts) return 'No actions left';
    if (def.cost.hp > 0 && u.hp <= def.cost.hp) return `Needs more than ${def.cost.hp} HP`;
    if ((u.cooldowns[def.id] ?? 0) > 0) return `Cooldown ${u.cooldowns[def.id]}`;
    if (def.usesPerPhase > 0 && (u.uses[def.id] ?? 0) >= def.usesPerPhase) return 'Already used this phase';
    if (def.usesPerBattle > 0 && toNum(u.vars._used?.[def.id], 0) >= def.usesPerBattle) return 'No uses left this battle';
    for (const [key, n] of Object.entries(def.cost.resources)) if ((u.resources[key] ?? 0) < n) return `Needs ${n} ${key}`;
    for (const [key, n] of Object.entries(def.cost.items)) if (this.itemCount(key) < n) return `Needs ${n} × ${this.item(key)?.name ?? key}`;
    if (def.canUse) {
      const verdict = invoke(this.reg, def.module, `ability ${def.id}.canUse`, () => def.canUse!(this, u));
      if (verdict === false) return 'Not usable now';
      if (typeof verdict === 'string') return verdict;
    }
    return null;
  }
  abilityTargets(u: UnitState, def: AbilityDef): { cells: Coord[]; unitIds: string[] } {
    if (def.target === 'self' || def.target === 'none') return { cells: [{ ...u.pos }], unitIds: [u.id] };
    if (def.targets) {
      const listed = invoke(this.reg, def.module, `ability ${def.id}.targets`, () => def.targets!(this, u)) ?? [];
      const cells: Coord[] = [], unitIds: string[] = [];
      for (const entry of Array.isArray(listed) ? listed : []) {
        const unit = this.unit(entry), c = unit?.pos ?? asCoord(entry);
        if (unit) unitIds.push(unit.id);
        if (c) cells.push({ ...c });
      }
      return { cells, unitIds };
    }
    const cells: Coord[] = [], unitIds: string[] = [];
    for (const c of ringCells(this.state.map, u.pos, def.range[0], def.range[1])) {
      if (def.los && !lineOfSight(this.state.map, u.pos, c)) continue;
      const other = this.unitAt(c);
      if (def.target === 'unit') {
        if (!other) continue;
        const ok = def.filter === 'any' ? true : def.filter === 'ally' ? !this.isHostile(u, other) : def.filter === 'other' ? other.id !== u.id : this.isHostile(u, other);
        if (ok) { cells.push(c); unitIds.push(other.id); }
      } else if (def.filter !== 'empty' || (!other && !this.tile(c).blocksMove)) cells.push(c);
    }
    return { cells, unitIds };
  }
  useAbility(unit: Loose, abilityId: string, rawTarget?: Loose): void {
    const u = this.unit(unit), def = this.abilityDef(abilityId);
    if (!u || !def || !u.abilities.includes(abilityId)) throw new Error('That unit does not have this ability.');
    const reason = this.abilityBlockReason(u, def);
    if (reason) throw new Error(`${def.name}: ${reason}.`);
    const options = this.abilityTargets(u, def);
    let target: Loose = u;
    if (def.target === 'unit') {
      const t = this.unit(rawTarget) ?? (asCoord(rawTarget) ? this.unitAt(asCoord(rawTarget)!) : undefined);
      if (!t || !options.unitIds.includes(t.id)) throw new Error(`${def.name}: choose a valid target.`);
      target = t;
    } else if (def.target === 'tile') {
      const c = asCoord(rawTarget) ?? this.unit(rawTarget)?.pos;
      if (!c || !options.cells.some((o) => sameCoord(o, c))) throw new Error(`${def.name}: choose a valid tile.`);
      target = { x: c.x, y: c.y };
    }
    const before = { unit: u, ability: def, target, cancel: false, reason: '' };
    this.emit('ability:before', before);
    if (before.cancel) throw new Error(before.reason || `${def.name} is prevented.`);
    u.hp -= def.cost.hp; u.acts -= def.cost.acts;
    for (const [key, n] of Object.entries(def.cost.resources)) u.resources[key] = (u.resources[key] ?? 0) - n;
    for (const [key, n] of Object.entries(def.cost.items)) this.useItem(key, n);
    u.uses[def.id] = (u.uses[def.id] ?? 0) + 1;
    (u.vars._used ??= {})[def.id] = toNum(u.vars._used[def.id], 0) + 1;
    if (def.cooldown > 0) u.cooldowns[def.id] = def.cooldown + 1;
    if (def.cost.acts > 0) u.moved = true;
    const at = target?.pos ?? asCoord(target) ?? u.pos;
    this.cue({ t: 'ability', unit: u.id, id: def.id, text: def.name, at: { ...at }, from: { ...u.pos }, ...(def.sound ? { tone: def.sound } : {}), params: { fx: def.fx, glyph: def.glyph } });
    this.log(`${u.name} uses ${def.name}${target?.name && target.id !== u.id ? ` on ${target.name}` : ''}.`, 'ability');
    if (def.effects.length) this.runEffects(def.effects, { source: u, target, ...(def.area ? { area: def.area } : {}) });
    if (def.use) invoke(this.reg, def.module, `ability ${def.id}.use`, () => def.use!(this, u, target));
    this.emit('ability:used', { unit: u, ability: def, target });
  }

  // ------------------------------------------------------------ objectives + phases
  private matches(u: UnitState, cond: Condition): boolean {
    if (cond.unit !== undefined) return [cond.unit].flat().some((id) => u.id === id || u.rosterId === id || u.name === id);
    if (cond.units !== undefined) return [cond.units].flat().some((id) => u.id === id || u.rosterId === id || u.name === id);
    if (cond.tag !== undefined) return u.tags.includes(String(cond.tag));
    if (cond.template !== undefined) return u.classId === cond.template;
    if (cond.faction !== undefined) return u.faction === cond.faction;
    return false;
  }
  checkCondition(cond: Condition): boolean {
    const s = this.state;
    const players = s.units.filter((u) => this.isPlayerControlled(u));
    const inArea = (u: UnitState): boolean => {
      const at = asCoord(cond.at);
      if (at) return manhattan(u.pos, at) <= toNum(cond.radius, 0);
      const a = Array.isArray(cond.area) ? cond.area.map((n: Loose) => toNum(n)) : null;
      return !!a && u.pos.x >= Math.min(a[0]!, a[2]!) && u.pos.x <= Math.max(a[0]!, a[2]!) && u.pos.y >= Math.min(a[1]!, a[3]!) && u.pos.y <= Math.max(a[1]!, a[3]!);
    };
    switch (cond.type) {
      case 'rout': {
        const foes = s.units.filter((u) => (cond.faction ? u.faction === cond.faction : players.some((p) => this.isHostile(p, u))));
        return foes.length > 0 && foes.every((u) => !u.alive);
      }
      case 'defeat': { const targets = s.units.filter((u) => this.matches(u, cond)); return targets.length > 0 && targets.every((u) => !u.alive); }
      case 'seize': case 'reach': return players.filter((u) => u.alive && (cond.by ? this.matches(u, { type: '', unit: cond.by }) : true) && inArea(u)).length >= Math.max(1, toNum(cond.count, 1));
      case 'survive': return s.round > toNum(cond.rounds ?? cond.turns, 1);
      case 'wipe': return players.length > 0 && players.every((u) => !u.alive);
      case 'protect': return s.units.filter((u) => this.matches(u, cond)).some((u) => !u.alive && !u.gone);
      case 'var': {
        const value = toNum(String(cond.key).split('.').reduce<Loose>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), s.vars), 0);
        if (cond.gte !== undefined) return value >= toNum(cond.gte);
        if (cond.lte !== undefined) return value <= toNum(cond.lte);
        if (cond.eq !== undefined) return value === toNum(cond.eq);
        return value > 0;
      }
      case 'captured': return s.result.captured.length >= Math.max(1, toNum(cond.count, 1));
      default: {
        const def = this.reg.objectives[cond.type];
        return def ? !!invoke(this.reg, def.module, `objective ${cond.type}`, () => def.check(this, cond)) : false;
      }
    }
  }
  checkOutcome(): void {
    const s = this.state;
    if (s.status !== 'ongoing') return;
    const lost = s.objective.lose.find((c) => this.checkCondition(c));
    if (lost) { this.endBattle(String(lost.outcome ?? 'defeat'), String(lost.reason ?? lost.type)); return; }
    const won = s.objective.win.find((c) => this.checkCondition(c));
    if (won) { this.endBattle(String(won.outcome ?? 'victory'), String(won.reason ?? won.type)); return; }
    if (hasHook(this.reg, 'objective:check')) {
      const ev: { outcome: string | null; reason: string } = { outcome: null, reason: '' };
      this.emit('objective:check', ev);
      if (ev.outcome) this.endBattle(ev.outcome, ev.reason);
    }
  }
  spend(u: UnitState, acts = 1): void {
    u.acts = Math.max(0, u.acts - acts); u.moved = true;
  }
  beginPhase(index: number, first = false): void {
    const s = this.state;
    s.phaseIndex = index;
    const factionId = this.phaseFaction, faction = s.factions[factionId];
    if (!first && index === 0) { s.round++; this.emit('round:start', { round: s.round }); }
    this.cue({ t: 'phase', id: factionId, text: faction?.name ?? factionId, tone: faction?.controller ?? 'ai' });
    this.log(`Round ${s.round}: ${faction?.name ?? factionId} phase.`, 'phase');
    for (const u of s.units.filter((o) => o.alive && o.faction === factionId)) {
      u.acts = u.actsPerTurn; u.moved = false; u.uses = {};
      for (const key of Object.keys(u.cooldowns)) { u.cooldowns[key] = Math.max(0, (u.cooldowns[key] ?? 0) - 1); if (!u.cooldowns[key]) delete u.cooldowns[key]; }
      if (!first) {
        for (const inst of [...u.statuses]) {
          if (!u.alive) break;
          const def = this.statusDef(inst.id);
          if (def?.tick.length) this.runEffects(def.tick, { source: this.unit(inst.source) ?? u, target: u });
          if (def?.onTick) invoke(this.reg, def.module, `status ${inst.id}.onTick`, () => def.onTick!(this, u, inst));
          this.emit('status:tick', { target: u, status: inst, def });
        }
      }
      if (u.alive && this.isBlocked(u, 'act') && this.isBlocked(u, 'move')) u.acts = 0;
      if (u.alive) this.emit('turn:start', { unit: u });
    }
    this.emit('phase:start', { faction: factionId });
    this.checkOutcome();
  }
  endPhase(): void {
    const s = this.state;
    if (s.status !== 'ongoing') return;
    const factionId = this.phaseFaction;
    for (const u of s.units.filter((o) => o.alive && o.faction === factionId)) {
      const tileId = this.tileId(u.pos), data = this.tile(u.pos), def = this.reg.tiles[tileId];
      if (data.hazard?.length) this.runEffects(data.hazard, { target: u });
      if (u.alive && def?.onEndPhase) invoke(this.reg, def.module, `tile ${tileId}.onEndPhase`, () => def.onEndPhase!(this, u));
      // A status with duration N covers N of its owner's phases, then expires as that phase ends.
      for (const inst of [...u.statuses]) if (u.alive && inst.duration > 0 && --inst.duration === 0) this.removeStatus(u, inst.id, true);
    }
    this.emit('phase:end', { faction: factionId });
    this.checkOutcome();
    if (s.status !== 'ongoing') return;
    let next = s.phaseIndex;
    for (let i = 0; i < s.order.length; i++) {
      next = (next + 1) % s.order.length;
      if (next === 0 && s.objective.turnLimit > 0 && s.round >= s.objective.turnLimit) {
        this.endBattle(s.objective.onTimeout, 'turn limit reached');
        return;
      }
      const f = s.factions[s.order[next]!];
      const active = f && f.controller !== 'none' && s.units.some((u) => u.alive && u.faction === f.id);
      if (active || next === 0) break;
    }
    this.beginPhase(next);
  }
}

// ---------------------------------------------------------------- construction

const FACTION_COLORS = ['#23657a', '#9e4536', '#7d6a2c', '#5b4a7a', '#3f7a4f', '#8a4a6b'];
const FACTION_SHAPES = ['shield', 'diamond', 'hex', 'circle', 'square', 'triangle'];

export function normalizeFaction(raw: Loose, index: number): FactionState {
  const r = raw && typeof raw === 'object' ? raw : { id: String(raw) };
  const id = slug(r.id ?? r.name, `faction-${index}`);
  const controller = r.controller === 'player' || r.controller === 'ai' || r.controller === 'none' ? r.controller : id === 'player' || id === 'party' ? 'player' : 'ai';
  const hostileTo = Array.isArray(r.hostileTo) ? r.hostileTo.map(String) : r.neutral ? [] : ['*'];
  return {
    id, name: String(r.name ?? id), controller,
    hostileTo: Array.isArray(r.alliedWith) ? hostileTo.filter((h: string) => !r.alliedWith.includes(h)) : hostileTo,
    color: typeof r.color === 'string' ? r.color : FACTION_COLORS[index % FACTION_COLORS.length]!,
    shape: typeof r.shape === 'string' ? r.shape : FACTION_SHAPES[index % FACTION_SHAPES.length]!,
    resources: {},
    ...(typeof r.ai === 'string' ? { ai: r.ai } : {}),
    ...(Array.isArray(r.alliedWith) ? { alliedWith: r.alliedWith.map(String) } : {}),
  } as FactionState;
}

export function instantiateUnit(raw: Loose, reg: Registry, id: string): UnitState {
  const r = raw && typeof raw === 'object' ? raw : {};
  const template = reg.units[String(r.template ?? r.class ?? r.classId ?? '')];
  const pick = <T>(key: string, fallback: T): T => (r[key] !== undefined ? r[key] : template ? (template as Loose)[key] ?? fallback : fallback);
  const stats: Record<string, number> = { ...(template?.stats ?? {}) };
  for (const [k, v] of Object.entries(r.stats && typeof r.stats === 'object' ? r.stats : {})) stats[k] = toNum(v, 0);
  const weaponSource: Loose[] = r.weapons !== undefined ? [r.weapons].flat() : r.weapon !== undefined ? [r.weapon] : template?.weapons ?? [];
  const weapons = weaponSource.filter((w) => w !== null && w !== undefined).map((w, i) =>
    typeof w === 'string' && reg.weapons[w] ? (stripFunctions(reg.weapons[w]!) as WeaponData) : normalizeWeapon(w, `${id}-weapon-${i}`));
  const abilities = [...new Set([...(template?.abilities ?? []), ...(Array.isArray(r.abilities) ? r.abilities.map(String) : [])])];
  const tags = [...new Set([...(template?.tags ?? []), ...(Array.isArray(r.tags) ? r.tags.map(String) : [])])];
  // With a template, `hp` alone is current HP (a wounded creature); without one it also sets the maximum.
  const maxHp = Math.max(1, Math.round(toNum(r.maxHp ?? (template ? undefined : r.hp), template?.maxHp ?? 20)));
  const pos = asCoord(r.pos) ?? { x: 0, y: 0 };
  return {
    id,
    name: String(pick('name', id)),
    title: String(pick('title', template?.name ?? '')),
    classId: String(r.classId ?? r.class ?? r.template ?? template?.id ?? 'unit'),
    faction: String(r.faction ?? 'enemy'),
    pos,
    hp: clamp(Math.round(toNum(r.hp, maxHp)), 1, maxHp),
    maxHp,
    mov: Math.max(0, Math.round(toNum(pick('mov', 4), 4))),
    moveType: String(pick('moveType', 'foot')),
    stats,
    weapons,
    equipped: 0,
    abilities,
    statuses: [],
    tags,
    vars: { ...(template?.vars ?? {}), ...(r.vars && typeof r.vars === 'object' ? structuredClone(r.vars) : {}) },
    resources: { ...(r.resources && typeof r.resources === 'object' ? r.resources : {}) },
    acts: 0,
    actsPerTurn: Math.max(1, Math.round(toNum(pick('actsPerTurn', 1), 1))),
    moved: false,
    alive: true,
    ai: String(pick('ai', '')),
    sprite: { ...(template?.sprite ?? {}), ...normalizeSprite(r.sprite) },
    level: Math.max(1, Math.round(toNum(pick('level', 1), 1))),
    uses: {},
    cooldowns: {},
    ...(typeof r.rosterId === 'string' ? { rosterId: r.rosterId } : {}),
  };
}

export function unitToRoster(u: UnitState): RosterUnit {
  return {
    id: u.rosterId ?? u.id, name: u.name, title: u.title, classId: u.classId, template: u.classId, status: 'active',
    hp: Math.max(1, u.hp), maxHp: u.maxHp, mov: u.mov, moveType: u.moveType, stats: { ...u.stats },
    weapons: structuredClone(u.weapons), abilities: [...u.abilities], tags: [...u.tags],
    vars: Object.fromEntries(Object.entries(u.vars).filter(([k]) => !k.startsWith('_'))), sprite: { ...u.sprite }, level: u.level, xp: 0, notes: '',
    ...(u.ai ? { ai: u.ai } : {}),
  };
}

function normalizeObjective(spec: Loose): ObjectiveState {
  const raw = spec.objective;
  const o = typeof raw === 'string' ? { type: raw } : raw && typeof raw === 'object' ? raw : { type: 'rout' };
  const conds = (v: Loose): Condition[] => [v].flat().filter(Boolean).map((c: Loose) => (typeof c === 'string' ? { type: c } : c)).filter((c: Loose) => c && typeof c.type === 'string');
  const win = o.win !== undefined ? conds(o.win) : o.type ? [{ ...o }] : [{ type: 'rout' }];
  const lose = [...conds(o.lose), ...conds(spec.defeat)];
  if (!lose.some((c) => c.type === 'wipe') && o.noWipe !== true) lose.push({ type: 'wipe', reason: 'the whole party is down' });
  const turnLimit = Math.max(0, Math.round(toNum(o.turnLimit ?? spec.turnLimit, 0)));
  const describe = (c: Condition): string =>
    c.text ?? ({ rout: 'Defeat every hostile', defeat: 'Defeat the marked target', seize: 'Seize the marked ground', reach: 'Reach the marked ground', survive: `Survive ${c.rounds ?? c.turns ?? '?'} rounds`, captured: `Capture ${c.count ?? 1}` } as Record<string, string>)[c.type] ?? c.type;
  return {
    text: String(o.text ?? spec.objectiveText ?? win.map(describe).join(' or ')) + (turnLimit ? ` · ${turnLimit} rounds` : ''),
    win, lose, turnLimit,
    onTimeout: String(o.onTimeout ?? spec.onTimeout ?? (win.some((c) => c.type === 'survive') ? 'victory' : 'defeat')),
  };
}

function areaFor(raw: Loose, map: BattleState['map'], playerSide: boolean): [number, number, number, number] {
  const w = map.width, h = map.height, band = Math.max(2, Math.floor(Math.min(w, h) / 4));
  if (Array.isArray(raw) && raw.length >= 4) return [toNum(raw[0]), toNum(raw[1]), toNum(raw[2]), toNum(raw[3])];
  switch (typeof raw === 'string' ? raw : playerSide ? 'west' : 'east') {
    case 'west': return [0, 0, band, h - 1];
    case 'east': return [w - 1 - band, 0, w - 1, h - 1];
    case 'north': return [0, 0, w - 1, band];
    case 'south': return [0, h - 1 - band, w - 1, h - 1];
    case 'center': case 'centre': return [Math.floor(w / 2) - band, Math.floor(h / 2) - band, Math.floor(w / 2) + band, Math.floor(h / 2) + band];
    case 'northwest': return [0, 0, band * 2, band * 2];
    case 'northeast': return [w - 1 - band * 2, 0, w - 1, band * 2];
    case 'southwest': return [0, h - 1 - band * 2, band * 2, h - 1];
    case 'southeast': return [w - 1 - band * 2, h - 1 - band * 2, w - 1, h - 1];
    default: return [0, 0, w - 1, h - 1];
  }
}

/**
 * Builds a battle from a free-form spec. Tolerant by design: unknown templates become
 * plain units, bad positions snap to the nearest free cell, missing parts get defaults.
 */
export function createBattle(spec: Loose, reg: Registry, world: WorldSeed, opts: { id?: string; seed?: number } = {}): BattleState {
  const sp = spec && typeof spec === 'object' ? spec : {};
  const seed = (toNum(sp.seed, opts.seed ?? hashString(JSON.stringify(sp).slice(0, 2000))) >>> 0) || 1;
  const map = buildMap(sp.map ?? {}, reg, seed);
  const rawFactions: Loose[] = Array.isArray(sp.factions) && sp.factions.length ? sp.factions : [
    { id: 'player', name: 'Your company', controller: 'player' }, { id: 'enemy', name: 'Opposition', controller: 'ai' },
  ];
  const factions: Record<string, FactionState> = {};
  rawFactions.forEach((f, i) => { const n = normalizeFaction(f, i); factions[n.id] = n; });
  const state: BattleState = {
    engine: ENGINE_VERSION,
    id: opts.id ?? `battle-${seed.toString(36)}`,
    title: String(sp.title ?? 'Encounter'),
    intro: String(sp.intro ?? ''),
    seed, rngPos: 0,
    mode: String(sp.mode ?? 'grid'),
    map, factions,
    order: [],
    phaseIndex: 0, round: 1, commandOrdinal: 0,
    units: [],
    objective: normalizeObjective(sp),
    rules: { critMultiplier: 3, followUpThreshold: 4, turnwheelCharges: 3, ...(world.rules ?? {}), ...(sp.rules && typeof sp.rules === 'object' ? sp.rules : {}) },
    status: 'ongoing', outcome: null, endReason: null,
    vars: { ...(sp.vars && typeof sp.vars === 'object' ? structuredClone(sp.vars) : {}) },
    world: { inventory: structuredClone(world.inventory ?? []), vars: structuredClone(world.vars ?? {}) },
    result: { captured: [], loot: [], notes: [], vars: {} },
    log: [], logSeq: 0, unitSeq: 0, fx: [], trace: null,
  };
  if (sp.abilities || sp.statuses) state.vars.__inline = { abilities: structuredClone(sp.abilities ?? {}), statuses: structuredClone(sp.statuses ?? {}) };
  const ctx = new BattleCtx(state, reg);
  const placer = makeRng({ seed: seed ^ 0x51ed270b, rngPos: 0 });
  const place = (unit: UnitState, entry: Loose): void => {
    const playerSide = factions[unit.faction]?.controller === 'player';
    const fixed = asCoord(entry.pos);
    const [x0, y0, x1, y1] = areaFor(entry.area ?? entry.anchor, map, playerSide);
    const wanted = fixed ?? { x: placer.range(Math.min(x0, x1), Math.max(x0, x1)), y: placer.range(Math.min(y0, y1), Math.max(y0, y1)) };
    const free = nearestFree(map, wanted, (x, y) => baseTileCost(tileAt(map, x, y), unit.moveType) < BLOCKED && !ctx.unitAt(x, y));
    unit.pos = free ?? { x: 0, y: 0 };
    state.units.push(unit); ctx.invalidate();
  };
  const used = new Set<string>();
  const uniqueId = (base: string): string => {
    let id = slug(base, 'unit'), n = 1;
    while (used.has(id)) id = `${slug(base, 'unit')}-${++n}`;
    used.add(id); return id;
  };
  for (const entry of Array.isArray(sp.units) ? sp.units : []) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.roster !== undefined) {
      const wanted = entry.roster === 'all' || entry.roster === 'active' || entry.roster === true ? null : [entry.roster].flat().map(String);
      const members = world.roster.filter((r) => (wanted ? wanted.includes(r.id) || wanted.includes(r.name) : r.status === 'active'));
      for (const member of members) {
        const faction = String(entry.faction ?? Object.values(factions).find((f) => f.controller === 'player')?.id ?? 'player');
        const unit = instantiateUnit({ ...member, template: member.template ?? member.classId, faction, rosterId: member.id }, reg, uniqueId(member.id));
        unit.hp = clamp(member.hp, 1, unit.maxHp);
        place(unit, entry);
      }
      continue;
    }
    const count = Math.max(1, Math.round(toNum(entry.count, 1)));
    for (let i = 0; i < count; i++) {
      const template = reg.units[String(entry.template ?? entry.class ?? '')];
      const baseName = String(entry.name ?? template?.name ?? entry.template ?? 'Unit');
      const unit = instantiateUnit({ ...entry, name: count > 1 ? `${baseName} ${i + 1}` : baseName }, reg, uniqueId(entry.id && count === 1 ? entry.id : `${entry.id ?? entry.template ?? baseName}-${i + 1}`));
      place(unit, entry);
    }
  }
  for (const u of state.units) if (!factions[u.faction]) factions[u.faction] = normalizeFaction({ id: u.faction }, Object.keys(factions).length);
  const ids = Object.keys(factions);
  state.order = Array.isArray(sp.order) && sp.order.length
    ? [...new Set([...sp.order.map(String).filter((id: string) => factions[id]), ...ids])]
    : [...ids.filter((id) => factions[id]!.controller === 'player'), ...ids.filter((id) => factions[id]!.controller !== 'player')];
  state.unitSeq = state.units.length;
  ctx.log(`${state.title}. ${state.intro}`.trim(), 'system');
  ctx.log(`Objective: ${state.objective.text}.`, 'system');
  const mode = reg.modes[state.mode];
  if (mode?.init) invoke(reg, mode.module, `mode ${mode.id}.init`, () => mode.init!(ctx, sp));
  ctx.emit('battle:start', { spec: sp });
  ctx.beginPhase(0, true);
  state.fx = [];
  return state;
}

// ---------------------------------------------------------------- commands

function requireActor(ctx: BattleCtx, id: string): UnitState {
  const u = ctx.unit(id);
  const faction = u ? ctx.state.factions[u.faction] : undefined;
  if (!u || !u.alive) throw new Error('No such unit on the field.');
  if (u.faction !== ctx.phaseFaction || faction?.controller !== 'player') throw new Error('That unit cannot be commanded right now.');
  return u;
}

function run(ctx: BattleCtx, cmd: BattleCommand): void {
  const s = ctx.state;
  if (s.status !== 'ongoing') throw new Error('The battle has already ended.');
  const controller = s.factions[ctx.phaseFaction]?.controller;
  if (cmd.type === 'retreat') { ctx.endBattle('retreat', 'the company withdraws'); return; }
  if (cmd.type === 'abort') { ctx.endBattle('aborted', 'technical abort'); return; }
  if (cmd.type === 'aiPhase') {
    if (controller === 'player') throw new Error('Not an AI phase.');
    runAiPhase(ctx);
    return;
  }
  if (cmd.type === 'custom') {
    const mode = ctx.reg.modes[s.mode], name = String(cmd.name);
    const handler = mode?.commands[name] ? { module: mode.module, fn: mode.commands[name]! } : ctx.reg.battleCommands[name];
    if (!handler) throw new Error(`Unknown battle command '${name}'.`);
    if (isFaulted(ctx.reg, handler.module)) throw new Error(`'${name}' is being repaired by a helper.`);
    invoke(ctx.reg, handler.module, `battle command ${name}`, () => handler.fn(ctx, cmd.args ?? {}), { allowRejection: true });
    ctx.checkOutcome();
    return;
  }
  if (controller !== 'player') throw new Error('Wait for the other side to finish.');
  switch (cmd.type) {
    case 'endPhase': ctx.endPhase(); return;
    case 'move': {
      const u = requireActor(ctx, cmd.unit);
      if (u.moved || u.acts <= 0) throw new Error(`${u.name} has already moved.`);
      if (ctx.isBlocked(u, 'move')) throw new Error(`${u.name} cannot move.`);
      const to = asCoord(cmd.to);
      if (!to || !ctx.move(u, to)) throw new Error('That tile is occupied, impassable or out of reach.');
      u.moved = true;
      break;
    }
    case 'attack': {
      const u = requireActor(ctx, cmd.unit), target = ctx.unit(cmd.target);
      if (!target || !target.alive) throw new Error('No such target.');
      if (u.acts <= 0) throw new Error(`${u.name} has no actions left.`);
      if (ctx.isBlocked(u, 'act') || ctx.isBlocked(u, 'attack')) throw new Error(`${u.name} cannot attack.`);
      const index = cmd.weapon !== undefined && u.weapons[cmd.weapon] ? cmd.weapon : u.equipped;
      const weapon = u.weapons[index];
      if (!weapon) throw new Error(`${u.name} has nothing to attack with.`);
      const filter = { unit: u, target, weapon, allowed: ctx.isHostile(u, target) };
      ctx.emit('target:filter', filter);
      if (!filter.allowed) throw new Error('That is not a valid target.');
      const from = asCoord(cmd.from);
      if (from && !sameCoord(from, u.pos)) {
        if (u.moved || ctx.isBlocked(u, 'move') || !ctx.move(u, from)) throw new Error('Cannot reach that attack position.');
        u.moved = true;
      }
      if (!u.alive) break;
      if (!ctx.inWeaponRange(u, target, weapon)) throw new Error('Target is out of range or out of sight.');
      ctx.attack(u, target, index);
      ctx.spend(u);
      break;
    }
    case 'ability': {
      const u = requireActor(ctx, cmd.unit);
      ctx.useAbility(u, cmd.ability, cmd.target);
      break;
    }
    case 'wait': {
      const u = requireActor(ctx, cmd.unit);
      u.acts = 0; u.moved = true;
      ctx.log(`${u.name} waits.`, 'info');
      break;
    }
    case 'equip': {
      const u = requireActor(ctx, cmd.unit);
      if (!u.weapons[cmd.weapon]) throw new Error('No such weapon.');
      u.equipped = cmd.weapon;
      break;
    }
    default: throw new Error('Unknown command.');
  }
  ctx.checkOutcome();
  if (s.status === 'ongoing' && s.factions[ctx.phaseFaction]?.controller === 'player') {
    const mine = s.units.filter((u) => u.alive && u.faction === ctx.phaseFaction);
    const anyLeft = mine.some((u) => u.acts > 0 || u.abilities.some((id) => {
      const def = ctx.abilityDef(id);
      return !!def && def.kind === 'active' && def.cost.acts === 0 && ctx.abilityBlockReason(u, def) === null;
    }));
    if (!anyLeft) ctx.endPhase();
  }
}

/** Applies one command transactionally. Module faults quarantine the module and retry. */
export function applyBattleCommand(state: BattleState, cmd: BattleCommand, reg: Registry, opts: { forced?: number[] } = {}): CommandOutcome {
  const faults: ModuleFaultInfo[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const draft = structuredClone(state);
    draft.fx = []; draft.trace = null;
    const ctx = new BattleCtx(draft, reg, opts.forced ? [...opts.forced] : undefined);
    try {
      run(ctx, cmd);
      draft.commandOrdinal++;
      return { ok: true, state: draft, error: null, faults };
    } catch (error) {
      if (error instanceof ModuleFault && !isFaulted(reg, error.moduleId)) {
        reg.faults[error.moduleId] = error.info();
        faults.push(error.info());
        continue;
      }
      return { ok: false, state, error: error instanceof Error ? error.message : String(error), faults };
    }
  }
  return { ok: false, state, error: 'Too many faulting modules; command abandoned.', faults };
}

export function hashBattle(state: BattleState): string {
  const { fx: _fx, trace: _trace, ...simulation } = state;
  return hashJson(simulation);
}

// ---------------------------------------------------------------- read models for the UI

export interface AbilityInfo {
  id: string; name: string; description: string; glyph: string; enabled: boolean; reason: string | null; target: string;
  cost: string; cells: Coord[]; unitIds: string[]; faulted: boolean;
}
export interface SelectionInfo {
  unitId: string;
  canAct: boolean;
  reachable: Coord[];
  attackCells: Coord[];
  targets: { id: string; from: Coord | null; weapon: number }[];
  abilities: AbilityInfo[];
  weapons: { index: number; name: string; kind: string; range: [number, number]; might: number; hit: number; crit: number; damageType: string; description: string }[];
}

function costText(def: AbilityDef, ctx: BattleCtx): string {
  const parts: string[] = [];
  parts.push(def.cost.acts === 0 ? 'free' : def.cost.acts === 1 ? '1 action' : `${def.cost.acts} actions`);
  if (def.cost.hp) parts.push(`${def.cost.hp} HP`);
  for (const [k, n] of Object.entries(def.cost.resources)) parts.push(`${n} ${k}`);
  for (const [k, n] of Object.entries(def.cost.items)) parts.push(`${n} × ${ctx.item(k)?.name ?? k} (${ctx.itemCount(k)} left)`);
  if (def.cooldown) parts.push(`cooldown ${def.cooldown}`);
  if (def.target === 'unit' || def.target === 'tile') parts.push(`range ${def.range[0]}–${def.range[1]}`);
  return parts.join(' · ');
}

export function describeSelection(state: BattleState, reg: Registry, unitId: string): SelectionInfo | null {
  const ctx = new BattleCtx(structuredClone(state), reg);
  ctx.simulate = true;
  const u = ctx.unit(unitId);
  if (!u || !u.alive) return null;
  try {
    const mine = state.status === 'ongoing' && u.faction === ctx.phaseFaction && ctx.isPlayerControlled(u);
    const canMove = mine && !u.moved && u.acts > 0 && !ctx.isBlocked(u, 'move');
    const canAttack = mine && u.acts > 0 && !ctx.isBlocked(u, 'act') && !ctx.isBlocked(u, 'attack');
    // Inspecting any unit (also enemies) shows its potential reach.
    const field = !mine || canMove ? ctx.reach(u) : null;
    const reachable = field ? ctx.reachable(u) : [];
    const origins = [{ ...u.pos }, ...reachable];
    const seen = new Set<number>();
    const attackCells: Coord[] = [];
    const reachSet = new Set(reachable.map((c) => c.y * state.map.width + c.x));
    for (const weapon of u.weapons) for (const o of origins) for (const c of ringCells(state.map, o, weapon.range[0], weapon.range[1])) {
      const key = c.y * state.map.width + c.x;
      if (seen.has(key) || reachSet.has(key) || tileAt(state.map, c.x, c.y).blocksMove) continue;
      seen.add(key); attackCells.push(c);
    }
    const targets: SelectionInfo['targets'] = [];
    if (canAttack || !mine) {
      for (const t of ctx.enemies(u)) {
        let best: { from: Coord | null; weapon: number; cost: number } | null = null;
        u.weapons.forEach((weapon, index) => {
          if (ctx.inWeaponRange(u, t, weapon)) { if (!best || best.cost > -1) best = { from: null, weapon: index, cost: -1 }; return; }
          if (!field || !canMove) return;
          for (const c of ringCells(state.map, t.pos, weapon.range[0], weapon.range[1])) {
            const key = c.y * state.map.width + c.x;
            if (!reachSet.has(key) || !ctx.inWeaponRange(u, t, weapon, c)) continue;
            const cost = field.dist[key]!;
            if (!best || cost < best.cost) best = { from: c, weapon: index, cost };
          }
        });
        if (best && mine) targets.push({ id: t.id, from: (best as Loose).from, weapon: (best as Loose).weapon });
      }
    }
    const abilities: AbilityInfo[] = u.abilities.map((id) => {
      const def = ctx.abilityDef(id);
      if (!def) return { id, name: id, description: 'Not defined by any loaded module.', glyph: '', enabled: false, reason: 'Undefined ability', target: 'none', cost: '', cells: [], unitIds: [], faulted: false };
      const faulted = def.module !== 'inline' && isFaulted(reg, def.module);
      const reason = def.kind === 'passive' ? 'Passive' : !mine ? 'Not this unit’s phase' : ctx.abilityBlockReason(u, def);
      const options = def.kind === 'active' && !faulted ? ctx.abilityTargets(u, def) : { cells: [], unitIds: [] };
      const noTarget = !reason && (def.target === 'unit' || def.target === 'tile') && options.cells.length === 0;
      return {
        id, name: def.name, description: def.description, glyph: def.glyph, target: def.kind === 'passive' ? 'passive' : def.target,
        enabled: !reason && !noTarget, reason: reason ?? (noTarget ? 'No valid target in range' : null), cost: def.kind === 'passive' ? 'passive' : costText(def, ctx),
        cells: options.cells, unitIds: options.unitIds, faulted,
      };
    });
    return {
      unitId, canAct: mine && u.acts > 0, reachable: canMove || !mine ? reachable : [], attackCells, targets, abilities,
      weapons: u.weapons.map((w, index) => ({ index, name: w.name, kind: w.kind, range: w.range, might: w.might, hit: w.hit, crit: w.crit, damageType: w.damageType, description: w.description })),
    };
  } catch (error) {
    if (error instanceof ModuleFault) reg.faults[error.moduleId] ??= error.info();
    return { unitId, canAct: false, reachable: [], attackCells: [], targets: [], abilities: [], weapons: [] };
  }
}

export interface ForecastSide { name: string; weapon: string; damage: number; hit: number; crit: number; strikes: number; hp: number; maxHp: number }
export interface Forecast { attacker: ForecastSide; defender: ForecastSide | null; target: { name: string; hp: number; maxHp: number }; notes: string[] }

/** Dry combat forecast. Runs on a clone and consumes no randomness. */
export function forecastAttack(state: BattleState, reg: Registry, attackerId: string, targetId: string, weaponIndex?: number, from?: Coord | null): Forecast | null {
  const ctx = new BattleCtx(structuredClone(state), reg);
  ctx.simulate = true;
  try {
    const a = ctx.unit(attackerId), b = ctx.unit(targetId);
    if (!a || !b) return null;
    if (from) { a.pos = { ...from }; ctx.invalidate(); }
    const weapon = a.weapons[weaponIndex ?? a.equipped] ?? a.weapons[0];
    if (!weapon) return null;
    const numbers = ctx.combat(a, b, weapon);
    const counter = ctx.counterWeapon(b, a);
    const follow = ctx.followUp(a, weapon, b, ctx.weaponOf(b));
    const back = counter ? ctx.combat(b, a, counter) : null;
    return {
      attacker: { name: a.name, weapon: weapon.name, damage: numbers.damage, hit: numbers.hit, crit: numbers.crit, strikes: follow === 'attacker' ? 2 : 1, hp: a.hp, maxHp: a.maxHp },
      defender: back && counter ? { name: b.name, weapon: counter.name, damage: back.damage, hit: back.hit, crit: back.crit, strikes: follow === 'defender' ? 2 : 1, hp: b.hp, maxHp: b.maxHp } : null,
      target: { name: b.name, hp: b.hp, maxHp: b.maxHp },
      notes: [...numbers.notes, ...(back?.notes ?? []).map((n) => `Counter: ${n}`), ...(weapon.area ? [`Area ${weapon.area.shape} ${weapon.area.size}`] : []), ...(!counter ? ['No counterattack'] : [])],
    };
  } catch (error) {
    if (error instanceof ModuleFault) reg.faults[error.moduleId] ??= error.info();
    return null;
  }
}

/** Every cell a hostile-to-the-player unit could strike next phase. */
export function threatCells(state: BattleState, reg: Registry): Coord[] {
  const ctx = new BattleCtx(structuredClone(state), reg);
  ctx.simulate = true;
  const seen = new Set<number>(), out: Coord[] = [];
  try {
    const players = ctx.units((u) => ctx.isPlayerControlled(u));
    for (const u of ctx.units((o) => !ctx.isPlayerControlled(o) && players.some((p) => ctx.isHostile(p, o)))) {
      if (!u.weapons.length) continue;
      const origins = [{ ...u.pos }, ...ctx.reachable(u)];
      for (const weapon of u.weapons) for (const o of origins) for (const c of ringCells(state.map, o, weapon.range[0], weapon.range[1])) {
        const key = c.y * state.map.width + c.x;
        if (seen.has(key) || tileAt(state.map, c.x, c.y).blocksMove) continue;
        seen.add(key); out.push(c);
      }
    }
  } catch (error) {
    if (error instanceof ModuleFault) reg.faults[error.moduleId] ??= error.info();
  }
  return out;
}

export function summarizeBattle(state: BattleState): string {
  const fallen = state.units.filter((u) => !u.alive && !u.gone);
  const byFaction = Object.values(state.factions).map((f) => {
    const all = state.units.filter((u) => u.faction === f.id);
    return `${f.name}: ${all.filter((u) => u.alive).length}/${all.length} standing`;
  });
  return [
    `${state.title} — ${state.outcome ?? 'ongoing'} (${state.endReason ?? ''}) after ${state.round} round(s).`,
    byFaction.join('; ') + '.',
    fallen.length ? `Fallen: ${fallen.slice(0, 24).map((u) => u.name).join(', ')}${fallen.length > 24 ? '…' : ''}.` : '',
    state.result.captured.length ? `Captured: ${state.result.captured.map((c: Loose) => c.name).join(', ')}.` : '',
    state.result.loot.length ? `Loot: ${state.result.loot.map((l) => `${l.name} ×${l.qty}`).join(', ')}.` : '',
    ...state.result.notes,
  ].filter(Boolean).join(' ');
}
