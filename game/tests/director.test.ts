import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER_SETTINGS } from '../src/main/saveStore';
import { T3SidecarManager } from '../src/main/t3Sidecar';
import { Director, storySelection } from '../src/main/world/director';
import { normalizeNarratorTurn } from '../src/main/world/prompts';
import { createWorldClient, localWorldApi, type WorldApi } from '../src/main/world/worldClient';
import { WorldHost } from '../src/main/world/worldHost';
import type { ModuleFaultInfo, WorldView } from '../src/engine/types';
import { tempDir } from './helpers';

const CONTENT = path.resolve(__dirname, '../src/content');
let sidecar: T3SidecarManager;
let sidecarDir: string;

beforeAll(async () => {
  sidecarDir = tempDir('chronicle-director-sidecar-');
  sidecar = new T3SidecarManager({ baseDir: sidecarDir, fakeMode: true });
  await sidecar.ensureStarted();
}, 180_000);
afterAll(() => sidecar?.dispose());

function setup(): { world: WorldApi; director: Director; host: WorldHost; dir: string } {
  const dir = tempDir('chronicle-director-');
  const host = new WorldHost({ dbPath: path.join(dir, 'campaigns.sqlite'), workspacesDir: path.join(dir, 'campaigns'), contentDir: CONTENT, aiDelayMs: 5 });
  const world = localWorldApi(host);
  const director = new Director(world, sidecar, () => DEFAULT_PROVIDER_SETTINGS, CONTENT);
  return { world, director, host, dir };
}
const narrations = (view: WorldView) => view.chat.filter((m) => m.role === 'narrator');

