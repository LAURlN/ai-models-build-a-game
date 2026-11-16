import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBattleCommand, createBattle, describeSelection, forecastAttack, hashBattle } from '../src/engine/battle';
import { applyBattleResult, campaignDigest, installNewModules, newCampaign, runCampaignCommand } from '../src/engine/campaign';
import type { Registry } from '../src/engine/registry';
import type { BattleCommand, BattleState, Loose } from '../src/engine/types';
import { WorldHost } from '../src/main/world/worldHost';
import { loadExamples, tempDir } from './helpers';

const EXAMPLES = path.resolve(__dirname, '../src/content/examples');
const hosts: WorldHost[] = [];
afterEach(() => { while (hosts.length) hosts.pop()!.dispose(); });

function run(state: BattleState, cmd: BattleCommand, reg: Registry, forced?: number[]): BattleState {
  const r = applyBattleCommand(state, cmd, reg, forced ? { forced } : {});
  expect(r.ok, r.error ?? '').toBe(true);
  return r.state;
}
const WORLD = { roster: [], inventory: [], vars: {} };

describe('extension API: loading and hooks', () => {
  it('loads generated ES modules from a workspace; three settings yield structurally different games', async () => {
    const { reg } = await loadExamples(['creature-catching', 'system-apocalypse', 'cozy-farm']);
    const mods = reg.modules;
    expect(Object.values(mods).map((m) => m.status)).toEqual(['loaded', 'loaded', 'loaded']);
    const creature = mods['creature-catching']!.provides, system = mods['system-apocalypse']!.provides, farm = mods['cozy-farm']!.provides;
    // Each setting brings its own systems, not a reskinned roster.
    expect(creature.objectives).toEqual(['catch']); expect(creature.commands).toContain('creatures.withdraw'); expect(creature.panels).toEqual(['creature-box']);
    expect(system.modes).toEqual(['net-duel']); expect(system.commands).toContain('system.buySkill'); expect(system.panels).toEqual(['system-interface']);
    expect(farm.generators).toEqual(['homestead']); expect(farm.commands).toContain('farm.sleep'); expect(farm.objectives).toEqual(['dawn', 'flock-lost']);
    const kinds = (ids: string[] | undefined) => new Set((ids ?? []).map((id) => reg.weapons[id]!.kind));
    const allKinds = [...kinds(creature.weapons), ...kinds(system.weapons), ...kinds(farm.weapons)];
    expect(allKinds.some((k) => ['sword', 'lance', 'axe', 'bow', 'tome'].includes(k))).toBe(false);
    expect(new Set(allKinds).size).toBe(allKinds.length);
    const statNames = (ids: string[]) => new Set(ids.flatMap((id) => Object.keys(reg.units[id]!.stats)));
    expect([...statNames(creature.units!)].sort()).not.toEqual([...statNames(farm.units!)].sort());
    expect(Object.keys(reg.sounds).length).toBeGreaterThanOrEqual(6);
    expect(reg.music.battle).toBeTruthy(); expect(reg.music.story).toBeTruthy();
    expect(mods['cozy-farm']!.usage).toContain('farm.sleep');
  });

  it('runs code hooks across combat: matchups, passives, status hooks, XP, loot, custom objectives', async () => {
    const { reg } = await loadExamples(['creature-catching', 'system-apocalypse']);
    // System apocalypse: kill → XP/level, Essence loot, Momentum passive, quest progress, barrier absorbs damage.
    let s = createBattle({
      seed: 11, map: { width: 8, height: 5, generator: 'open' },
      units: [
        { id: 'mara', name: 'Mara', faction: 'player', pos: [1, 2], rosterId: 'mara', maxHp: 30, stats: { pow: 30, guard: 5, will: 5, spd: 7, skl: 6 }, weapons: ['rebar-spear'], abilities: ['kill-streak', 'system-barrier', 'inspect', 'blink-step'], vars: { xp: 25 } },
        { template: 'husk', faction: 'enemy', pos: [3, 2] }, { template: 'husk', faction: 'enemy', pos: [6, 4] },
      ],
    }, reg, { roster: [], inventory: [], vars: { system: { quests: [{ id: 'cull', title: 'Cull', tag: 'husk', goal: 1, progress: 0, reward: 30, done: false }] } } });
    const abilities = describeSelection(s, reg, 'mara')!.abilities;
    expect(abilities.find((a) => a.id === 'kill-streak')).toMatchObject({ target: 'passive', enabled: false });
    expect(abilities.find((a) => a.id === 'blink-step')!.cells.length).toBeGreaterThan(10);
    s = run(s, { type: 'ability', unit: 'mara', ability: 'inspect', target: 'husk-1' }, reg);
    expect(forecastAttack(s, reg, 'mara', 'husk-1')!.notes).toContain('Analyzed: +15 hit');
    s = run(s, { type: 'attack', unit: 'mara', target: 'husk-1' }, reg, [0, 0.99]);
    const mara = s.units[0]!;
    expect(s.units[1]!.alive).toBe(false);
    expect(mara.statuses.map((x) => x.id)).toContain('momentum');
    expect(mara.level).toBe(2); expect(mara.vars.statPoints).toBe(2); expect(mara.maxHp).toBe(33);
    expect(s.result.loot.reduce((n, l) => n + (l.id === 'essence' ? l.qty : 0), 0)).toBe(4 + 30);
    expect(s.world.vars.system.quests[0]).toMatchObject({ progress: 1, done: true });
    expect(s.fx.some((c) => c.t === 'float' && c.text === 'LEVEL 2')).toBe(true);
    expect(s.fx.some((c) => c.t === 'sound' && c.id === 'level-up')).toBe(true);

    // Creature catching: elemental matchup note, capture ability consumes an item, custom "catch" objective ends the battle.
    let c = createBattle({
      seed: 5, map: { width: 9, height: 5, generator: 'open' },
      units: [
        { id: 'wren', name: 'Wren', faction: 'player', pos: [1, 2], stats: { pow: 7, grit: 5, spd: 8, skl: 8 }, weapons: ['snare-sling'], abilities: ['throw-snare-orb'] },
        { id: 'cinder', template: 'emberpup', faction: 'player', pos: [1, 3], ai: '' },
        { template: 'mossling', faction: 'wild', pos: [3, 2], hp: 2 },
      ],
      factions: [{ id: 'player', controller: 'player' }, { id: 'wild', controller: 'ai', ai: 'herd' }],
      objective: { win: [{ type: 'catch', count: 1 }] },
    }, reg, { roster: [], inventory: [{ id: 'snare-orb', name: 'Snare Orb', qty: 2, kind: 'consumable', description: '', data: {} }], vars: {} });
    expect(forecastAttack(c, reg, 'cinder', 'mossling-1')!.notes.join(' ')).toContain('ember is strong against moss');
    const orb = describeSelection(c, reg, 'wren')!.abilities[0]!;
    expect(orb).toMatchObject({ enabled: true, unitIds: ['mossling-1'] });
    expect(orb.cost).toContain('Snare Orb (2 left)');
    c = run(c, { type: 'ability', unit: 'wren', ability: 'throw-snare-orb', target: 'mossling-1' }, reg, [0]);
    expect(c.result.captured.map((u: Loose) => u.name)).toEqual(['Mossling']);
    expect(c.world.inventory[0]!.qty).toBe(1);
    expect(c.units[2]).toMatchObject({ alive: false, gone: 'captured' });
    expect([c.status, c.outcome, c.endReason]).toEqual(['ended', 'victory', 'catch']);
  });

  it('runs campaign meta-systems: commands, installed hooks, narrator context and battle results', async () => {
    const { reg } = await loadExamples(['cozy-farm', 'creature-catching']);
    let campaign = newCampaign('farm', 'A cozy farm where wolves attack from time to time.', 1);
    campaign.roster.push({ id: 'wren', name: 'Wren', title: 'Wrangler', classId: 'unit', status: 'active', hp: 26, maxHp: 26, mov: 5, moveType: 'foot', stats: { pow: 7 }, weapons: [], abilities: [], tags: [], vars: {}, sprite: {}, level: 1, xp: 0, notes: '' });
    const installed = installNewModules(campaign, reg);
    expect(installed.ok).toBe(true); campaign = installed.campaign;
    expect(campaign.installed.sort()).toEqual(['cozy-farm', 'creature-catching']);
    expect(campaign.vars.farm.plots).toHaveLength(8);
    expect(campaign.roster[0]!.abilities).toContain('throw-snare-orb');
    expect(installed.notes.some((n) => n.includes('Creature Box'))).toBe(true);
    const plant = runCampaignCommand(campaign, reg, 'farm.plant', { plot: 0, crop: 'turnip' });
    expect(plant.ok).toBe(true); campaign = plant.campaign;
    campaign = runCampaignCommand(campaign, reg, 'farm.water', { plot: 0 }).campaign;
    const slept = runCampaignCommand(campaign, reg, 'farm.sleep', {});
    campaign = slept.campaign;
    expect(campaign.vars.farm).toMatchObject({ day: 2 }); expect(campaign.vars.farm.plots[0]).toMatchObject({ crop: 'turnip', growth: 1 });
    expect(slept.notes[0]).toContain('Day 2');
    const bad = runCampaignCommand(campaign, reg, 'farm.harvest', { plot: 0 });
    expect(bad.ok).toBe(false); expect(bad.error).toContain('Nothing ripe'); expect(bad.faults).toEqual([]); // a deliberate rejection is not a fault
    expect(bad.campaign).toBe(campaign);
    const digest = campaignDigest(campaign, reg);
    expect(digest).toContain('Farm: day 2'); expect(digest).toContain('Creature Box: 0 stored');
    expect(digest).toContain('provides:');
  });
});

