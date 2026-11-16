import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { BattleCommand, Coord, WorldView } from '../src/engine/types';

let app: ElectronApplication | undefined;
let page: Page;
let errors: string[];
const shots = path.resolve(__dirname, '../docs/screenshots');

async function launch(profile: string): Promise<void> {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    timeout: 120_000,
    args: [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`],
    env: { ...env, CHRONICLE_HEADLESS: '1', CHRONICLE_ENEMY_DELAY_MS: '40', CHRONICLE_FAKE_PROVIDER: '1' },
  });
  page = await app.firstWindow({ timeout: 120_000 });
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 960));
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 120_000 });
}
async function close(): Promise<void> { const running = app; app = undefined; if (running) await running.close(); }
const shot = async (name: string) => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(shots, `${name}.png`), animations: 'disabled' }); };
const view = (): Promise<WorldView> => page.evaluate(() => window.chronicleApi.world.view());
const command = (cmd: BattleCommand) => page.evaluate((c) => window.chronicleApi.world.battleCommand(c), cmd);
async function say(text: string): Promise<void> {
  await expect(page.getByTestId('chat-send')).toBeVisible();
  await expect(page.getByTestId('narrator-typing')).toHaveCount(0, { timeout: 60_000 });
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-input').press('Enter');
}
async function tileCenter(c: Coord): Promise<{ x: number; y: number }> {
  const canvas = page.getByTestId('world-canvas');
  const box = (await canvas.boundingBox())!;
  const cam = JSON.parse((await canvas.getAttribute('data-camera'))!) as { x: number; y: number; scale: number; tile: number };
  return { x: box.x + cam.x + (c.x + 0.5) * cam.tile * cam.scale, y: box.y + cam.y + (c.y + 0.5) * cam.tile * cam.scale };
}
async function playerTurn(): Promise<WorldView> {
  await expect.poll(async () => {
    const v = await view();
    const b = v.battle?.state;
    return !b || b.status !== 'ongoing' || b.factions[b.order[b.phaseIndex]!]!.controller === 'player';
  }, { timeout: 60_000 }).toBe(true);
  return view();
}

test.beforeEach(() => { errors = []; });
test.afterEach(async () => { await close(); expect(errors).toEqual([]); });

test('living campaign: setting → Narrator chat → helper builds catching + storage UI mid-chat → big battle with it → aftermath → second battle → save, restart, resume', async () => {
  test.setTimeout(420_000);
  await mkdir(shots, { recursive: true });
  const profile = test.info().outputPath('profile');
  await launch(profile);
  await shot('main-menu');

  await page.getByTestId('open-campaigns-btn').click();
  await expect(page.getByTestId('story-lobby')).toBeVisible();
  await page.getByTestId('example-setting-0').click();
  await expect(page.getByTestId('setting-input')).toHaveValue(/Pokémon-style/);
  await shot('campaign-lobby');
  await page.getByTestId('begin-campaign-btn').click();

  // Opening narration establishes the party.
  await expect(page.getByTestId('chat-narrator')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId('roster-list')).toContainText('Wren');
  await expect(page.getByTestId('roster-list')).toContainText('Cinder');

  // Ask for a new system; the helper builds it in the background while the chat continues.
  await say('I want to catch wild creatures and store them in a box. [FORCE_DELAY_MS=15000]');
  await expect(page.getByTestId('chat-narrator')).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId('builders-pill')).toBeVisible();
  await say('While that is built, I ask Cinder what she smells.');
  await expect(page.getByTestId('chat-narrator')).toHaveCount(3, { timeout: 60_000 });
  expect((await view()).modules.find((m) => m.id === 'creature-catching')).toBeUndefined(); // the chat was not blocked by the build
  await page.getByTestId('story-tab-activity').click();
  await expect(page.getByTestId('activity-feed').locator('[data-kind="helper"][data-status="running"]').first()).toBeVisible();
  await shot('story-activity');
  await expect(page.getByTestId('builders-pill')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByTestId('activity-feed').locator('[data-kind="helper"][data-status="done"]')).toHaveCount(2);

  // The generated storage UI is live.
  await page.getByTestId('story-tab-systems').click();
  await expect(page.getByTestId('module-creature-catching')).toHaveAttribute('data-status', 'loaded');
  await page.getByTestId('story-tab-panel:creature-box').click();
  await expect(page.getByTestId('creature-box-panel')).toContainText('Snare Orbs 8');
  await page.getByTestId('story-tab-world').click();
  await expect(page.getByTestId('inventory-list')).toContainText('Snare Orb');
  await shot('story-chat');
  await page.getByTestId('story-tab-panel:creature-box').click();
  await shot('creature-box');

  // The Narrator starts a battle that uses the new content.
  await say('Into the tall grass — let us battle the wild herds!');
  await expect(page.getByTestId('world-battle')).toBeVisible({ timeout: 90_000 });
  let v = await view();
  let battle = v.battle!.state;
  expect([battle.map.width, battle.map.height]).toEqual([40, 28]);
  expect(battle.units.length).toBeGreaterThanOrEqual(38);
  expect(battle.units.flatMap((u) => u.weapons.map((w) => w.kind)).some((k) => ['sword', 'lance', 'axe', 'bow', 'tome'].includes(k))).toBe(false);
  const wren = battle.units.find((u) => u.rosterId === 'wren')!;
  expect(wren.weapons.map((w) => w.name)).toEqual(['Thornwood Crook', 'Snare Sling']);
  expect(wren.abilities).toContain('throw-snare-orb');
  await expect(page.getByTestId('world-canvas')).toBeVisible();
  await expect(page.getByTestId('world-objective')).toContainText('Catch');

  // Select Wren on the board and inspect a target forecast.
  const at = await tileCenter(wren.pos);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('world-unit-card')).toContainText('Wren');
  await expect(page.getByTestId('world-ability-throw-snare-orb')).toBeVisible();
  const selection = await page.evaluate((id) => window.chronicleApi.world.battleSelect(id), wren.id);
  await page.getByTestId('battle-tab-forces').click();
  await expect(page.getByTestId('world-forces')).toContainText('Wild herds');
  await page.getByTestId('battle-tab-unit').click();
  await shot('world-battle');

  // Play: snare and orb wild creatures with Wren, let Cinder bite, end phases; the herds act in replay.
  let sawPlayback = false;
  for (let round = 0; round < 8; round++) {
    v = await playerTurn();
    battle = v.battle!.state;
    if (battle.status !== 'ongoing') break;
    const me = battle.units.find((u) => u.rosterId === 'wren' && u.alive);
    if (me) {
      const sel = (await page.evaluate((id) => window.chronicleApi.world.battleSelect(id), me.id))!;
      const orb = sel.abilities.find((a) => a.id === 'throw-snare-orb')!;
      if (orb.enabled) {
        if (round === 0) {
          await page.getByTestId('world-ability-throw-snare-orb').click().catch(() => {});
        }
        const r = await command({ type: 'ability', unit: me.id, ability: 'throw-snare-orb', target: orb.unitIds[0] });
        expect(r.ok, r.error ?? '').toBe(true);
      } else if (sel.targets.length) {
        const t = sel.targets.find((x) => sel.weapons[x.weapon]?.name === 'Snare Sling') ?? sel.targets[0]!;
        if (round === 0 && t.from) {
          const target = battle.units.find((u) => u.id === t.id)!;
          const p = await tileCenter(target.pos);
          await page.mouse.move(p.x, p.y);
          await expect(page.getByTestId('world-forecast')).toBeVisible();
          await shot('world-forecast');
        }
        await command({ type: 'attack', unit: me.id, target: t.id, weapon: t.weapon, ...(t.from ? { from: t.from } : {}) });
      }
    }
    v = await view();
    battle = v.battle!.state;
    if (battle.status !== 'ongoing') break;
    if (battle.factions[battle.order[battle.phaseIndex]!]!.controller === 'player') {
      await page.getByTestId('world-speed').selectOption('slow');
      await page.getByTestId('world-end-phase').click();
    }
    if (!sawPlayback) {
      sawPlayback = await page.getByTestId('world-playback-step').filter({ hasText: /\w/ }).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      if (sawPlayback) await shot('world-enemy-phase');
    }
    if (await page.getByTestId('world-skip').isVisible().catch(() => false)) await page.getByTestId('world-skip').click().catch(() => {});
  }
  expect(selection!.weapons.length).toBe(2);
  v = await view();
  if (v.battle!.state.status === 'ongoing') expect((await command({ type: 'retreat' })).ok).toBe(true);
  await expect(page.getByTestId('world-end-screen')).toBeVisible({ timeout: 60_000 });
  const first = (await view()).battle!.state;
  await shot('world-battle-end');
  const narrationsBefore = await page.evaluate(async () => (await window.chronicleApi.world.view()).chat.filter((m) => m.role === 'narrator').length);
  await page.getByTestId('world-resolve').click();

  // The outcome flows back into the story.
  await expect(page.getByTestId('story-screen')).toBeVisible();
  await expect(page.getByTestId('chat-narrator')).toHaveCount(narrationsBefore + 1, { timeout: 60_000 });
  v = await view();
  expect(v.campaign!.battles).toHaveLength(1);
  expect(v.campaign!.battles[0]!.outcome).toBe(first.outcome);
  expect(v.chat.some((m) => m.kind === 'battle' && m.text.includes(first.title))).toBe(true);
  for (const name of first.result.captured.map((u: { name: string }) => u.name)) expect(v.campaign!.roster.map((r) => r.name)).toContain(name);
  const orbsLeft = v.campaign!.inventory.find((i) => i.id === 'snare-orb')?.qty ?? 0;
  expect(orbsLeft).toBeLessThanOrEqual(8);

  // A second battle in the same campaign.
  await say('A rival blocks the ford — duel him in battle!');
  await expect(page.getByTestId('world-battle')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('world-battle-title')).toHaveText('Rival at the Ford');
  v = await playerTurn();
  const second = v.battle!.state;
  const mover = second.units.find((u) => u.rosterId === 'wren' && u.alive) ?? second.units.find((u) => u.rosterId && u.alive)!;
  const reach = (await page.evaluate((id) => window.chronicleApi.world.battleSelect(id), mover.id))!.reachable;
  expect((await command({ type: 'move', unit: mover.id, to: reach[0]! })).ok).toBe(true);
  const saved = await view();

  // Saves are continuous: quit mid-battle and resume after a restart.
  await close();
  await launch(profile);
  await page.getByTestId('open-campaigns-btn').click();
  await expect(page.getByTestId('campaign-list')).toContainText('mid-battle');
  await page.locator('[data-testid^="continue-campaign-"]').first().click();
  await expect(page.getByTestId('world-battle')).toBeVisible({ timeout: 60_000 });
  const resumed = await view();
  expect(resumed.battle!.hash).toBe(saved.battle!.hash);
  expect(resumed.campaign).toEqual({ ...saved.campaign, updatedAt: resumed.campaign!.updatedAt });
  expect(resumed.chat).toEqual(saved.chat);
  await expect(page.getByTestId('world-rewind')).toBeEnabled();
  await page.getByTestId('world-rewind').click();
  await expect.poll(async () => (await view()).battle!.state.units.find((u) => u.id === mover.id)!.pos).toEqual(mover.pos);
  await page.getByTestId('world-retreat').click();
  await expect(page.getByTestId('world-end-screen')).toBeVisible();
  await page.getByTestId('world-resolve').click();
  await expect(page.getByTestId('story-screen')).toBeVisible();
  await expect.poll(async () => (await view()).campaign!.battles.map((b) => b.outcome), { timeout: 60_000 }).toEqual([first.outcome, 'retreat']);
  await expect(page.getByTestId('narrator-typing')).toHaveCount(0, { timeout: 60_000 });
});

test('a different setting builds a structurally different game: System levels/skills UI and a non-grid Battle Net duel', async () => {
  test.setTimeout(240_000);
  await mkdir(shots, { recursive: true });
  await launch(test.info().outputPath('profile'));
  await page.getByTestId('open-campaigns-btn').click();
  await page.getByTestId('example-setting-1').click();
  await page.getByTestId('begin-campaign-btn').click();
  await expect(page.getByTestId('chat-narrator')).toHaveCount(1, { timeout: 60_000 });
  await say('Check my status window and skills.');
  await expect(page.getByTestId('chat-narrator')).toHaveCount(2, { timeout: 60_000 });
  await expect.poll(async () => (await view()).modules.map((m) => `${m.id}:${m.status}`), { timeout: 90_000 }).toEqual(['system-apocalypse:loaded']);
  await page.getByTestId('story-tab-panel:system-interface').click();
  await expect(page.getByTestId('system-panel')).toContainText('Cull the Hollowed');
  await shot('system-interface');
  await say('I accept the System’s Battle Net duel.');
  await expect(page.getByTestId('world-battle')).toHaveAttribute('data-mode', 'net-duel', { timeout: 90_000 });
  await expect(page.getByTestId('net-duel')).toBeVisible();
  await expect(page.getByTestId('world-canvas')).toHaveCount(0); // no grid at all
  for (let i = 0; i < 40 && (await view()).battle?.state.status === 'ongoing'; i++) {
    await page.getByTestId(['stance-strike', 'stance-guard', 'stance-overclock'][i % 3]!).click();
    await expect(page.getByTestId('net-duel-last')).toBeVisible();
    if (i === 0 && (await view()).battle?.state.status === 'ongoing') await shot('net-duel');
  }
  await expect(page.getByTestId('world-end-screen')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('world-resolve').click();
  await expect(page.getByTestId('story-screen')).toBeVisible();
  await expect.poll(async () => (await view()).campaign!.battles.length, { timeout: 60_000 }).toBe(1);
});

test('audio settings persist; providers show Narrator and Helper slots', async () => {
  await launch(test.info().outputPath('profile'));
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('audio-music').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.getByTestId('audio-mute').check();
  await page.getByTestId('audio-calm').selectOption('on');
  await page.getByTestId('tab-providers').click();
  await expect(page.getByTestId('slot-narrator')).toBeVisible();
  await expect(page.getByTestId('slot-helper')).toBeVisible();
  await page.getByTestId('narrator-model-select').selectOption('gpt-5.3-codex');
  await page.getByTestId('helper-concurrency-select').selectOption('4');
  await page.getByTestId('save-provider-settings-btn').click();
  await expect(page.getByTestId('settings-saved-notice')).toContainText('saved');
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('audio-music')).toHaveValue('30');
  await expect(page.getByTestId('audio-mute')).toBeChecked();
  await expect(page.getByTestId('audio-calm')).toHaveValue('on');
  await page.getByTestId('tab-providers').click();
  await expect(page.getByTestId('narrator-model-select')).toHaveValue('gpt-5.3-codex');
  await expect(page.getByTestId('helper-concurrency-select')).toHaveValue('4');
});