describe('Narrator / helper loop (scripted fake provider through the real sidecar)', () => {
  it('opens a setting, builds a novel system in the background while chat continues, stages a big battle, and feeds the result back', async () => {
    const { world, director, host } = setup();
    try {
      await director.create('A Pokémon-style adventure across the Verdant Reach where I catch wild creatures.');
      await director.whenIdle();
      let view = await world.view();
      expect(narrations(view)).toHaveLength(1);
      expect(view.campaign!.roster.map((r) => r.id)).toEqual(['wren', 'cinder']);
      expect(view.campaign!.places.map((p) => p.id)).toContain('verdant-reach');
      expect(view.campaign!.turn).toBe(1);
      expect(view.campaign!.suggestions.length).toBeGreaterThan(0);

      // The helper takes a while; the chat must not block on it.
      await director.say('I want to catch wild creatures and store them in a box. [FORCE_DELAY_MS=2500]');
      await expect.poll(() => director.status().tasks.some((t) => t.kind === 'helper' && t.status === 'running'), { timeout: 20_000 }).toBe(true);
      await expect.poll(() => director.status().busy, { timeout: 20_000 }).toBe(false);
      expect(director.status().tasks.filter((t) => t.kind === 'helper' && t.status !== 'done' && t.status !== 'failed').length).toBeGreaterThan(0);
      await director.say('While that is built, I ask Cinder what she smells.');
      await expect.poll(async () => narrations(await world.view()).length, { timeout: 20_000 }).toBe(3);
      expect(director.status().tasks.some((t) => t.kind === 'helper' && t.status === 'running')).toBe(true); // still building
      await director.whenIdle();

      view = await world.view();
      expect(view.modules.map((m) => `${m.id}:${m.status}`).sort()).toEqual(['creature-catching:loaded', 'field-ambience:loaded']);
      expect(view.campaign!.inventory.find((i) => i.id === 'snare-orb')?.qty).toBe(8);
      expect(view.campaign!.roster.find((r) => r.id === 'wren')!.abilities).toContain('throw-snare-orb');
      expect(view.chat.some((m) => m.kind === 'helper' && m.text.includes('Creature catching & storage box'))).toBe(true);
      const helperTasks = director.status().tasks.filter((t) => t.kind === 'helper');
      expect(helperTasks.map((t) => t.status)).toEqual(['done', 'done']);
      expect(helperTasks[0]!.files).toEqual(['modules/creature-catching.js']);
      expect(helperTasks[0]!.model).toContain('gpt-6.1-terra');
      // Helpers see the whole chat: the transcript and state mirrors exist in the workspace.
      expect(readFileSync(path.join(view.workspace, 'chat/transcript.md'), 'utf8')).toContain('store them in a box');
      expect(existsSync(path.join(view.workspace, 'docs/EXTENSION_API.md'))).toBe(true);
      expect(existsSync(path.join(view.workspace, 'examples/cozy-farm.js'))).toBe(true);

      // Battle: big map, many units, generated templates and objective.
      await director.say('Into the tall grass — let us battle the wild herds!');
      await director.whenIdle();
      await expect.poll(async () => !!(await world.view()).battle, { timeout: 20_000 }).toBe(true);
      view = await world.view();
      const battle = view.battle!.state;
      expect([battle.map.width, battle.map.height]).toEqual([40, 28]);
      expect(battle.units.length).toBeGreaterThanOrEqual(38);
      expect(battle.objective.win.map((c) => c.type)).toContain('catch');
      expect(new Set(battle.units.map((u) => u.weapons[0]?.kind))).not.toContain('sword');
      expect(view.campaign!.pendingBattle).toBeNull();
      await expect(director.say('Can I talk now?')).rejects.toThrow(/battle/);

      // Leave it, and the Narrator tells the aftermath.
      expect((await world.battleCommand({ type: 'retreat' })).ok).toBe(true);
      const record = await director.resolveBattle();
      expect(record.outcome).toBe('retreat');
      await director.whenIdle();
      view = await world.view();
      expect(view.battle).toBeNull();
      expect(narrations(view).at(-1)!.text).toMatch(/fall back|road/);
      expect(view.campaign!.battles).toHaveLength(1);
      expect(view.campaign!.facts.some((f) => f.text.includes('ended in retreat'))).toBe(true);
    } finally { director.dispose(); host.dispose(); }
  }, 180_000);

  it('automatically repairs a module that fails to load and one that throws at runtime, while play continues', async () => {
    const { world, director, host } = setup();
    const faults: ModuleFaultInfo[] = [];
    world.subscribe((e) => { if (e.type === 'faults') faults.push(...e.faults); });
    try {
      await director.create('A cozy farm where wolves attack from time to time.');
      await director.whenIdle();
      await director.say('Let me plant crops on the homestead. [FORCE_BROKEN_MODULE]');
      await director.whenIdle();
      let view = await world.view();
      const tasks = director.status().tasks;
      expect(tasks.filter((t) => t.kind === 'helper').map((t) => t.status)).toEqual(['failed']);
      expect(tasks.find((t) => t.kind === 'helper')!.error).toMatch(/thisFunctionDoesNotExist|not defined/);
      expect(tasks.filter((t) => t.kind === 'repair').map((t) => t.status)).toEqual(['done']);
      expect(view.modules.find((m) => m.id === 'cozy-farm')!.status).toBe('loaded');
      expect(view.campaign!.vars.farm.plots).toHaveLength(8);
      expect(view.chat.some((m) => m.text.startsWith('✦ Repaired: Repair modules/cozy-farm.js'))).toBe(true);
      // The repaired system works.
      expect((await world.runCommand('farm.sleep', {})).ok).toBe(true);

      // A helper writes code that loads fine but throws during play.
      const { director: d2, host: h2, world: w2 } = setup();
      const faults2: ModuleFaultInfo[] = [];
      w2.subscribe((e) => { if (e.type === 'faults') faults2.push(...e.faults); });
      try {
        await d2.create('A cozy farm with wolves.');
        await d2.whenIdle();
        await d2.say('I tend the homestead and plant seeds. [FORCE_RUNTIME_FAULT]');
        await d2.whenIdle();
        expect((await w2.view()).modules.find((m) => m.id === 'cozy-farm')!.status).toBe('loaded');
        const started = await w2.startBattle({ title: 'Test', map: { width: 10, height: 8 }, units: [{ roster: 'all', faction: 'player' }, { name: 'Wolf', faction: 'enemy', area: 'east' }] });
        expect(started.ok).toBe(true); // the faulting hook was switched off and the battle still began
        expect(faults2.map((f) => [f.moduleId, f.where])).toEqual([['cozy-farm', 'hook phase:start']]);
        await d2.whenIdle();
        const repaired = d2.status().tasks.filter((t) => t.kind === 'repair');
        expect(repaired.map((t) => t.status)).toEqual(['done']);
        const v2 = await w2.view();
        expect(v2.modules.find((m) => m.id === 'cozy-farm')).toMatchObject({ status: 'loaded', error: null });
        expect(v2.chat.some((m) => m.kind === 'error' && m.text.includes('switched off while a helper repairs it'))).toBe(true);
        expect((await w2.battleCommand({ type: 'endPhase' })).ok).toBe(true);
      } finally { d2.dispose(); h2.dispose(); }
      expect(faults).toEqual([]);
    } finally { director.dispose(); host.dispose(); }
  }, 180_000);

  it('gives up after bounded repair attempts and reports it, without stopping the story', async () => {
    const { world, director, host } = setup();
    try {
      await director.create('A cozy farm with wolves.');
      await director.whenIdle();
      await director.say('Plant the crops. [FORCE_BROKEN_MODULE] [FORCE_REPAIR_FAILS]');
      await director.whenIdle();
      const view = await world.view();
      expect(director.status().tasks.filter((t) => t.kind === 'repair')).toHaveLength(2);
      expect(view.modules.find((m) => m.id === 'cozy-farm')!.status).toBe('error');
      expect(view.chat.some((m) => m.kind === 'error' && m.text.includes('still failing after 2 repair attempts'))).toBe(true);
      await director.say('I go to bed.');
      await director.whenIdle();
      expect(narrations(await world.view())).toHaveLength(3);
    } finally { director.dispose(); host.dispose(); }
  }, 180_000);

  it('surfaces provider failures with a retry, and keeps the player message', async () => {
    const { world, director, host } = setup();
    try {
      await director.create('A quiet harbour town.');
      await director.whenIdle();
      await director.say('I look at the boats. [FORCE_FAIL]');
      await director.whenIdle();
      const status = director.status();
      expect(status.error).toMatch(/Simulated provider failure/);
      expect(status.canRetry).toBe(true);
      expect((await world.view()).chat.at(-1)).toMatchObject({ role: 'player' });
    } finally { director.dispose(); host.dispose(); }
  }, 120_000);

  it('summarizes long campaigns into durable memory', async () => {
    const { world, director, host } = setup();
    try {
      await director.create('A quiet harbour town.');
      await director.whenIdle();
      for (let i = 0; i < 14; i++) { await director.say(`I chat with fisher number ${i} about the tides.`); await director.whenIdle(); }
      const view = await world.view();
      expect(view.campaign!.summarizedThrough).toBeGreaterThan(0);
      expect(view.campaign!.summary).toContain('Earlier');
      expect(director.status().tasks.some((t) => t.kind === 'archivist' && t.status === 'done')).toBe(true);
    } finally { director.dispose(); host.dispose(); }
  }, 180_000);
});

