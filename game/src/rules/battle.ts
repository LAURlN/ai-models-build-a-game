import { Either } from 'effect';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MAX_TURNS,
  RULES_VERSION,
  decodeEngineCommand,
  type BattleSnapshot,
  type BattleState,
  type CombatForecast,
  type Coord,
  type EnemyPhaseStep,
  type EngineCommand,
  type StrikeTrace,
  type UnitState,
  type Weapon,
} from '../shared/contracts';
import { RootFault, RULES, damage, emit, hash, integer, safeInteger, log, rootContext, tick, type RootContext, type RulePack } from './ir';

export type CommandResult =
  | { ok: true; state: BattleState; events: BattleState['events'] }
  | { ok: false; state: BattleState; error: string; fault?: { definitionIds: string[] } };

const NEIGHBORS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
export const manhattan = (a: Coord, b: Coord): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const sameCoord = (a: Coord, b: Coord): boolean => a.x === b.x && a.y === b.y;
export const isInBounds = (s: BattleState, c: Coord): boolean =>
  Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < s.boardWidth && c.y < s.boardHeight;
export const getLivingUnitAt = (s: BattleState, c: Coord): UnitState | undefined => s.units.find(u => u.alive && sameCoord(u.pos, c));
export const terrainAt = (s: BattleState, c: Coord) => s.terrain[c.y]![c.x]!;

const weapons: Record<string, Weapon> = {
  sword: { id: 'brass_sword', tag: 'sword', might: 5, weight: 4, hit: 90, crit: 4, minRange: 1, maxRange: 1, damageType: 'physical', lineOfSight: false },
  axe: { id: 'iron_axe', tag: 'axe', might: 6, weight: 9, hit: 75, crit: 0, minRange: 1, maxRange: 1, damageType: 'physical', lineOfSight: false },
  bow: { id: 'ward_bow', tag: 'bow', might: 5, weight: 5, hit: 85, crit: 5, minRange: 2, maxRange: 2, damageType: 'physical', lineOfSight: true },
  tome: { id: 'ember', tag: 'tome', might: 4, weight: 3, hit: 90, crit: 0, minRange: 1, maxRange: 2, damageType: 'magical', lineOfSight: true },
  lance: { id: 'iron_lance', tag: 'lance', might: 5, weight: 7, hit: 85, crit: 0, minRange: 1, maxRange: 1, damageType: 'physical', lineOfSight: false },
};

export function createInitialBattleState(seed = 1): BattleState {
  integer(seed);
  const rows = ['..........', '....##....', '..cc......', '....#..cc.', '.c..#.....', '.c.....#..', '...cc..#..', '.....c....', '..##......', '..........'];
  const terrain = rows.map(row => [...row].map(c => c === '#' ? 'wall' as const : c === 'c' ? 'cover' as const : 'plain' as const));
  const unit = (id: string, name: string, faction: UnitState['faction'], x: number, y: number, weapon: string, hp: number, str: number, spd: number): UnitState => ({
    id, name, title: weapon === 'bow' ? 'Longbow Scout' : weapon === 'tome' ? 'Ember Scholar' : weapon === 'axe' ? 'Iron Raider' : 'Brass Vanguard',
    classId: weapon, faction, pos: { x, y }, hp, maxHp: hp, str, mag: weapon === 'tome' ? str : 2, skl: faction === 'player' ? 9 : 5,
    spd, lck: faction === 'player' ? 5 : 2, def: faction === 'player' ? 6 : 4, res: weapon === 'tome' ? 7 : 3, mov: weapon === 'axe' ? 3 : 4,
    weapon: structuredClone(weapons[weapon]!), abilities: id === 'player_vanguard' ? ['borrowed_second'] : [], statuses: [], counters: {},
    actionCredits: 1, bonusCredits: 0, phaseUses: {}, hasMoved: false, hasActed: false, alive: true,
  });
  const state: BattleState = {
    rulesVersion: RULES_VERSION, seed, boardWidth: BOARD_WIDTH, boardHeight: BOARD_HEIGHT, terrain,
    turn: 1, maxTurns: MAX_TURNS, phase: 'player', phaseOrdinal: 1, phaseCommands: 0, status: 'ongoing', endReason: null,
    selectedUnitId: null, commandOrdinal: 0, rngPosition: 0, listenerCounts: {}, events: [],
    units: [unit('player_vanguard', 'Alden', 'player', 1, 2, 'sword', 32, 13, 12),
      unit('player_archer', 'Mira', 'player', 1, 4, 'bow', 26, 12, 11),
      unit('player_mage', 'Iona', 'player', 0, 3, 'tome', 25, 11, 9),
      unit('player_guard', 'Bram', 'player', 0, 5, 'lance', 36, 13, 7),
      unit('enemy_raider', 'Vex', 'enemy', 4, 2, 'axe', 25, 9, 6),
      unit('enemy_archer', 'Sable', 'enemy', 6, 3, 'bow', 23, 9, 8),
      unit('enemy_mage', 'Cinder', 'enemy', 6, 5, 'tome', 22, 9, 7),
      unit('enemy_guard', 'Rook', 'enemy', 7, 7, 'lance', 29, 10, 6),
      unit('enemy_raider_2', 'Flint', 'enemy', 5, 8, 'axe', 27, 10, 6)],
  };
  log(state, 'system', `Brass Ward: rout five enemies within ${MAX_TURNS} turns. Cover: +2 defense, +20 avoid; dark walls block movement and sight.`);
  return state;
}

