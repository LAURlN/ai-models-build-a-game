/**
 * Built-in battlefield AI. Never calls a model. Generated modules replace or bend it:
 *  - api.defineAi({ id, plan(ctx, unit) })  → full control for units/factions using that profile
 *  - api.on('ai:plan', ev => { ev.plan = … }) → override a single decision
 *  - api.on('ai:score', ev => { ev.score += … }) → nudge the default scoring
 *  - ability.ai(ctx, unit) → let the default AI consider an ability
 */
import type { BattleCtx } from './battle';
import { BLOCKED, manhattan, pathField, pathTo, ringCells, sameCoord } from './grid';
import { hasHook, invoke } from './registry';
import type { BattleState, Coord, Loose, TraceStep, UnitDelta, UnitState } from './types';

interface Candidate { cell: Coord; cost: number; score: number; kind: 'attack' | 'ability'; targetId?: string; weapon?: number; ability?: string; target?: Loose }

type Snapshot = Map<string, string>;
const signature = (u: UnitState): string => `${u.hp}|${u.pos.x},${u.pos.y}|${u.alive}|${u.gone ?? ''}|${u.statuses.map((s) => `${s.id}${s.stacks}${s.duration}`).join(',')}`;
function snapshot(state: BattleState): Snapshot { return new Map(state.units.map((u) => [u.id, signature(u)])); }
function deltas(before: Snapshot, state: BattleState): UnitDelta[] {
  return state.units.filter((u) => before.get(u.id) !== signature(u)).map((u) => ({
    id: u.id, hp: u.hp, pos: { ...u.pos }, alive: u.alive, statuses: structuredClone(u.statuses), acts: u.acts, ...(u.gone ? { gone: u.gone } : {}),
  }));
}

function executePlan(ctx: BattleCtx, u: UnitState, plan: Loose): string {
  if (!plan || typeof plan !== 'object') return `${u.name} holds.`;
  const parts: string[] = [];
  const move = plan.move && typeof plan.move === 'object' ? { x: Math.round(plan.move.x ?? plan.move[0]), y: Math.round(plan.move.y ?? plan.move[1]) } : null;
  if (move && !sameCoord(move, u.pos) && !u.moved && !ctx.isBlocked(u, 'move') && ctx.move(u, move)) parts.push(`moves to (${u.pos.x}, ${u.pos.y})`);
  if (u.alive && plan.ability && u.abilities.includes(String(plan.ability))) {
    try { ctx.useAbility(u, String(plan.ability), plan.target); parts.push(`uses ${ctx.abilityDef(String(plan.ability))?.name ?? plan.ability}`); }
    catch (error) { if ((error as Loose)?.moduleId) throw error; }
  } else if (u.alive && plan.attack) {
    const target = ctx.unit(plan.attack);
    const index = typeof plan.weapon === 'number' && u.weapons[plan.weapon] ? plan.weapon : u.equipped;
    const weapon = u.weapons[index];
    if (target?.alive && weapon && !ctx.isBlocked(u, 'act') && !ctx.isBlocked(u, 'attack') && ctx.inWeaponRange(u, target, weapon)) {
      const strikes = ctx.attack(u, target, index);
      const dealt = strikes.filter((s: Loose) => s.actor === u.id).reduce((n: number, s: Loose) => n + s.damage, 0);
      parts.push(`strikes ${target.name} (${strikes.filter((s: Loose) => s.actor === u.id).map((s: Loose) => s.outcome).join('/')}, ${dealt} dmg → ${target.hp}/${target.maxHp})`);
    }
  }
  return parts.length ? `${u.name} ${parts.join(', then ')}.` : `${u.name} holds.`;
}