describe('extension API: error isolation and repair', () => {
  it('keeps playing when modules fail to parse, throw in setup, or throw at runtime; a fixed file clears the fault', async () => {
    const good = `export default { id: 'tally', setup(api) {
      api.on('damage:after', (ev, ctx) => { ctx.vars.hits = (ctx.vars.hits ?? 0) + 1; });
      api.defineAbility({ id: 'flare', name: 'Flare', target: 'unit', range: [1, 3], use(ctx, unit, target) { ctx.damage(target, 3, { source: unit }); } });
    } };`;
    const { reg, loader, workspace } = await loadExamples(['creature-catching'], {
      'syntax-error.js': 'export default { id: "syntax-error", setup(api) { api.on("x", () => { ',
      'setup-throws.js': 'export default { id: "setup-throws", setup(api) { api.defineAi({ id: "oops" }); } };',
      'not-a-module.js': 'export const nothing = 1;',
      'runtime-fault.js': `export default { id: 'runtime-fault', setup(api) {
        api.on('phase:start', (ev, ctx) => { ctx.vars.sideEffect = true; throw new Error('boom in phase:start'); });
        api.defineAbility({ id: 'cursed', name: 'Cursed', target: 'self', use() { throw new Error('boom in ability'); } });
      } };`,
      'tally.js': good,
    });
    expect(reg.modules['syntax-error']).toMatchObject({ status: 'error' });
    expect(reg.modules['syntax-error']!.error).toMatch(/SyntaxError|Unexpected|syntax/i);
    expect(reg.modules['setup-throws']!.error).toContain('needs a plan');
    expect(reg.modules['not-a-module']!.error).toContain('export default');
    expect(reg.ai.oops).toBeUndefined(); // a failed setup leaves nothing half-registered
    expect(reg.modules['creature-catching']!.status).toBe('loaded');
    expect(reg.modules['runtime-fault']!.status).toBe('loaded');

    const spec = {
      seed: 3, map: { width: 8, height: 5, generator: 'open' },
      units: [
        { id: 'hero', name: 'Hero', faction: 'player', pos: [1, 2], maxHp: 30, stats: { str: 8 }, weapons: [{ name: 'Rope', kind: 'rope', hit: 100 }], abilities: ['flare', 'cursed'] },
        { id: 'foe', name: 'Foe', faction: 'enemy', pos: [3, 2], maxHp: 30, mov: 0, weapons: [] },
      ],
    };
    // battle:start/phase:start fault while building: createBattle surfaces a ModuleFault the host retries; do it by hand here.
    let state: BattleState | null = null;
    for (let i = 0; i < 3 && !state; i++) {
      try { state = createBattle(spec, reg, WORLD); } catch (error) { reg.faults[(error as Loose).moduleId] = (error as Loose).info(); }
    }
    expect(state).not.toBeNull();
    expect(Object.keys(reg.faults)).toEqual(['runtime-fault']);
    expect(state!.vars.sideEffect).toBeUndefined(); // the faulting attempt was rolled back entirely
    delete reg.faults['runtime-fault'];

    // Runtime fault inside a command: rolled back, module quarantined, command retried and succeeds.
    const ended = applyBattleCommand(state!, { type: 'endPhase' }, reg);
    expect(ended.ok).toBe(true);
    expect(ended.faults).toEqual([expect.objectContaining({ moduleId: 'runtime-fault', where: 'hook phase:start', message: 'boom in phase:start' })]);
    expect(ended.state.vars.sideEffect).toBeUndefined();
    expect(ended.state.phaseIndex).toBe(1);
    // Its ability is disabled with a visible reason; other modules keep working.
    const info = describeSelection(state!, reg, 'hero')!.abilities;
    expect(info.find((a) => a.id === 'cursed')).toMatchObject({ enabled: false, faulted: true });
    expect(info.find((a) => a.id === 'flare')).toMatchObject({ enabled: true });
    const flared = run(state!, { type: 'ability', unit: 'hero', ability: 'flare', target: 'foe' }, reg);
    expect(flared.units[1]!.hp).toBe(27); expect(flared.vars.hits).toBe(1);
    const cursed = applyBattleCommand(state!, { type: 'ability', unit: 'hero', ability: 'cursed' }, reg);
    expect(cursed.ok).toBe(false); expect(cursed.error).toContain('repairing'); expect(cursed.state).toBe(state);

    // "Repair": rewrite the files, resync — errors and faults clear without restarting anything.
    writeFileSync(path.join(workspace, 'modules/runtime-fault.js'), `export default { id: 'runtime-fault', setup(api) { api.on('phase:start', (ev, ctx) => { ctx.vars.phases = (ctx.vars.phases ?? 0) + 1; }); } };`);
    writeFileSync(path.join(workspace, 'modules/syntax-error.js'), 'export default { id: "syntax-error", setup(api) { api.defineStatus({ id: "fixed", name: "Fixed" }); } };');
    const { changed } = await loader.sync();
    expect(changed.map((m) => `${m.id}:${m.status}`).sort()).toEqual(['runtime-fault:loaded', 'syntax-error:loaded']);
    expect(reg.faults).toEqual({});
    expect(reg.statuses.fixed).toBeTruthy();
    const after = applyBattleCommand(state!, { type: 'endPhase' }, reg);
    expect(after.faults).toEqual([]); expect(after.state.vars.phases).toBe(1);
    expect(reg.abilities.cursed).toBeUndefined();
  });
});