interface Node { coord: Coord; dist: number; path: Coord[] }
function reachable(s: BattleState, u: UnitState): Node[] {
  if (!u.alive || (u.hasMoved && u.bonusCredits === 0) || u.actionCredits === 0 || s.status !== 'ongoing') return [];
  const queue: Node[] = [{ coord: u.pos, dist: 0, path: [] }], distances = new Map<string, number>([[`${u.pos.x},${u.pos.y}`, 0]]), result: Node[] = [];
  while (queue.length) {
    queue.sort((a, b) => a.dist - b.dist); // stable sort preserves N/E/S/W path ties
    const n = queue.shift()!;
    if (n.dist !== distances.get(`${n.coord.x},${n.coord.y}`)) continue;
    if (n.dist && !getLivingUnitAt(s, n.coord)) result.push(n);
    for (const d of NEIGHBORS) {
      const c = { x: n.coord.x + d.x, y: n.coord.y + d.y };
      if (!isInBounds(s, c) || terrainAt(s, c) === 'wall') continue;
      const occupant = getLivingUnitAt(s, c);
      if (occupant && occupant.faction !== u.faction) continue;
      const distance = n.dist + (terrainAt(s, c) === 'cover' ? 2 : 1), key = `${c.x},${c.y}`;
      if (distance > u.mov || distance >= (distances.get(key) ?? Infinity)) continue;
      distances.set(key, distance); queue.push({ coord: c, dist: distance, path: [...n.path, c] });
    }
  }
  return result.sort((a, b) => a.coord.y - b.coord.y || a.coord.x - b.coord.x);
}
export function computeReachableTiles(s: BattleState, id: string): Coord[] {
  const u = s.units.find(u => u.id === id);
  return u ? reachable(s, u).map(n => n.coord) : [];
}

// Supercover sight: a diagonal ray touching a wall corner is blocked, consistently in both directions.
function visible(s: BattleState, a: Coord, b: Coord): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, nx = Math.abs(dx), ny = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
  let x = a.x, y = a.y, ix = 0, iy = 0;
  const blocked = (x: number, y: number) => terrainAt(s, { x, y }) === 'wall';
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) { if (blocked(x + sx, y) || blocked(x, y + sy)) return false; x += sx; y += sy; ix++; iy++; }
    else if (decision < 0) { x += sx; ix++; } else { y += sy; iy++; }
    if (blocked(x, y)) return false;
  }
  return true;
}