function approach(ctx: BattleCtx, u: UnitState, foes: UnitState[]): Coord | null {
  const map = ctx.state.map, mov = ctx.movOf(u);
  if (mov <= 0 || !foes.length) return null;
  const budget = (map.width + map.height) * 4;
  const wide = pathField(map, u.pos, budget, (index, x, y) => {
    const other = ctx.unitAt(x, y);
    if (other && other.id !== u.id && ctx.isHostile(u, other)) return BLOCKED;
    return ctx.tileCost(u, x, y);
  });
  const reachMax = Math.max(1, ...u.weapons.map((w) => w.range[1]));
  let goal: Coord | null = null, best = Infinity;
  for (const foe of foes) {
    for (const c of ringCells(map, foe.pos, 1, reachMax)) {
      const d = wide.dist[c.y * map.width + c.x]!;
      if (d < best) { best = d; goal = c; }
    }
  }
  if (goal) {
    const path = pathTo(wide, goal);
    for (let i = path.length - 1; i > 0; i--) {
      const c = path[i]!;
      if (wide.dist[c.y * map.width + c.x]! <= mov && !ctx.unitAt(c)) return c;
    }
    return null;
  }
  // No route at all (walled off): drift toward the nearest foe as the crow flies.
  const nearest = foes.reduce((a, b) => (manhattan(u.pos, a.pos) <= manhattan(u.pos, b.pos) ? a : b));
  let pick: Coord | null = null, bestD = manhattan(u.pos, nearest.pos);
  for (const c of ctx.reachable(u)) {
    const d = manhattan(c, nearest.pos);
    if (d < bestD) { bestD = d; pick = c; }
  }
  return pick;
}

function defaultPlan(ctx: BattleCtx, u: UnitState, profile: string): Loose {
  if (profile === 'passive' || profile === 'inert') return null;
  const foes = ctx.enemies(u);
  const canMove = !u.moved && !ctx.isBlocked(u, 'move') && ctx.movOf(u) > 0 && profile !== 'guard' && profile !== 'stationary';
  if (profile === 'wander') {
    const cells = canMove ? ctx.reachable(u, Math.min(2, ctx.movOf(u))) : [];
    return cells.length ? { move: ctx.rng.pick(cells) } : null;
  }
  if (!foes.length) return null;
  const map = ctx.state.map;
  if (profile === 'skittish' || profile === 'flee') {
    const near = foes.filter((f) => manhattan(f.pos, u.pos) <= 5);
    if (!near.length) return null;
    let best: Coord | null = null, bestScore = Math.min(...near.map((f) => manhattan(f.pos, u.pos)));
    for (const c of canMove ? ctx.reachable(u) : []) {
      const score = Math.min(...near.map((f) => manhattan(f.pos, c)));
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best) return { move: best };
    // Cornered animals bite.
  }
  if (profile === 'defensive') {
    const alarm = ctx.movOf(u) + Math.max(1, ...u.weapons.map((w) => w.range[1])) + 1;
    if (!foes.some((f) => manhattan(f.pos, u.pos) <= alarm) && u.hp >= u.maxHp) return null;
  }
  const field = canMove ? ctx.reach(u) : null;
  const canAttack = !ctx.isBlocked(u, 'act') && !ctx.isBlocked(u, 'attack');
  const candidates: Candidate[] = [];
  const scoreHook = hasHook(ctx.reg, 'ai:score');
  if (canAttack) {
    u.weapons.forEach((weapon, index) => {
      for (const t of foes) {
        ctx.tick();
        let numbers: ReturnType<BattleCtx['combat']> | null = null;
        for (const c of ringCells(map, t.pos, weapon.range[0], weapon.range[1])) {
          const here = sameCoord(c, u.pos), key = c.y * map.width + c.x;
          const cost = here ? 0 : field ? field.dist[key]! : Infinity;
          if (!Number.isFinite(cost) || (!here && ctx.unitAt(c))) continue;
          if (!ctx.inWeaponRange(u, t, weapon, c)) continue;
          numbers ??= ctx.combat(u, t, weapon);
          const counter = ctx.weaponOf(t);
          const d = manhattan(c, t.pos);
          const countered = !!counter && counter.counter && d >= counter.range[0] && d <= counter.range[1];
          const tile = ctx.tile(c);
          let score = (numbers.damage * numbers.hit) / 100 + (numbers.damage >= t.hp ? 40 + t.maxHp / 4 : 0) + (1 - t.hp / t.maxHp) * 4
            - (countered ? 2 : 0) + tile.defense + tile.avoid / 20 - cost * 0.05 + d * 0.1;
          if (profile === 'berserk') score += numbers.damage;
          if (scoreHook) {
            const ev = { unit: u, target: t, weapon, cell: c, score };
            ctx.emit('ai:score', ev); score = Number(ev.score);
          }
          candidates.push({ cell: c, cost, score, kind: 'attack', targetId: t.id, weapon: index });
        }
      }
    });
  }
  for (const id of u.abilities) {
    const def = ctx.abilityDef(id);
    if (!def?.ai || def.kind !== 'active' || ctx.abilityBlockReason(u, def) !== null) continue;
    const idea = invoke(ctx.reg, def.module, `ability ${id}.ai`, () => def.ai!(ctx, u));
    if (idea && typeof idea.score === 'number') candidates.push({ cell: { ...u.pos }, cost: 0, score: idea.score, kind: 'ability', ability: id, target: idea.target });
  }
  let best: Candidate | null = null;
  for (const c of candidates) if (!best || c.score > best.score) best = c;
  if (best && best.score > 0) {
    return best.kind === 'ability'
      ? { ability: best.ability, target: best.target }
      : { move: best.cell, attack: best.targetId, weapon: best.weapon };
  }
  if (!canMove || profile === 'defensive') return null;
  const to = approach(ctx, u, foes);
  return to ? { move: to } : null;
}

