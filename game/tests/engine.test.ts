import { describe, expect, it } from 'vitest';
import { applyBattleCommand, createBattle, describeSelection, forecastAttack, hashBattle, threatCells } from '../src/engine/battle';
import { applyWorldOps, newCampaign } from '../src/engine/campaign';
import { planSummary, retrieve, type MemoryDoc } from '../src/engine/memory';
import { createRegistry, registerModule, type Registry } from '../src/engine/registry';
import type { BattleCommand, BattleState, Loose } from '../src/engine/types';

function run(state: BattleState, cmd: BattleCommand, reg: Registry, forced?: number[]): BattleState {
  const r = applyBattleCommand(state, cmd, reg, forced ? { forced } : {});
  expect(r.ok, r.error ?? '').toBe(true);
  return r.state;
}

const WORLD = { roster: [], inventory: [], vars: {} };
const duelSpec = (extra: Loose = {}): Loose => ({
  title: 'Test duel', seed: 7,
  map: { width: 8, height: 6, generator: 'open' },
  units: [
    { id: 'hero', name: 'Hero', faction: 'player', pos: [1, 2], maxHp: 30, mov: 4, stats: { str: 8, def: 3, spd: 6, skl: 6 }, weapons: [{ name: 'Hooked Chain', kind: 'chain', might: 5, hit: 100, range: [1, 2] }] },
    { id: 'foe', name: 'Foe', faction: 'enemy', pos: [3, 2], maxHp: 24, mov: 3, stats: { str: 6, def: 2, spd: 5, skl: 4 }, weapons: [{ name: 'Cudgel', kind: 'cudgel', might: 3, hit: 100 }] },
  ],
  ...extra,
});