export function inRange(s: BattleState, a: UnitState, b: UnitState): boolean {
  const d = manhattan(a.pos, b.pos);
  return d >= a.weapon.minRange && d <= a.weapon.maxRange && (!a.weapon.lineOfSight || visible(s, a.pos, b.pos));
}

function blockedAction(u: UnitState, pack: RulePack): boolean {
  return u.statuses.some(st => pack[st.definitionId]?.activationPolicy === 'blockOrdinaryAction');
}

export function computeAttackableTargetIds(s: BattleState, id: string): string[] {
  const u = s.units.find(u => u.id === id);
  const pack = s.rulePack ?? RULES;
  return s.status === 'ongoing' && u?.alive && u.actionCredits > 0 && !blockedAction(u, pack)
    ? s.units.filter(t => t.alive && t.faction !== u.faction && inRange(s, u, t)).map(t => t.id).sort()
    : [];
}

export function computeFactionThreatTiles(s: BattleState, faction: UnitState['faction']): Coord[] {
  const seen = new Set<string>();
  const coords: Coord[] = [];
  for (const unit of s.units) {
    if (!unit.alive || unit.faction !== faction) continue;
    const origins = [
      unit.pos,
      ...reachable(s, { ...unit, hasMoved: false, actionCredits: Math.max(1, unit.actionCredits) }).map(n => n.coord),
    ];
    for (const origin of origins) {
      for (let y = 0; y < s.boardHeight; y++) {
        for (let x = 0; x < s.boardWidth; x++) {
          const target = { x, y };
          if (terrainAt(s, target) === 'wall') continue;
          const d = manhattan(origin, target);
          if (d < unit.weapon.minRange || d > unit.weapon.maxRange) continue;
          if (unit.weapon.lineOfSight && !visible(s, origin, target)) continue;
          const key = `${x},${y}`;
          if (!seen.has(key)) {
            seen.add(key);
            coords.push(target);
          }
        }
      }
    }
  }
  return coords;
}

export const attackSpeed = (u: UnitState): number => integer(u.spd - Math.max(0, u.weapon.weight - u.str));
export function advantage(a: Weapon, b: Weapon): number {
  const beats: Record<string, string> = { sword: 'axe', axe: 'lance', lance: 'sword' };
  return beats[a.tag] === b.tag ? 1 : beats[b.tag] === a.tag ? -1 : 0;
}
export function combatNumbers(s: BattleState, a: UnitState, b: UnitState) {
  const adv = advantage(a.weapon, b.weapon), cover = terrainAt(s, b.pos) === 'cover';
  const baseDamage = safeInteger(Math.max(0, (a.weapon.damageType === 'physical' ? a.str : a.mag) + a.weapon.might + adv - (a.weapon.damageType === 'physical' ? b.def : b.res) - (cover ? 2 : 0)), true);
  const clamp = (n: number) => Math.max(0, Math.min(10000, safeInteger(n)));
  return {
    baseDamage,
    hitBP: clamp(100 * a.weapon.hit + 200 * a.skl + 100 * a.lck - 200 * attackSpeed(b) - 100 * b.lck - (cover ? 2000 : 0) + 1500 * adv),
    critBP: clamp(100 * a.weapon.crit + 100 * Math.floor(a.skl / 2) - 100 * b.lck),
  };
}