function actUnit(ctx: BattleCtx, u: UnitState): string {
  const profile = u.ai || ctx.state.factions[u.faction]?.ai || 'aggressive';
  let plan: Loose;
  const custom = ctx.reg.ai[profile];
  if (custom) plan = invoke(ctx.reg, custom.module, `ai ${profile}.plan`, () => custom.plan(ctx, u));
  if (plan === undefined) plan = defaultPlan(ctx, u, custom ? 'aggressive' : profile);
  if (hasHook(ctx.reg, 'ai:plan')) {
    const ev = { unit: u, plan };
    ctx.emit('ai:plan', ev);
    plan = ev.plan;
  }
  return executePlan(ctx, u, plan);
}

/** Runs every consecutive non-player phase and records a step-by-step trace for replay. */
export function runAiPhase(ctx: BattleCtx): void {
  const s = ctx.state;
  const trace: TraceStep[] = [];
  for (let guard = 0; guard < s.order.length && s.status === 'ongoing' && s.factions[ctx.phaseFaction]?.controller !== 'player'; guard++) {
    const factionId = ctx.phaseFaction;
    for (const id of s.units.filter((u) => u.alive && u.faction === factionId).map((u) => u.id)) {
      if (s.status !== 'ongoing') break;
      const u = ctx.unit(id);
      if (!u || !u.alive || u.acts <= 0) continue;
      const fxStart = s.fx.length, before = snapshot(s);
      const summary = actUnit(ctx, u);
      u.acts = 0; u.moved = true;
      ctx.checkOutcome();
      const fx = s.fx.slice(fxStart), after = deltas(before, s);
      if (fx.length || after.length) trace.push({ id: `${s.commandOrdinal}:${trace.length}`, actorId: u.id, actorName: u.name, summary, fx, after });
    }
    if (s.status !== 'ongoing') break;
    const fxStart = s.fx.length, before = snapshot(s);
    ctx.endPhase();
    const fx = s.fx.slice(fxStart), after = deltas(before, s);
    trace.push({
      id: `${s.commandOrdinal}:${trace.length}`, actorId: '', actorName: '',
      summary: s.status === 'ongoing' ? `${s.factions[ctx.phaseFaction]?.name ?? ctx.phaseFaction} phase begins.` : `Battle over: ${s.outcome}.`, fx, after,
    });
  }
  s.trace = trace;
}