describe('limitless battle kernel', () => {
  it('builds battles of any shape: free-form weapons, stats, factions and map sizes without caps', () => {
    const reg = createRegistry();
    const state = createBattle({
      map: { width: 64, height: 48, generator: 'wilds' },
      factions: [{ id: 'crew', controller: 'player' }, { id: 'swarm', controller: 'ai' }, { id: 'drifters', controller: 'ai', hostileTo: ['swarm'] }],
      units: [
        { name: 'Diver', faction: 'crew', count: 14, area: 'west', stats: { lungs: 9, nerve: 4 }, weapons: [{ name: 'Harpoon Reel', kind: 'harpoon', range: [1, 5], attackStat: 'lungs', defenseStat: 'shell' }] },
        { name: 'Glass Eel', faction: 'swarm', count: 70, area: 'east', stats: { shell: 2 }, weapons: [{ name: 'Static Kiss', kind: 'shock', damageType: 'voltaic' }] },
        { name: 'Kelp Drifter', faction: 'drifters', count: 20, area: 'north', weapons: [] },
      ],
    }, reg, WORLD);
    expect(state.units).toHaveLength(104);
    expect([state.map.width, state.map.height]).toEqual([64, 48]);
    expect(state.map.cells).toHaveLength(64 * 48);
    expect(new Set(state.units.map((u) => `${u.pos.x},${u.pos.y}`)).size).toBe(104);
    expect(state.order[0]).toBe('crew');
    expect(state.units[0]!.weapons[0]).toMatchObject({ kind: 'harpoon', range: [1, 5], attackStat: 'lungs' });
    expect(Object.keys(state.factions)).toEqual(['crew', 'swarm', 'drifters']);
  });

  it('resolves move, bump-style attack-from, counters and immediate outcomes deterministically', () => {
    const reg = createRegistry();
    const a = createBattle(duelSpec(), reg, WORLD), b = createBattle(duelSpec(), reg, WORLD);
    expect(hashBattle(a)).toBe(hashBattle(b));
    const forecast = forecastAttack(a, reg, 'hero', 'foe')!;
    expect(forecast.attacker).toMatchObject({ damage: 11, hit: 100 });
    expect(forecast.defender).toBeNull(); // range 2 vs. a range-1 cudgel: no counter
    expect(a.rngPos).toBe(0);
    const selection = describeSelection(a, reg, 'hero')!;
    expect(selection.targets).toEqual([{ id: 'foe', from: null, weapon: 0 }]);
    expect(selection.reachable.length).toBeGreaterThan(8);
    const after = run(a, { type: 'attack', unit: 'hero', target: 'foe' }, reg, [0, 0.99]);
    expect(after.units[1]!.hp).toBe(13);
    expect(after.fx.some((c) => c.t === 'strike' && c.outcome === 'hit')).toBe(true);
    expect(hashBattle(run(b, { type: 'attack', unit: 'hero', target: 'foe' }, reg, [0, 0.99]))).toBe(hashBattle(after));
    expect(hashBattle(run(b, { type: 'attack', unit: 'hero', target: 'foe' }, reg))).toBe(hashBattle(run(a, { type: 'attack', unit: 'hero', target: 'foe' }, reg)));
    // attack with `from` walks first (bump attack), and invalid commands change nothing
    const far = createBattle(duelSpec({ units: [duelSpec().units[0], { ...duelSpec().units[1], pos: [6, 2] }] }), reg, WORLD);
    const info = describeSelection(far, reg, 'hero')!.targets[0]!;
    expect(info.from).not.toBeNull();
    const bumped = run(far, { type: 'attack', unit: 'hero', target: 'foe', from: info.from! }, reg);
    expect(bumped.units[0]!.pos).toEqual(info.from);
    expect(bumped.units[1]!.hp).toBeLessThan(24);
    const bad = applyBattleCommand(far, { type: 'move', unit: 'hero', to: { x: 99, y: 0 } }, reg);
    expect(bad.ok).toBe(false); expect(bad.state).toBe(far);
  });

  it('runs AI phases with a replayable trace and supports win/lose conditions and retreat', () => {
    const reg = createRegistry();
    let s = createBattle(duelSpec({ objective: { win: [{ type: 'survive', rounds: 2 }] } }), reg, WORLD);
    s = run(s, { type: 'endPhase' }, reg);
    expect(s.factions[s.order[s.phaseIndex]!]!.controller).toBe('ai');
    s = run(s, { type: 'aiPhase' }, reg);
    expect(s.trace!.length).toBeGreaterThan(0);
    expect(s.trace!.some((step) => step.actorId === 'foe' && step.after.length > 0)).toBe(true);
    expect(s.round).toBe(2);
    s = run(run(s, { type: 'endPhase' }, reg), { type: 'aiPhase' }, reg);
    expect(s.status).toBe('ended'); expect(s.outcome).toBe('victory');
    const retreat = run(createBattle(duelSpec(), reg, WORLD), { type: 'retreat' }, reg);
    expect(retreat.outcome).toBe('retreat');
    expect(applyBattleCommand(retreat, { type: 'endPhase' }, reg).ok).toBe(false);
  });

  it('supports inline data abilities/statuses (Rule IR lite) alongside code', () => {
    const reg = createRegistry();
    const spec = duelSpec({
      abilities: { 'tar-flask': { name: 'Tar Flask', target: 'unit', range: [1, 3], effects: [{ op: 'damage', amount: 4 }, { op: 'status', id: 'tarred', duration: 2 }, { op: 'push', distance: 1 }] } },
      statuses: { tarred: { name: 'Tarred', mods: { mov: -2 }, tick: [{ op: 'damage', amount: 1 }] } },
    });
    spec.units[0].abilities = ['tar-flask'];
    let s = createBattle(spec, reg, WORLD);
    const info = describeSelection(s, reg, 'hero')!.abilities[0]!;
    expect(info).toMatchObject({ name: 'Tar Flask', enabled: true, unitIds: ['foe'] });
    s = run(s, { type: 'ability', unit: 'hero', ability: 'tar-flask', target: 'foe' }, reg);
    const foe = s.units[1]!;
    // The hero's only action auto-ends the phase, so the foe's phase has begun and Tarred ticked once.
    expect(foe.hp).toBe(19); expect(foe.statuses[0]).toMatchObject({ id: 'tarred', duration: 2 }); expect(foe.pos).toEqual({ x: 4, y: 2 });
    expect(describeSelection(s, reg, 'foe')!.reachable.every((c) => Math.abs(c.x - 4) + Math.abs(c.y - 2) <= 1)).toBe(true); // mov 3 − 2
    s = run(s, { type: 'aiPhase' }, reg);
    expect(s.units[1]!.statuses[0]).toMatchObject({ duration: 1 });
    s = run(run(s, { type: 'endPhase' }, reg), { type: 'aiPhase' }, reg);
    expect(s.units[1]!.statuses).toEqual([]);
  });

  it('scales: 40+ units per side on a big map resolve a full AI round quickly', () => {
    const reg = createRegistry();
    const spec = {
      map: { width: 56, height: 40, generator: 'wilds' },
      units: [
        { name: 'Line', faction: 'player', count: 44, area: [0, 0, 8, 39], maxHp: 26, stats: { str: 7, def: 4, spd: 6, skl: 6 }, weapons: [{ name: 'Pike', kind: 'pike', range: [1, 2], might: 5 }] },
        { name: 'Raider', faction: 'enemy', count: 52, area: [14, 0, 30, 39], maxHp: 22, mov: 6, stats: { str: 7, def: 3, spd: 7, skl: 5 }, weapons: [{ name: 'Sling', kind: 'sling', range: [1, 3], might: 4 }] },
      ],
      turnLimit: 50,
    };
    let s = createBattle(spec, reg, WORLD);
    expect(s.units).toHaveLength(96);
    const t0 = performance.now();
    expect(describeSelection(s, reg, s.units[0]!.id)!.reachable.length).toBeGreaterThan(5);
    expect(threatCells(s, reg).length).toBeGreaterThan(200);
    const tQuery = performance.now() - t0;
    const timings: number[] = [];
    for (let round = 0; round < 4 && s.status === 'ongoing'; round++) {
      s = run(s, { type: 'endPhase' }, reg);
      const start = performance.now();
      s = run(s, { type: 'aiPhase' }, reg);
      timings.push(performance.now() - start);
    }
    expect(s.trace!.length).toBeGreaterThan(20);
    expect(s.units.some((u) => u.hp < u.maxHp)).toBe(true);
    console.log(`scale: 96 units on 56×40 — selection+threat ${tQuery.toFixed(0)} ms, AI phases ${timings.map((t) => t.toFixed(0)).join('/')} ms`);
    expect(Math.max(...timings)).toBeLessThan(4000);
    expect(tQuery).toBeLessThan(1500);
    expect(JSON.stringify(s).length).toBeLessThan(600_000);
  });
});