describe('prompt contracts', () => {
  it('normalizes tolerant Narrator output and keeps role selection fallbacks', () => {
    const turn = normalizeNarratorTurn({ narration: 'Hi', worldOps: [{ op: 'add', target: 'roster', valueJson: '{"name":"A"}' }, { bogus: true }], commands: [{ name: 'farm.sleep', argsJson: '' }], helpers: [{ title: 'X', brief: '  ' }], battle: { start: true, specJson: '{' } });
    expect(turn.worldOps).toEqual([{ op: 'add', target: 'roster', value: { name: 'A' } }]);
    expect(turn.commands).toEqual([{ name: 'farm.sleep', args: {} }]);
    expect(turn.helpers).toEqual([]);
    expect(turn.battle).toMatchObject({ start: true, specJson: '{', title: 'Encounter' });
    expect(normalizeNarratorTurn(null).narration).toBe('…');
    expect(storySelection(DEFAULT_PROVIDER_SETTINGS, 'narrator')).toEqual(DEFAULT_PROVIDER_SETTINGS.chronicler);
    expect(storySelection({ ...DEFAULT_PROVIDER_SETTINGS, helper: { providerId: 'claudeAgent', model: 'claude-opus-4-6' } }, 'helper').model).toBe('claude-opus-4-6');
  });
});

describe('watchdog', () => {
  it('kills a world worker stuck in a generated infinite loop, quarantines the module and recovers the campaign', async () => {
    const dir = tempDir('chronicle-watchdog-');
    const workerPath = path.resolve(__dirname, '../dist/main/worldWorker.cjs');
    expect(existsSync(workerPath)).toBe(true);
    const world = createWorldClient({ dbPath: path.join(dir, 'campaigns.sqlite'), workspacesDir: path.join(dir, 'campaigns'), contentDir: CONTENT, aiDelayMs: 5, workerPath, timeoutMs: 3000 });
    const faults: ModuleFaultInfo[] = [];
    world.subscribe((e) => { if (e.type === 'faults') faults.push(...e.faults); });
    try {
      const view = await world.createCampaign('A test of patience.');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path.join(view.workspace, 'modules/hang.js'), "export default { id: 'hang', setup(api) { api.on('phase:start', () => { for (;;) {} }); } };");
      await world.applyNarratorTurn({ ops: [{ op: 'add', target: 'roster', value: { name: 'Pip' } }] });
      expect((await world.reloadModules()).errors).toEqual([]);
      const spec = { title: 'Loop', map: { width: 6, height: 6 }, units: [{ roster: 'all', faction: 'player' }, { name: 'Foe', faction: 'enemy', area: 'east' }] };
      await expect(world.startBattle(spec)).rejects.toThrow(/timed out/);
      await expect.poll(() => faults.map((f) => f.moduleId), { timeout: 20_000 }).toEqual(['hang']);
      const recovered = await world.view();
      expect(recovered.campaign!.roster.map((r) => r.name)).toEqual(['Pip']);
      expect(recovered.modules.find((m) => m.id === 'hang')!.status).toBe('faulted');
      expect(await world.startBattle(spec)).toEqual({ ok: true, error: null });
      expect((await world.view()).battle!.state.units).toHaveLength(2);
    } finally { world.dispose(); }
  }, 60_000);
});
