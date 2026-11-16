import { describe, expect, it } from 'vitest';
import { applyCommand, attackSpeed, combatNumbers, computeReachableTiles, computeStateHash, createInitialBattleState, forecastCombat } from '../src/rules/battle';
import { RULES, RULE_SOURCE, abilityTooltip, compileRules } from '../src/rules/ir';
import type { BattleState, EngineCommand, UnitState } from '../src/shared/contracts';

export function run(s: BattleState, c: EngineCommand): BattleState { const r = applyCommand(s, c); expect(r.ok, !r.ok ? r.error : '').toBe(true); return r.state; }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function pair(): BattleState {
  const s = createInitialBattleState(73);
  s.terrain = s.terrain.map(row => row.map(() => 'plain'));
  s.units = [s.units[0]!, s.units[4]!];
  s.units[0]!.pos = { x: 1, y: 2 }; s.units[1]!.pos = { x: 2, y: 2 };
  s.units.forEach(u => { u.maxHp = 200; u.hp = 100; u.skl = 6; u.lck = 0; u.weapon.hit = 70; u.weapon.crit = 25; });
  return s;
}
const attack: EngineCommand = { type: 'ATTACK_UNIT', attackerId: 'player_vanguard', targetId: 'enemy_raider' };
function reject(s: BattleState, command: unknown): void {
  const before = JSON.stringify(s), r = applyCommand(freeze(s), command as EngineCommand);
  expect(r.ok).toBe(false); expect(r.state).toBe(s); expect(JSON.stringify(r.state)).toBe(before);
}
describe('combat and content', () => {
  it('authors a 10×10 battle with four players, five enemies, terrain and distinct classes', () => {
    const s = createInitialBattleState();
    expect([s.boardWidth, s.boardHeight]).toEqual([10, 10]);
    expect(s.units.filter(u => u.faction === 'player')).toHaveLength(4);
    expect(s.units.filter(u => u.faction === 'enemy')).toHaveLength(5);
    expect(new Set(s.units.map(u => u.classId)).size).toBeGreaterThanOrEqual(3);
    expect(s.units.some(u => u.weapon.minRange === 2)).toBe(true);
    expect(s.terrain.flat()).toContain('wall'); expect(s.terrain.flat()).toContain('cover');
    expect(computeReachableTiles(s, s.units[0]!.id)).not.toContainEqual({ x: 4, y: 1 });
    expect(computeReachableTiles(s, s.units[0]!.id)).toContainEqual({ x: 3, y: 2 });
  });
  it('computes AS, physical/magical damage, terrain, advantage, hit and crit with integers', () => {
    const s = pair(), a = s.units[0]!, b = s.units[1]!;
    a.str = 7; a.spd = 10; a.skl = 8; a.lck = 3; a.weapon = { ...a.weapon, weight: 9, might: 5, hit: 80, crit: 10 };
    b.str = 9; b.spd = 6; b.lck = 2; b.def = 4; b.res = 7;
    expect(attackSpeed(a)).toBe(8);
    expect(combatNumbers(s, a, b)).toEqual({ baseDamage: 9, hitBP: 10000, critBP: 1200 });
    s.terrain[2]![2] = 'cover';
    expect(combatNumbers(s, a, b)).toEqual({ baseDamage: 7, hitBP: 8000, critBP: 1200 });
    a.weapon.tag = 'tome'; a.weapon.damageType = 'magical'; a.mag = 13;
    expect(combatNumbers(s, a, b).baseDamage).toBe(9);
    a.mag = 0; expect(combatNumbers(s, a, b).baseDamage).toBe(0);
  });
  it.each(['normal', 'defender-fast', 'range-two', 'lethal'] as const)('matches every forced forecast branch: %s', variant => {
    const s = pair(), a = s.units[0]!, b = s.units[1]!;
    if (variant === 'defender-fast') { a.spd = 4; b.spd = 15; }
    if (variant === 'range-two') { a.weapon.minRange = 2; a.weapon.maxRange = 2; b.pos = { x: 3, y: 2 }; }
    if (variant === 'lethal') b.hp = 1;
    const before = JSON.stringify(s), f = forecastCombat(freeze(s), a.id, b.id);
    expect(JSON.stringify(s)).toBe(before);
    expect(f.branches.some(branch => branch.strikes.some(t => t.outcome === 'miss'))).toBe(true);
    expect(f.branches.some(branch => branch.strikes.some(t => t.outcome === 'crit'))).toBe(true);
    for (const branch of f.branches) {
      const rolls = branch.strikes.flatMap(t => t.outcome === 'miss' ? [9999] : t.outcome === 'crit' ? [0, 0] : [0, 9999]);
      const r = applyCommand(s, attack, { rolls }); expect(r.ok).toBe(true);
      expect(Object.fromEntries(r.state.units.map(u => [u.id, u.hp]))).toEqual(branch.hp);
      expect(r.state.events.slice(s.events.length).filter(e => e.kind === 'rule' && e.message.includes(' — ')).map(e => e.message)).toEqual(branch.triggers);
      const explanations = r.state.events.slice(s.events.length).filter(e => e.kind === 'attack' && e.message.includes('→')).map(e => e.message);
      expect(explanations).toHaveLength(branch.strikes.length);
      branch.strikes.forEach((t, i) => expect(explanations[i]).toContain(`${t.role} ${t.outcome}`));
      if (variant === 'range-two') expect(branch.strikes.every(t => t.actorId === a.id && t.role !== 'counter')).toBe(true);
      if (variant === 'defender-fast') expect(branch.strikes.at(-1)?.actorId).toBe(b.id);
    }
  });
  it('critical packets triple base damage, missing hits consume no crit roll, and corpses do not counter', () => {
    const s = pair(); s.units[1]!.hp = 1;
    const r = applyCommand(s, attack, { rolls: [0, 0] }); expect(r.ok).toBe(true); expect(r.state.rngPosition).toBe(2);
    const miss = applyCommand(pair(), attack, { rolls: [9999, 9999, 9999] }); expect(miss.ok).toBe(true); expect(miss.state.rngPosition).toBe(3);
    const f = forecastCombat(pair(), 'player_vanguard', 'enemy_raider');
    const crit = f.branches.find(b => b.strikes[0]?.outcome === 'crit')!.strikes[0]!;
    expect(crit.hpBefore - crit.hpAfter).toBe(crit.baseDamage * 3);
  });
  it('blocks line of sight through walls and applies cover movement cost', () => {
    const s = pair(), a = s.units[0]!, b = s.units[1]!;
    a.weapon = { ...a.weapon, minRange: 2, maxRange: 2, lineOfSight: true }; b.pos = { x: 3, y: 2 }; s.terrain[2]![2] = 'wall';
    reject(s, attack);
    const fresh = pair(); fresh.units[1]!.pos = { x: 9, y: 9 }; fresh.units[0]!.mov = 1; fresh.terrain[2]![2] = 'cover';
    expect(computeReachableTiles(fresh, fresh.units[0]!.id)).not.toContainEqual({ x: 2, y: 2 });
  });
  it('bump attack is identical to Attack and movement does not consume the action', () => {
    const s = pair();
    expect(run(s, { type: 'MOVE_UNIT', unitId: s.units[0]!.id, to: s.units[1]!.pos })).toEqual(run(s, attack));
    const initial = createInitialBattleState(), moved = run(initial, { type: 'MOVE_UNIT', unitId: initial.units[0]!.id, to: { x: 3, y: 2 } });
    expect(moved.units[0]!.actionCredits).toBe(1); expect(moved.phase).toBe('player');
    reject(moved, { type: 'MOVE_UNIT', unitId: moved.units[0]!.id, to: { x: 2, y: 2 } });
  });
});
describe('transactions and deterministic replay', () => {
  it.each([null, {}, { type: 'BOGUS' }, { type: 'CONCEDE', extra: true }, { type: 'RUN_ENEMY_PHASE' },
    { type: 'MOVE_UNIT', unitId: 'player_vanguard', to: { x: 10, y: 2 } }, { type: 'MOVE_UNIT', unitId: 'player_vanguard', to: { x: 2.5, y: 2 } },
    { type: 'MOVE_UNIT', unitId: 'player_vanguard', to: { x: 4, y: 1 } },
    { type: 'ATTACK_UNIT', attackerId: 'player_vanguard', targetId: 'player_guard' },
    { type: 'WAIT_UNIT', unitId: 'enemy_raider' }, { type: 'USE_ABILITY', unitId: 'player_archer', abilityId: 'borrowed_second' }])('invalid input changes nothing, including RNG: %j', c => reject(createInitialBattleState(), c));
  it('keeps selection out of ordinals and simulation hashes', () => {
    const s = createInitialBattleState(), selected = run(s, { type: 'SELECT_UNIT', unitId: s.units[0]!.id });
    expect(selected.commandOrdinal).toBe(0); expect(computeStateHash(selected)).toBe(computeStateHash(s));
  });
  it('replays a 20-command log to identical intermediate state hashes and RNG positions', () => {
    const base = pair(); base.units.forEach(u => { u.hp = 100000; u.maxHp = 100000; });
    const log: EngineCommand[] = Array.from({ length: 5 }, () => [{ type: 'USE_ABILITY', unitId: 'player_vanguard', abilityId: 'borrowed_second' }, attack, { type: 'END_PHASE' }, { type: 'RUN_ENEMY_PHASE' }] as EngineCommand[]).flat();

    const replay = () => { let s = base; return log.map(c => { s = run(s, c); return [computeStateHash(s), s.rngPosition]; }); };
    expect(log).toHaveLength(20); expect(replay()).toEqual(replay()); expect(replay().at(-1)![1]).toBeGreaterThan(0);
  });
  it('rolls back a runtime failure after cost reservation and after RNG draws', () => {
    const s = pair(), before = JSON.stringify(s);
    const activeFailure = applyCommand(s, { type: 'USE_ABILITY', unitId: s.units[0]!.id, abilityId: 'borrowed_second' }, { fuel: 1 });
    expect(activeFailure.ok).toBe(false); expect(activeFailure.state).toBe(s);
    const rngFailure = applyCommand(s, attack, { fuel: 3, rolls: [0, 0] });
    expect(rngFailure.ok).toBe(false); expect(rngFailure.state).toBe(s); expect(JSON.stringify(s)).toBe(before);
  });
});
describe('compiled Borrowed Second', () => {
  it('generates the ability and liability tooltip from data', () => {
    const text = abilityTooltip('borrowed_second'); expect(text).toContain('costs 3 HP and 0 actions'); expect(text).toContain('next own phase start'); expect(text).toContain('heal 6'); expect(text).toContain('stacks at expiry');
    expect(RULES.borrowed_second!.contentHash).toHaveLength(16);
  });
  it('adds a credit for 3 HP, cannot reset its shared use, and clears debt/heals on a kill', () => {
    let s = pair(); s.units[1]!.hp = 1;
    s = run(s, { type: 'USE_ABILITY', unitId: s.units[0]!.id, abilityId: 'borrowed_second' });
    expect(s.units[0]).toMatchObject({ hp: 97, actionCredits: 2, phaseUses: { borrowed_second: 1, 'grant:borrowed_second': 1 } });
    reject(s, { type: 'USE_ABILITY', unitId: s.units[0]!.id, abilityId: 'borrowed_second' });
    const forecast = forecastCombat(s, s.units[0]!.id, s.units[1]!.id);
    expect(forecast.branches.some(b => b.triggers.some(t => t.includes('Temporal Debt — kill')))).toBe(true);
    const killed = applyCommand(s, attack, { rolls: [0, 9999] }); expect(killed.ok).toBe(true);
    expect(killed.state.units[0]).toMatchObject({ hp: 103, actionCredits: 1, statuses: [] });
  });
  it('can activate after spending the ordinary action, but not after battle ends', () => {
    const s = run(pair(), { type: 'WAIT_UNIT', unitId: 'player_vanguard' });
    expect(s.phase).toBe('player');
    const granted = run(s, { type: 'USE_ABILITY', unitId: 'player_vanguard', abilityId: 'borrowed_second' });
    const moved = run(granted, { type: 'MOVE_UNIT', unitId: 'player_vanguard', to: { x: 1, y: 3 } });
    expect(moved.units[0]).toMatchObject({ bonusCredits: 0, actionCredits: 0 });
    expect(run(s, { type: 'USE_ABILITY', unitId: 'player_vanguard', abilityId: 'borrowed_second' }).units[0]!.actionCredits).toBe(1);
  });
  it('applies exactly 15 damage at the next own phase start and uses the expiry stack snapshot', () => {
    let s = pair(); s.units[1]!.pos = { x: 9, y: 9 }; s.units[1]!.mov = 0;
    s = run(s, { type: 'USE_ABILITY', unitId: 'player_vanguard', abilityId: 'borrowed_second' });
    const enemy = run(s, { type: 'END_PHASE' }); expect(enemy.units[0]!.hp).toBe(97); expect(enemy.units[0]!.statuses).toHaveLength(1);
    const own = run(enemy, { type: 'RUN_ENEMY_PHASE' }); expect(own.phaseOrdinal).toBe(3); expect(own.units[0]!.hp).toBe(82); expect(own.units[0]!.statuses).toEqual([]);
    const stacked = structuredClone(enemy); stacked.units[0]!.statuses[0]!.stacks = 2; stacked.units[0]!.hp = 20;
    const dead = run(stacked, { type: 'RUN_ENEMY_PHASE' }); expect(dead.units[0]!.hp).toBe(0); expect(dead.endReason).toBe('all_allies_defeated');
  });
  it('rejects cyclic, oversized, unknown and missing-limit Rule IR', () => {
    const cycle = structuredClone(RULE_SOURCE); cycle[1]!.listeners.push({ hook: 'afterHeal', scope: 'ownerTarget', priority: 0, maxPerRoot: 1, maxPerPhase: 1, effect: { op: 'heal', amount: 1 } });
    expect(() => compileRules(cycle)).toThrow(/cycle/);
    const oversized = structuredClone(RULE_SOURCE); oversized[0]!.listeners[0]!.effect = { op: 'sequence', effects: Array.from({ length: 65 }, () => ({ op: 'heal', amount: 1 })) };
    expect(() => compileRules(oversized)).toThrow(/bound/);
    const bad = JSON.parse(JSON.stringify(RULE_SOURCE)); delete bad[0].listeners[0].maxPerRoot; expect(() => compileRules(bad)).toThrow();
    bad[0].listeners[0].maxPerRoot = 1; bad[0].listeners[0].effect = { op: 'eval', script: 'bad' }; expect(() => compileRules(bad)).toThrow();
  });
  it('rolls back dynamic arithmetic faults, including reserved HP, grant and counters', () => {
    const source = structuredClone(RULE_SOURCE);
    source[0]!.listeners[0]!.effect = { op: 'sequence', effects: [source[0]!.listeners[0]!.effect,
      { op: 'adjustCounter', key: 'test', amount: { op: 'floorDivide', left: 1, right: { read: 'counter', key: 'zero' } } }] };
    const pack = compileRules(source), s = pair();
    const r = applyCommand(s, { type: 'USE_ABILITY', unitId: 'player_vanguard', abilityId: 'borrowed_second' }, { pack });
    expect(r.ok).toBe(false); expect(r.state).toBe(s); expect(r.state.units[0]!.hp).toBe(100);
  });
});
describe('endings and host commands', () => {
  it('ends exhausted player phases automatically and has concede, defeat, expiry and technical abort', () => {
    let s = createInitialBattleState(); s.units[0]!.abilities = [];
    for (const u of s.units.filter(u => u.faction === 'player')) s = run(s, { type: 'WAIT_UNIT', unitId: u.id });
    expect(s.phase).toBe('enemy');
    expect(run(createInitialBattleState(), { type: 'CONCEDE' }).endReason).toBe('concede');
    expect(run(createInitialBattleState(), { type: 'TECHNICAL_ABORT' }).endReason).toBe('technical_abort');
    const expire = pair(); expire.maxTurns = 1; expire.units[1]!.pos = { x: 9, y: 9 }; expire.units[1]!.mov = 0;
    expect(run(run(expire, { type: 'END_PHASE' }), { type: 'RUN_ENEMY_PHASE' }).endReason).toBe('expiry');
    const terminal = run(pair(), { type: 'CONCEDE' }); reject(terminal, attack);
  });
});