describe('world state and memory', () => {
  it('applies free-form world ops by id path and ignores protected fields', () => {
    const c = newCampaign('c1', 'A tidal archive where librarians duel with tide-tables.', 1);
    const notes = applyWorldOps(c, [
      { op: 'add', target: 'roster', value: { name: 'Odile', title: 'Tide Clerk', maxHp: 22, stats: { wit: 7 }, weapons: [{ name: 'Ledger Hook', kind: 'hook' }] } },
      { op: 'add', target: 'inventory', value: { name: 'Salt Candle', qty: 2 } },
      { op: 'add', target: 'inventory.salt-candle', value: 3 },
      { op: 'set', target: 'roster.odile.hp', value: 9 },
      { op: 'inc', target: 'vars.tide.level', value: 2 },
      { op: 'merge', target: 'places.drowned-stacks', value: { name: 'Drowned Stacks', description: 'Shelves below the waterline.' } },
      { op: 'push', target: 'roster.odile.abilities', value: 'read-the-swell' },
      { op: 'set', target: 'scene.location', value: 'Reading Room' },
      { op: 'set', target: 'seed', value: 1 },
      { op: 'remove', target: 'inventory.missing' },
    ]);
    expect(c.roster[0]).toMatchObject({ id: 'odile', hp: 9, abilities: ['read-the-swell'], stats: { wit: 7 } });
    expect(c.inventory[0]).toMatchObject({ id: 'salt-candle', qty: 5 });
    expect(c.vars.tide.level).toBe(2);
    expect(c.places[0]).toMatchObject({ id: 'drowned-stacks', name: 'Drowned Stacks' });
    expect(c.scene.location).toBe('Reading Room');
    expect(notes.some((n) => n.includes('seed'))).toBe(true);
  });

  it('retrieves relevant old facts lexically and plans rolling summaries', () => {
    const docs: MemoryDoc[] = [
      { id: 'fact-1', kind: 'fact', text: 'Odile promised the ferryman half the salt candles for passage.', turn: 2 },
      { id: 'fact-2', kind: 'fact', text: 'The Drowned Stacks flood at every third bell.', turn: 5 },
      { id: 'chat-9', kind: 'chat', text: 'Player: I bribe the gull with a biscuit.', turn: 9 },
      { id: 'battle-1', kind: 'battle', text: 'Skirmish at the Reading Room — victory after 4 rounds. Fallen: Brine Warden.', turn: 12 },
    ];
    expect(retrieve('What did we promise the ferryman about candles?', docs, 2, 40)[0]!.id).toBe('fact-1');
    expect(retrieve('who fell in the reading room skirmish', docs, 1, 40)[0]!.id).toBe('battle-1');
    expect(retrieve('zzz qqq', docs, 3)).toEqual([]);
    expect(planSummary(0, 20)).toBeNull();
    expect(planSummary(0, 40)).toEqual({ from: 1, to: 26 });
    expect(planSummary(26, 45)).toBeNull();
  });
});

describe('module registration basics', () => {
  it('accepts declarative sugar and imperative setup in one module', () => {
    const reg = createRegistry();
    const rec = registerModule(reg, {
      id: 'tide-tables', name: 'Tide Tables',
      weapons: { 'ledger-hook': { name: 'Ledger Hook', kind: 'hook', range: [1, 2] } },
      statuses: [{ id: 'soaked', name: 'Soaked', mods: { spd: -2 } }],
      hooks: { 'round:start': () => {} },
      setup(api: Loose) { api.defineUnit({ id: 'brine-warden', name: 'Brine Warden', weapons: ['ledger-hook'] }); api.describe('Use brine-warden.'); },
    }, { file: 'modules/tide-tables.js', fallbackId: 'tide-tables' });
    expect(rec.status).toBe('loaded');
    expect(rec.provides).toMatchObject({ weapons: ['ledger-hook'], statuses: ['soaked'], units: ['brine-warden'], hooks: ['round:start'] });
    expect(reg.modules['tide-tables']!.usage).toContain('brine-warden');
    const state = createBattle({ units: [{ template: 'brine-warden', faction: 'enemy', count: 3 }, { name: 'You', faction: 'player' }] }, reg, WORLD);
    expect(state.units[0]!.weapons[0]).toMatchObject({ id: 'ledger-hook', kind: 'hook' });
  });
});