export interface ResolveOptions { pack?: RulePack; fuel?: number; rolls?: number[] }
type Roller = (bp: number, effectId: string) => number;
function random(ctx: RootContext, bp: number, effectId: string, override?: Roller): boolean {
  tick(ctx);
  const s = ctx.state;
  const draw = s.rngPosition++;
  integer(s.rngPosition, true);
  const value = override ? override(bp, effectId) : parseInt(hash([s.seed, s.commandOrdinal, effectId, draw]).slice(0, 8), 16) % 10000;
  if (!Number.isInteger(value) || value < 0 || value >= 10000) throw new Error('Invalid random fixture');
  return value < bp;
}
function spend(u: UnitState): void {
  if (u.actionCredits === u.bonusCredits) u.bonusCredits--;
  u.actionCredits--;
  u.hasActed = u.actionCredits === 0;
  u.hasMoved = true;
}
function exchange(ctx: RootContext, attackerId: string, targetId: string, roller?: Roller): StrikeTrace[] {
  const s = ctx.state, a = s.units.find(u => u.id === attackerId)!, b = s.units.find(u => u.id === targetId)!;
  if (!a.alive || a.actionCredits < 1 || !b.alive || a.faction === b.faction || !inRange(s, a, b) || blockedAction(a, ctx.pack)) {
    throw new Error('Invalid attack or target range');
  }
  spend(a);
  const order: { actor: UnitState; target: UnitState; role: StrikeTrace['role'] }[] = [{ actor: a, target: b, role: 'initial' }, { actor: b, target: a, role: 'counter' }];
  if (attackSpeed(a) - attackSpeed(b) >= 4) order.push({ actor: a, target: b, role: 'follow-up' });
  else if (attackSpeed(b) - attackSpeed(a) >= 4) order.push({ actor: b, target: a, role: 'follow-up' });
  const trace: StrikeTrace[] = [];
  for (const [index, { actor, target, role }] of order.entries()) {
    if (!actor.alive || !target.alive || !inRange(s, actor, target) || (actor.id === b.id && blockedAction(b, ctx.pack))) continue;
    const numbers = combatNumbers(s, actor, target), hpBefore = target.hp;
    const hit = random(ctx, numbers.hitBP, `${a.id}/${b.id}/${index}/hit`, roller);
    const crit = hit && random(ctx, numbers.critBP, `${a.id}/${b.id}/${index}/crit`, roller);
    const outcome = !hit ? 'miss' : crit ? 'crit' : 'hit';
    log(s, 'attack', `${actor.name} → ${target.name}: ${role} ${outcome}; hit ${numbers.hitBP / 100}%, crit ${numbers.critBP / 100}%.`);
    if (hit) damage(ctx, actor.id, target.id, safeInteger(numbers.baseDamage * (crit ? 3 : 1), true));
    trace.push({ actorId: actor.id, targetId: target.id, role, ...numbers, outcome, hpBefore, hpAfter: target.hp });
  }
  return trace;
}

class NeedBranch extends Error {}
export function forecastCombat(state: BattleState, attackerId: string, targetId: string, pack = state.rulePack ?? RULES): CombatForecast {
  const branches: CombatForecast['branches'] = [];
  const explore = (choices: boolean[]): void => {
    const s = structuredClone(state), ctx = rootContext(s, pack); let index = 0;
    try {
      const strikes = exchange(ctx, attackerId, targetId, bp => {
        if (bp === 0) return 9999; if (bp === 10000) return 0;
        if (index >= choices.length) throw new NeedBranch();
        return choices[index++] ? 0 : 9999;
      });
      branches.push({ label: strikes.map(t => `${t.role} ${t.outcome}`).join(' → '), hp: Object.fromEntries(s.units.map(u => [u.id, u.hp])), strikes, triggers: ctx.triggers });
    } catch (error) {
      if (!(error instanceof NeedBranch)) throw error;
      explore([...choices, false]); explore([...choices, true]);
    }
  };
  explore([]);
  return {
    attackerId,
    targetId,
    branches,
    cost: '1 action; ends ordinary movement',
    liabilities: state.units
      .find(u => u.id === attackerId)!
      .statuses.map(st => `${pack[st.definitionId]!.name}: ${pack[st.definitionId]!.rulesText} Absolute expiry phase ${st.expiry}.`),
  };
}