async function hostWithModules(names: string[]): Promise<{ host: WorldHost; dir: string; id: string }> {
  const dir = tempDir('chronicle-host-');
  const host = new WorldHost({ dbPath: path.join(dir, 'campaigns.sqlite'), workspacesDir: path.join(dir, 'campaigns'), aiDelayMs: 5 });
  hosts.push(host);
  const view = await host.createCampaign('A Pokémon-style adventure across the Verdant Reach.');
  const id = view.campaign!.id;
  mkdirSync(path.join(view.workspace, 'modules'), { recursive: true });
  for (const name of names) cpSync(path.join(EXAMPLES, `${name}.js`), path.join(view.workspace, 'modules', `${name}.js`));
  host.applyNarratorTurn({ ops: [
    { op: 'add', target: 'roster', value: { id: 'wren', name: 'Wren', title: 'Wrangler', maxHp: 26, mov: 5, stats: { pow: 7, grit: 5, spd: 8, skl: 8 }, weapons: [{ name: 'Thornwood Crook', kind: 'crook', might: 4, hit: 100 }] } },
    { op: 'add', target: 'roster', value: { id: 'cinder', name: 'Cinder', classId: 'emberpup', maxHp: 22, mov: 5, stats: { pow: 9, grit: 4, spd: 9, skl: 6 }, tags: ['creature', 'tamed', 'ember'], weapons: [{ name: 'Cinder Bite', kind: 'bite', might: 4, hit: 100, damageType: 'ember', attackStat: 'pow', defenseStat: 'grit' }] } },
  ] });
  const loaded = await host.reloadModules();
  expect(loaded.errors).toEqual([]);
  return { host, dir, id };
}

const catchSpec = (seed: number, extra: Loose = {}): Loose => ({
  title: 'Meadow', seed, map: { width: 14, height: 8, generator: 'open', base: 'grass' },
  factions: [{ id: 'party', controller: 'player' }, { id: 'wild', controller: 'ai', ai: 'passive' }],
  units: [{ roster: 'all', faction: 'party', area: [1, 3, 2, 4] }, { template: 'mossling', faction: 'wild', count: 3, area: [4, 3, 5, 5], hp: 3, ai: 'passive' }],
  objective: { win: [{ type: 'catch', count: 1 }], turnLimit: 20 },
  ...extra,
});

describe('Turnwheel and saves with generated code', () => {
  it('rewinds module state, inventory and the seeded RNG exactly; identical commands cannot reroll; charges are not refunded', async () => {
    const { host } = await hostWithModules(['creature-catching']);
    expect(host.startBattle(catchSpec(21)).ok).toBe(true);
    const start = host.view().battle!;
    expect(start.state.world.inventory.find((i) => i.id === 'snare-orb')!.qty).toBe(8);
    const wren = start.state.units.find((u) => u.rosterId === 'wren')!;
    const near = host.battleSelect(wren.id)!;
    expect(wren.weapons.map((w) => w.id)).toContain('snare-sling'); // granted by module:installed
    const orb = near.abilities.find((a) => a.id === 'throw-snare-orb')!;
    expect(orb.unitIds.length).toBeGreaterThan(0);
    const target = start.state.units.find((u) => u.id === orb.unitIds[0])!;
    expect(host.battlePreview(wren.id, 'throw-snare-orb', target.id)).toMatch(/Catch chance \d+%/);
    const reach = near.targets.find((t) => t.id === target.id)!;
    const sling = { type: 'attack', unit: wren.id, target: target.id, weapon: reach.weapon, ...(reach.from ? { from: reach.from } : {}) } as const;
    const first = host.battleCommand(sling);
    expect(first.ok, first.error ?? '').toBe(true);
    expect(first.snapshot!.state.rngPos).toBeGreaterThan(0);
    for (let i = 1; i <= 3; i++) {
      const rewound = host.battleRewind();
      expect(rewound.hash).toBe(start.hash);
      expect(rewound.state.rngPos).toBe(0);
      expect(rewound.rewindsLeft).toBe(3 - i);
      const replay = host.battleCommand(sling);
      expect(replay.snapshot!.hash).toBe(first.snapshot!.hash); // same seed position → same roll
    }
    expect(() => host.battleRewind()).toThrow(/No Turnwheel/);
    // The capture itself (module code using ctx.rng, an item cost, vars and a custom objective) is deterministic per seed.
    const cinder = host.view().battle!.state.units.find((u) => u.rosterId === 'cinder')!;
    const thrown = host.battleCommand({ type: 'ability', unit: wren.id, ability: 'throw-snare-orb', target: target.id });
    expect(thrown.ok).toBe(false); // Wren already acted this phase
    expect(host.battleCommand({ type: 'wait', unit: cinder.id }).ok).toBe(true);
  });

  it('round-trips the campaign across multiple battles and a mid-battle restart', async () => {
    const { host, dir, id } = await hostWithModules(['creature-catching']);
    expect(host.view().campaign!.inventory.find((i) => i.id === 'snare-orb')!.qty).toBe(8);

    // Battle 1: throw orbs at 3-HP creatures until one is caught (deterministic for the seed).
    expect(host.startBattle(catchSpec(77)).ok).toBe(true);
    let guard = 0;
    while (host.view().battle!.state.status === 'ongoing' && guard++ < 40) {
      const state = host.view().battle!.state;
      if (state.factions[state.order[state.phaseIndex]!]!.controller !== 'player') { await new Promise((r) => setTimeout(r, 15)); continue; }
      const wren = state.units.find((u) => u.rosterId === 'wren')!;
      const info = host.battleSelect(wren.id)!.abilities.find((a) => a.id === 'throw-snare-orb')!;
      if (process.env.DEBUG_LOOP) console.log(guard, state.round, state.phaseIndex, wren.pos, wren.acts, wren.moved, info.enabled, info.reason, state.log.slice(-2).map((l) => l.text));
      if (info.enabled) host.battleCommand({ type: 'ability', unit: wren.id, ability: 'throw-snare-orb', target: info.unitIds[0] });
      else if (wren.acts > 0 && !wren.moved) {
        const wild = state.units.find((u) => u.faction === 'wild' && u.alive)!;
        const step = host.battleSelect(wren.id)!.reachable.sort((a, b) => Math.abs(a.x - wild.pos.x) + Math.abs(a.y - wild.pos.y) - Math.abs(b.x - wild.pos.x) - Math.abs(b.y - wild.pos.y))[0]!;
        host.battleCommand({ type: 'move', unit: wren.id, to: step });
      } else host.battleCommand({ type: 'endPhase' });
    }
    const won = host.view().battle!.state;
    expect([won.status, won.outcome]).toEqual(['ended', 'victory']);
    const record1 = host.resolveBattle();
    expect(record1.captured).toHaveLength(1);
    let campaign = host.view().campaign!;
    expect(campaign.activeBattleId).toBeNull();
    expect(campaign.roster.map((r) => r.name)).toEqual(['Wren', 'Cinder', record1.captured[0]]);
    expect(campaign.roster[2]).toMatchObject({ status: 'active', tags: expect.arrayContaining(['tamed']) });
    expect(campaign.vars.creatures).toMatchObject({ caughtTotal: 1, seen: ['mossling'] });
    expect(campaign.inventory.find((i) => i.id === 'snare-orb')!.qty).toBeLessThan(8);
    expect(campaign.battles).toHaveLength(1);
    expect(host.view().chat.some((m) => m.kind === 'battle' && m.text.includes('Captured: Mossling'))).toBe(true);

    // Storage UI commands work between battles.
    expect(host.runCommand('creatures.deposit', { id: campaign.roster[2]!.id }).ok).toBe(true);
    expect(host.view().campaign!.vars.creatures.box).toHaveLength(1);
    expect(host.runCommand('creatures.withdraw', { index: 0 }).ok).toBe(true);

    // Battle 2 in the same campaign uses the caught creature and ends in a retreat with a casualty.
    expect(host.startBattle({ title: 'Ford', seed: 9, map: { width: 10, height: 6, generator: 'open' }, units: [{ roster: 'all', faction: 'player', area: 'west' }, { template: 'cragback', faction: 'enemy', count: 2, area: 'east' }] }).ok).toBe(true);
    const second = host.view().battle!.state;
    expect(second.units.filter((u) => u.rosterId)).toHaveLength(3);
    expect(host.runCommand('creatures.deposit', { id: 'cinder' }).ok).toBe(false); // no storage juggling mid-battle
    expect(host.battleCommand({ type: 'retreat' }).ok).toBe(true);
    const record2 = host.resolveBattle();
    expect(record2.outcome).toBe('retreat');
    campaign = host.view().campaign!;
    expect(campaign.battles.map((b) => b.outcome)).toEqual(['victory', 'retreat']);
    expect(campaign.facts.filter((f) => f.tags.includes('battle'))).toHaveLength(2);

    // Battle 3: move, then "quit" mid-battle.
    expect(host.startBattle(catchSpec(5)).ok).toBe(true);
    const wren = host.view().battle!.state.units.find((u) => u.rosterId === 'wren')!;
    const to = host.battleSelect(wren.id)!.reachable[0]!;
    expect(host.battleCommand({ type: 'move', unit: wren.id, to }).ok).toBe(true);
    const before = host.view();
    hosts.splice(hosts.indexOf(host), 1); host.dispose();

    const reopened = new WorldHost({ dbPath: path.join(dir, 'campaigns.sqlite'), workspacesDir: path.join(dir, 'campaigns'), aiDelayMs: 5 });
    hosts.push(reopened);
    expect(reopened.listCampaigns()).toEqual([expect.objectContaining({ id, battles: 2, inBattle: true })]);
    const after = await reopened.openCampaign(id);
    expect(after.campaign).toEqual(before.campaign);
    expect(after.chat).toEqual(before.chat);
    expect(after.battle!.hash).toBe(before.battle!.hash);
    expect(after.battle!.canRewind).toBe(true);
    expect(after.modules.map((m) => `${m.id}:${m.status}`)).toEqual(['creature-catching:loaded']);
    expect(reopened.battleRewind().state.units.find((u) => u.rosterId === 'wren')!.pos).toEqual(wren.pos);
    // module:installed must not run twice
    expect(after.campaign!.inventory.find((i) => i.id === 'snare-orb')!.qty).toBe(campaign.inventory.find((i) => i.id === 'snare-orb')!.qty);
  });

  it('battle results flow back through pure functions too (casualties, loot, vars)', async () => {
    const { reg } = await loadExamples(['cozy-farm']);
    let campaign = newCampaign('f', 'farm', 1);
    campaign = installNewModules(campaign, reg).campaign;
    campaign.roster.push({ id: 'tilda', name: 'Tilda', title: '', classId: 'farmhand', template: 'farmhand', status: 'active', hp: 20, maxHp: 20, mov: 4, moveType: 'foot', stats: { brawn: 6, hide: 3 }, weapons: ['pitchfork'], abilities: ['bang-pots'], tags: [], vars: {}, sprite: {}, level: 1, xp: 0, notes: '' });
    let s = createBattle({
      seed: 4, map: { width: 30, height: 20, generator: 'homestead' },
      factions: [{ id: 'player', controller: 'player' }, { id: 'flock', controller: 'ai', hostileTo: ['wolves'], ai: 'graze' }, { id: 'wolves', controller: 'ai', hostileTo: ['player', 'flock'] }],
      units: [{ roster: 'all', faction: 'player', pos: [8, 6] }, { template: 'sheep', faction: 'flock', count: 6, area: [12, 2, 16, 7] }, { template: 'wolf', faction: 'wolves', count: 9, area: [22, 0, 29, 19] }],
      objective: { win: [{ type: 'dawn', rounds: 3 }], lose: [{ type: 'flock-lost', min: 1 }] },
    }, reg, { roster: campaign.roster, inventory: campaign.inventory, vars: campaign.vars });
    expect(s.map.palette).toEqual(expect.arrayContaining(['crop-row', 'fence', 'barn-floor']));
    expect(s.order).toEqual(['player', 'flock', 'wolves']);
    for (let i = 0; i < 12 && s.status === 'ongoing'; i++) {
      s = run(s, s.factions[s.order[s.phaseIndex]!]!.controller === 'player' ? { type: 'endPhase' } : { type: 'aiPhase' }, reg);
    }
    expect(s.status).toBe('ended');
    const txn = applyBattleResult(campaign, s, reg);
    expect(txn.ok).toBe(true);
    const lost = s.units.filter((u) => u.tags.includes('livestock') && !u.alive).length;
    expect(txn.campaign.vars.farm.sheep).toBe(6 - lost);
    expect(txn.campaign.vars.farm.threat).toBe(0);
    expect(txn.notes.some((n) => n.startsWith('After the raid'))).toBe(true);
    expect(txn.campaign.battles[0]!.outcome).toBe(s.outcome);
    expect(hashBattle(s)).toHaveLength(16);
  });
});