function outcome(s: BattleState): void {
  if (s.status !== 'ongoing') return;
  const objective = s.objectiveType ?? 'rout';
  if (!s.units.some(u => u.alive && u.faction === 'player')) {
    s.status = 'defeat'; s.endReason = 'all_allies_defeated';
  } else if (
    objective === 'seize' &&
    s.seizeTile &&
    s.units.some(u => u.alive && u.faction === 'player' && sameCoord(u.pos, s.seizeTile!))
  ) {
    s.status = 'victory'; s.endReason = 'objective_seized';
  } else if (objective === 'rout' && !s.units.some(u => u.alive && u.faction === 'enemy')) {
    s.status = 'victory'; s.endReason = 'all_enemies_defeated';
  } else if (s.phaseOrdinal > s.maxTurns * 2) {
    s.status = 'defeat'; s.endReason = 'expiry';
  }
  if (s.status !== 'ongoing') {
    s.selectedUnitId = null;
    log(s, 'outcome', `${s.status === 'victory' ? 'Victory' : 'Defeat'}: ${s.endReason}.`);
  }
}

function beginPhase(ctx: RootContext, phase: BattleState['phase'], traceOut?: EnemyPhaseStep[]): void {
  const s = ctx.state; s.phase = phase; s.phaseOrdinal++; s.phaseCommands = 0; s.selectedUnitId = null; s.listenerCounts = {};
  if (phase === 'player') s.turn++;
  for (const u of s.units.filter(u => u.alive && u.faction === phase)) {
    u.actionCredits = 1; u.bonusCredits = 0; u.hasMoved = false; u.hasActed = false; u.phaseUses = {};
    for (const status of [...u.statuses]) if (status.expiry <= s.phaseOrdinal) {
      const hpBefore = u.hp;
      const triggerBase = ctx.triggers.length;
      u.statuses = u.statuses.filter(st => st.id !== status.id);
      emit(ctx, { hook: 'statusExpiry', actorId: u.id, targetId: u.id, status: structuredClone(status), depth: 0 });
      if (traceOut) {
        const delta = hpBefore - u.hp;
        const defName = ctx.pack[status.definitionId]?.name ?? status.definitionId;
        traceOut.push({
          id: `status:${u.id}:${status.id}`,
          kind: 'status',
          actorId: u.id,
          actorName: u.name,
          triggers: ctx.triggers.slice(triggerBase),
          hpAfter: u.hp,
          summary: delta > 0
            ? `${defName} expires on ${u.name}, dealing ${delta} damage (${u.hp}/${u.maxHp} HP).`
            : `${defName} expires on ${u.name}.`,
        });
      }
    }
    if (blockedAction(u, ctx.pack)) { u.actionCredits = 0; u.hasActed = true; }
  }
  log(s, 'phase', `Turn ${s.turn}: ${phase} phase (ordinal ${s.phaseOrdinal}).`);
}

function move(s: BattleState, u: UnitState, node: Node): void {
  if (u.hasMoved) { u.bonusCredits--; u.actionCredits--; u.hasActed = u.actionCredits === 0; }
  for (const c of node.path) u.pos = { ...c }; // ordered path retained by the movement search
  u.hasMoved = true; log(s, 'move', `${u.name} moves to (${u.pos.x}, ${u.pos.y}).`);
}

function enemyPhase(ctx: RootContext, roller?: Roller): void {
  const s = ctx.state;
  const trace: EnemyPhaseStep[] = [];
  let stepIndex = 0;

  for (const id of s.units.filter(u => u.alive && u.faction === 'enemy').map(u => u.id).sort()) {
    tick(ctx);
    const u = s.units.find(u => u.id === id)!;
    if (!u.alive || !s.units.some(t => t.alive && t.faction === 'player')) continue;
    const nodes = [{ coord: u.pos, dist: 0, path: [] }, ...reachable(s, u)], targets = s.units.filter(t => t.alive && t.faction === 'player');
    const candidates = nodes.flatMap(n => targets.filter(t => inRange(s, { ...u, pos: n.coord }, t)).map(t => {
      const stats = combatNumbers(s, u, t);
      return { n, t, score: (stats.baseDamage >= t.hp ? 100000 : 0) + Math.floor(stats.baseDamage * stats.hitBP / 100) - t.hp * 2 - n.dist };
    })).sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id) || a.n.coord.y - b.n.coord.y || a.n.coord.x - b.n.coord.x);
    const best = candidates[0];
    if (best) {
      if (best.n.path.length) {
        const from = { ...u.pos };
        move(s, u, best.n);
        trace.push({
          id: `enemy:${stepIndex++}:move:${u.id}`,
          kind: 'move',
          actorId: u.id,
          actorName: u.name,
          from,
          to: { ...u.pos },
          path: best.n.path.map(c => ({ ...c })),
          hpAfter: u.hp,
          summary: `${u.name} advances to (${u.pos.x}, ${u.pos.y}).`,
        });
      }
      const triggerBase = ctx.triggers.length;
      const strikes = exchange(ctx, id, best.t.id, roller);
      const triggers = ctx.triggers.slice(triggerBase);
      const firstStrike = strikes[0];
      const totalDmg = strikes
        .filter(st => st.actorId === u.id && st.outcome !== 'miss')
        .reduce((acc, st) => acc + (st.hpBefore - st.hpAfter), 0);
      trace.push({
        id: `enemy:${stepIndex++}:attack:${u.id}`,
        kind: 'attack',
        actorId: u.id,
        actorName: u.name,
        targetId: best.t.id,
        targetName: best.t.name,
        strikes,
        triggers,
        hpAfter: u.hp,
        targetHpAfter: best.t.hp,
        summary: firstStrike
          ? `${u.name} strikes ${best.t.name} (${strikes.map(st => st.outcome).join('/')}, ${totalDmg} dmg → ${best.t.hp}/${best.t.maxHp} HP).`
          : `${u.name} engages ${best.t.name}.`,
      });
    } else {
      nodes.sort((a, b) => Math.min(...targets.map(t => manhattan(a.coord, t.pos))) - Math.min(...targets.map(t => manhattan(b.coord, t.pos))) || a.dist - b.dist || a.coord.y - b.coord.y || a.coord.x - b.coord.x);
      const destNode = nodes[0]!;
      const from = { ...u.pos };
      move(s, u, destNode);
      spend(u);
      trace.push({
        id: `enemy:${stepIndex++}:move:${u.id}`,
        kind: 'move',
        actorId: u.id,
        actorName: u.name,
        from,
        to: { ...u.pos },
        path: destNode.path.map(c => ({ ...c })),
        hpAfter: u.hp,
        summary: destNode.path.length
          ? `${u.name} repositions to (${u.pos.x}, ${u.pos.y}).`
          : `${u.name} holds position at (${u.pos.x}, ${u.pos.y}).`,
      });
    }
  }
  // Horizon is tested before opening another phase (expiry effects cannot extend it).
  outcome(s);
  if (s.status === 'ongoing') {
    if (s.turn >= s.maxTurns) { s.phaseOrdinal++; outcome(s); }
    else beginPhase(ctx, 'player', trace);
  }
  s.enemyPhaseTrace = trace;
}

export function applyCommand(state: BattleState, input: EngineCommand, options: ResolveOptions = {}): CommandResult {
  const decoded = decodeEngineCommand(input);
  if (Either.isLeft(decoded)) return { ok: false, state, error: 'Invalid command payload.' };
  const command = decoded.right;
  if (state.status !== 'ongoing') return { ok: false, state, error: 'Battle has already ended.' };
  const s = structuredClone(state);
  if (command.type !== 'SELECT_UNIT') {
    delete s.enemyPhaseTrace;
  }
  const ctx = rootContext(s, options.pack ?? s.rulePack ?? RULES, options.fuel ?? 4096);
  let rollIndex = 0;
  const roller = options.rolls ? () => { const n = options.rolls![rollIndex++]; if (n === undefined) throw new Error('Random fixture exhausted'); return n; } : undefined;
  try {
    if (command.type === 'CONCEDE' || command.type === 'TECHNICAL_ABORT') {
      s.status = 'defeat'; s.endReason = command.type === 'CONCEDE' ? 'concede' : 'technical_abort'; s.selectedUnitId = null; log(s, 'outcome', `Defeat: ${s.endReason}.`);
    } else if (command.type === 'RUN_ENEMY_PHASE') {
      if (s.phase !== 'enemy') throw new Error('Not enemy phase');
      enemyPhase(ctx, roller);
    } else {
      if (s.phase !== 'player') throw new Error('Not player phase');
      if (command.type === 'SELECT_UNIT') {
        const u = s.units.find(u => u.id === command.unitId);
        if (command.unitId !== null && (!u?.alive || u.faction !== 'player')) throw new Error('Invalid selection');
        s.selectedUnitId = command.unitId; return { ok: true, state: s, events: [] };
      }
      if (command.type === 'END_PHASE') beginPhase(ctx, 'enemy');
      else {
        const id = command.type === 'ATTACK_UNIT' ? command.attackerId : command.unitId;
        const u = s.units.find(u => u.id === id);
        if (!u?.alive || u.faction !== 'player') throw new Error('Invalid player unit');
        if (command.type === 'USE_ABILITY') {
          const d = ctx.pack[command.abilityId];
          if (!d || d.kind !== 'active' || !u.abilities.includes(d.id) || (u.phaseUses[d.useKey] ?? 0) >= d.usesPerPhase || u.hp < d.costs.hp || u.actionCredits < d.costs.actions) {
            throw new Error('Ability unavailable or costs cannot be paid');
          }
          u.hp -= d.costs.hp; u.alive = u.hp > 0; u.actionCredits -= d.costs.actions; u.phaseUses[d.useKey] = (u.phaseUses[d.useKey] ?? 0) + 1;
          emit(ctx, { hook: 'useActive', actorId: u.id, targetId: u.id, definitionId: d.id, depth: 0 });
          u.hasActed = u.actionCredits === 0;
        } else {
          if (u.actionCredits < 1 || blockedAction(u, ctx.pack)) throw new Error('Unit has no action credits');
          if (command.type === 'ATTACK_UNIT') exchange(ctx, u.id, command.targetId, roller);
          else if (command.type === 'WAIT_UNIT') { spend(u); log(s, 'phase', `${u.name} waits.`); }
          else if (command.type === 'MOVE_UNIT') {
            const occupant = getLivingUnitAt(s, command.to);
            if (occupant?.faction === 'enemy') exchange(ctx, u.id, occupant.id, roller);
            else {
              const node = reachable(s, u).find(n => sameCoord(n.coord, command.to));
              if (!node) throw new Error('Tile is occupied, impassable or outside movement range');
              move(s, u, node); s.selectedUnitId = u.id;
            }
          }
        }
      }
    }
    outcome(s);
    s.commandOrdinal = integer(s.commandOrdinal + 1, true); s.phaseCommands++;
    if (s.status === 'ongoing' && s.phase === 'player') {
      const exhausted = s.units.filter(u => u.alive && u.faction === 'player').every(u =>
        u.actionCredits === 0 && !u.abilities.some(id => { const d = ctx.pack[id]!; return u.hp >= d.costs.hp && (u.phaseUses[d.useKey] ?? 0) < d.usesPerPhase; }));
      if (exhausted || s.phaseCommands >= 512) beginPhase(ctx, 'enemy');
    }
    return { ok: true, state: s, events: s.events.slice(state.events.length) };
  } catch (error) {
    return {
      ok: false,
      state,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof RootFault ? { fault: { definitionIds: error.definitionId ? [error.definitionId] : Object.keys(ctx.pack) } } : {}),
    };
  }
}

export function computeStateHash(s: BattleState): string {
  const { selectedUnitId: _, enemyPhaseTrace: __, ...simulation } = s;
  return hash(simulation);
}

export function buildSnapshot(state: BattleState, lastError: string | null = null): BattleSnapshot {
  const selected = state.status === 'ongoing' && state.phase === 'player' ? state.selectedUnitId : null;
  return {
    revision: 0,
    state,
    lastError,
    stateHash: computeStateHash(state),
    reachableTiles: selected ? computeReachableTiles(state, selected) : [],
    attackableTargetIds: selected ? computeAttackableTargetIds(state, selected) : [],
    rewindsLeft: 3,
    canRewind: false,
    hasSave: false,
  };
}
