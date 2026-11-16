import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { combatNumbers, computeReachableTiles, inRange, manhattan } from '../src/rules/battle';
import type { BattleSnapshot, BattleState, GameCommand } from '../src/shared/contracts';

let app: ElectronApplication | undefined;
let page: Page;
let errors: string[];

const snap = (): Promise<BattleSnapshot> => page.evaluate(() => window.chronicleApi.getSnapshot());

async function launch(profile: string, extraEnv: Record<string, string> = {}): Promise<void> {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    timeout: 120_000,
    args: [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`],
    env: {
      ...env,
      CHRONICLE_HEADLESS: '1',
      CHRONICLE_ENEMY_DELAY_MS: '60',
      CHRONICLE_FAKE_PROVIDER: '1',
      ...extraEnv,
    },
  });
  page = await app.firstWindow({ timeout: 120_000 });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByTestId('continue-battle-btn').click();
  await expect(page.getByTestId('battle-canvas')).toBeVisible();
}

async function close(): Promise<void> {
  const running = app;
  app = undefined;
  if (running) await running.close();
}

async function tile(x: number, y: number): Promise<void> {
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
  const box = await page.getByTestId('battle-canvas').boundingBox();
  if (!box) throw new Error('Missing canvas');
  await page.mouse.click(box.x + ((x + 0.5) * box.width) / 10, box.y + ((y + 0.5) * box.height) / 10);
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
}

async function hoverTile(x: number, y: number): Promise<void> {
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'false');
  const canvas = page.getByTestId('battle-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing canvas');
  await canvas.hover({
    position: {
      x: ((x + 0.5) * box.width) / 10,
      y: ((y + 0.5) * box.height) / 10,
    },
  });
}

async function command(c: GameCommand): Promise<BattleSnapshot> {
  const r = await page.evaluate((cmd) => window.chronicleApi.dispatch(cmd), c);
  expect(r.ok, r.error ?? '').toBe(true);
  return r.snapshot;
}

async function settled(): Promise<BattleSnapshot> {
  await expect
    .poll(async () => {
      const s = await snap();
      return s.state.phase === 'player' || s.state.status !== 'ongoing';
    })
    .toBe(true);
  return snap();
}

test.beforeEach(async () => {
  errors = [];
  await launch(test.info().outputPath('profile'));
});

test.afterEach(async () => {
  await close();
  expect(errors).toEqual([]);
});

test('real compositor renders 100 tiles; drawn canvas cells hit correctly at native and scaled sizes', async () => {
  for (const size of [560, 420]) {
    await page.getByTestId('battle-canvas').evaluate((c, sz) => {
      c.style.width = `${sz}px`;
      c.style.height = `${sz}px`;
    }, size);
    const pixels = async () => {
      const box = await page.getByTestId('battle-canvas').boundingBox();
      if (!box || !app) throw new Error('No board');
      return app.evaluate(async ({ BrowserWindow }, rect) => {
        const image = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
        const { width, height } = image.getSize();
        const data = image.toBitmap();
        let nonBackground = 0;
        const colors = new Set<string>();
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const b = data[i]!;
            const g = data[i + 1]!;
            const r = data[i + 2]!;
            if (Math.abs(r - 231) + Math.abs(g - 220) + Math.abs(b - 195) > 15) nonBackground++;
          }
        }
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 10; x++) {
            const i = (Math.floor(((y + 0.5) * height) / 10) * width + Math.floor(((x + 0.1) * width) / 10)) * 4;
            colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          }
        }
        return { nonBackground, area: width * height, colors: colors.size };
      }, box);
    };
    await expect.poll(async () => (await pixels()).colors).toBeGreaterThanOrEqual(4);
    const painted = await pixels();
    expect(painted.nonBackground).toBeGreaterThan(painted.area / 3);
    await tile(1, 2);
    await expect(page.getByTestId('unit-card-player_vanguard')).toHaveClass(/is-selected/);
    await tile(3, 2);
    await expect(page.getByTestId('unit-card-player_vanguard')).toContainText('Pos (3, 2)');
    await page.evaluate(() => window.chronicleApi.restart());
    await expect(page.getByTestId('unit-card-player_vanguard')).toContainText('Pos (1, 2)');
    await expect(page.getByTestId('unit-card-player_vanguard')).not.toHaveClass(/is-selected/);
  }
});

test('(e) Direct attack without confirmation modal: hover forecast -> click resolves immediately -> Turnwheel undoes; bump & Borrowed Second', async () => {
  await expect(page.getByTestId('confirm-attack-btn')).toHaveCount(0);

  await tile(1, 2);
  await tile(3, 2);
  await page.getByTestId('attack-btn').click();
  await expect(page.getByTestId('target-prompt')).toBeVisible();

  const before = await snap();
  await hoverTile(4, 2);
  await expect(page.getByTestId('forecast-card')).toBeVisible();
  expect((await snap()).state.rngPosition).toBe(before.state.rngPosition);

  const forecast = await page.evaluate(() => window.chronicleApi.forecast('player_vanguard', 'enemy_raider'));
  await expect(page.getByTestId('confirm-attack-btn')).toHaveCount(0);

  // Clicking attackable enemy resolves ATTACK_UNIT immediately
  await tile(4, 2);
  await expect.poll(async () => (await snap()).state.commandOrdinal).toBe(before.state.commandOrdinal + 1);
  const after = await snap();
  const hp = Object.fromEntries(after.state.units.map((u) => [u.id, u.hp]));
  expect(forecast.branches.some((b) => JSON.stringify(b.hp) === JSON.stringify(hp))).toBe(true);
  await expect(page.getByTestId('unit-card-enemy_raider')).toContainText(`HP ${hp.enemy_raider}/`);

  await page.getByTestId('ability-btn').click();
  await expect.poll(async () => (await snap()).state.units[0]!.statuses.length).toBe(1);
  const borrowed = await snap();
  expect(borrowed.state.units[0]!.actionCredits).toBe(1);
  expect(borrowed.state.units[0]!.hp).toBe(after.state.units[0]!.hp - 3);

  // Rewind the ability then the attack, so bump-attack is tested against the same exchange
  await page.getByTestId('rewind-btn').click();
  await page.getByTestId('rewind-btn').click();
  await expect.poll(async () => (await snap()).stateHash).toBe(before.stateHash);

  if (!(await snap()).state.selectedUnitId) await tile(3, 2);
  await hoverTile(4, 2);
  await expect(page.getByTestId('forecast-card')).toContainText('Click target to resolve immediately');
  await tile(4, 2);
  await expect.poll(async () => (await snap()).stateHash).toBe(after.stateHash);
  expect((await snap()).rewindsLeft).toBe(1);
});

test('Save -> quit -> relaunch -> load preserves identical state/hash, debt and nonrefundable Turnwheel ledger', async () => {
  await tile(1, 2);
  await page.getByTestId('ability-btn').click();
  await tile(3, 2);
  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('notice')).toHaveText('Saved to SQLite.');
  const saved = await snap();
  await close();

  await launch(test.info().outputPath('profile'));
  await page.getByTestId('load-btn').click();
  await expect(page.getByTestId('notice')).toHaveText('Loaded checkpoint.');
  const loaded = await snap();
  expect(loaded.state).toEqual(saved.state);
  expect(loaded.stateHash).toBe(saved.stateHash);
  await page.getByTestId('rewind-btn').click();
  const rewound = await snap();
  expect(rewound.rewindsLeft).toBe(2);
  expect(rewound.state.units[0]!.pos).toEqual({ x: 1, y: 2 });
  await page.getByTestId('load-btn').click();
  await expect.poll(async () => (await snap()).stateHash).toBe(saved.stateHash);
  expect((await snap()).rewindsLeft).toBe(2);
});

test('(f) Step-by-step Enemy Phase replay displays actions and Skip completes immediately; Danger Zone toggles cleanly', async () => {
  await page.getByTestId('danger-zone-btn').click();
  await expect(page.getByTestId('danger-zone-btn')).toHaveText('Danger Zone: On');
  await page.getByTestId('danger-zone-btn').click();
  await expect(page.getByTestId('danger-zone-btn')).toHaveText('Danger Zone: Off');

  await page.getByTestId('enemy-speed-select').selectOption('slow');
  await page.getByTestId('end-phase-btn').click();

  await expect(page.getByTestId('enemy-phase-playback')).toBeVisible();
  await expect(page.getByTestId('enemy-phase-step')).not.toBeEmpty();
  await expect(page.getByTestId('skip-enemy-phase-btn')).toBeVisible();
  await page.getByTestId('skip-enemy-phase-btn').click();

  await expect(page.getByTestId('enemy-phase-playback')).toBeHidden();
  await expect(page.getByTestId('end-phase-btn')).toBeEnabled();
  const after = await settled();
  expect(after.state.enemyPhaseTrace && after.state.enemyPhaseTrace.length > 0).toBe(true);
});

test('(b) Providers & Models settings persist across relaunch and show disabled reasons', async () => {
  const profile = test.info().outputPath('profile');
  await page.getByTestId('tab-providers').click();
  await expect(page.getByTestId('providers-panel')).toBeVisible();
  await expect(page.getByTestId('sidecar-status')).toContainText('Connected', { timeout: 120_000 });
  await expect(page.getByTestId('provider-card-codex')).toBeVisible();
  await expect(page.getByTestId('provider-card-codex')).toContainText('Model does not support structured JSON generation.');

  await page.getByTestId('architect-model-select').selectOption('gpt-5.3-codex');
  await page.getByTestId('architect-effort-select').selectOption('medium');
  await page.getByTestId('chronicler-model-select').selectOption('gpt-6.1-terra');
  await page.getByTestId('chronicler-effort-select').selectOption('high');
  await page.getByTestId('save-provider-settings-btn').click();
  await expect(page.getByTestId('settings-saved-notice')).toContainText('saved to SQLite');

  await close();
  await launch(profile);
  await page.getByTestId('tab-providers').click();
  await expect(page.getByTestId('architect-model-select')).toHaveValue('gpt-5.3-codex');
  await expect(page.getByTestId('architect-effort-select')).toHaveValue('medium');
  await expect(page.getByTestId('chronicler-model-select')).toHaveValue('gpt-6.1-terra');
  await expect(page.getByTestId('chronicler-effort-select')).toHaveValue('high');
});

test('(c) New Campaign generates a validated chapter via sidecar FakeProvider and launches a playable battle', async () => {
  await page.getByTestId('tab-campaign').click();
  await expect(page.getByTestId('campaign-panel')).toBeVisible();
  await page.getByTestId('premise-input').fill('Hold the flooded bridge against ironclad raiders.');
  await page.getByTestId('generate-chapter-btn').click();

  await expect(page.getByTestId('stage-indicator')).toHaveAttribute('data-stage', 'completed', {
    timeout: 120_000,
  });
  await expect(page.getByTestId('chapter-source-badge')).toContainText('Generated');
  const previewTitle = (await page.getByTestId('preview-title').textContent()) ?? '';
  expect(previewTitle.length).toBeGreaterThan(3);

  await page.getByTestId('play-chapter-btn').click();
  await expect(page.getByTestId('battle-canvas')).toBeVisible();
  await expect(page.getByTestId('chapter-title-pill')).toHaveText(previewTitle);
  await expect(page.getByTestId('active-chapter-source')).toHaveText('Generated');

  const launched = await snap();
  expect(launched.state.chapterTitle).toBe(previewTitle);
  const hero = launched.state.units.find((u) => u.faction === 'player' && u.alive)!;
  await command({ type: 'SELECT_UNIT', unitId: hero.id });
  const moved = await snap();
  expect(moved.state.selectedUnitId).toBe(hero.id);
});

test('(d) Generation falls back cleanly to Local Fallback when no providers are authenticated and launches playably', async () => {
  await close();
  await launch(test.info().outputPath('profile-fallback'), {
    CHRONICLE_FAKE_PROVIDER: '1',
    CHRONICLE_FAKE_MODE: 'no-providers',
  });

  await page.getByTestId('tab-campaign').click();
  await page.getByTestId('premise-input').fill('Hold the shattered gate against dusk scouts.');
  await page.getByTestId('generate-chapter-btn').click();

  await expect(page.getByTestId('stage-indicator')).toHaveAttribute('data-stage', 'fallback', {
    timeout: 120_000,
  });
  await expect(page.getByTestId('chapter-source-badge')).toHaveText('Local Fallback');
  await expect(page.getByTestId('fallback-reason')).toBeVisible();

  await page.getByTestId('play-chapter-btn').click();
  await expect(page.getByTestId('battle-canvas')).toBeVisible();
  await expect(page.getByTestId('active-chapter-source')).toHaveText('Local Fallback');
});

async function playToVictory(): Promise<BattleState> {
  for (let phase = 0; phase < 16; phase++) {
    let s = (await settled()).state;
    if (s.status !== 'ongoing') return s;
    const ids = s.units.filter((u) => u.alive && u.faction === 'player').map((u) => u.id);
    for (const id of ids) {
      s = (await snap()).state;
      if (s.status !== 'ongoing' || s.phase !== 'player') break;
      const u = s.units.find((u) => u.id === id)!;
      if (!u.alive || !u.actionCredits) continue;
      const positions = [u.pos, ...computeReachableTiles(s, id)];
      const targets = s.units.filter((t) => t.alive && t.faction === 'enemy');
      const candidates = positions
        .flatMap((pos) =>
          targets
            .filter((t) => inRange(s, { ...u, pos }, t))
            .map((t) => {
              const c = combatNumbers(s, u, t);
              return { pos, t, score: (c.baseDamage >= t.hp ? 100000 : 0) + c.baseDamage * c.hitBP - t.hp * 10 };
            }),
        )
        .sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));
      const best = candidates[0];
      if (best) {
        if (best.pos.x !== u.pos.x || best.pos.y !== u.pos.y) {
          await command({ type: 'MOVE_UNIT', unitId: id, to: best.pos });
        }
        await command({ type: 'ATTACK_UNIT', attackerId: id, targetId: best.t.id });
      } else {
        positions.sort(
          (a, b) =>
            Math.min(...targets.map((t) => manhattan(a, t.pos))) -
            Math.min(...targets.map((t) => manhattan(b, t.pos))),
        );
        const pos = positions[0]!;
        if (pos.x !== u.pos.x || pos.y !== u.pos.y) {
          await command({ type: 'MOVE_UNIT', unitId: id, to: pos });
        }
        await command({ type: 'WAIT_UNIT', unitId: id });
      }
    }
    s = (await snap()).state;
    if (s.status !== 'ongoing') return s;
    if (s.phase === 'player') await command({ type: 'END_PHASE' });
  }
  return (await settled()).state;
}

test('plays the authored battle to victory using legal actions', async () => {
  const s = await playToVictory();
  expect(s.status).toBe('victory');
  await expect(page.getByTestId('end-title')).toHaveText('VICTORY');
  expect(s.units.filter((u) => u.faction === 'enemy').every((u) => !u.alive)).toBe(true);
});

test('plays the authored battle to combat defeat; terminal commands freeze state', async () => {
  await page.getByTestId('enemy-speed-select').selectOption('fast');
  let s = (await snap()).state;
  for (let turn = 0; turn < 16 && s.status === 'ongoing'; turn++) {
    await expect(page.getByTestId('end-phase-btn')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('end-phase-btn').click();
    s = (await settled()).state;
  }
  await expect(page.getByTestId('enemy-phase-playback')).toBeHidden({ timeout: 5_000 });
  expect(s.status).toBe('defeat');
  expect(s.endReason).toBe('all_allies_defeated');
  await expect(page.getByTestId('end-title')).toHaveText('DEFEAT');
  const r = await page.evaluate(() => window.chronicleApi.dispatch({ type: 'CONCEDE' }));
  expect(r.ok).toBe(false);
  expect(r.snapshot.state).toEqual(s);
  await page.getByTestId('restart-btn').click();
  await expect(page.getByTestId('end-screen')).toBeHidden();
});

test('retains Electron sandbox, permission denial, CSP and strict IPC', async () => {
  if (!app) throw new Error('No app');
  await expect
    .poll(async () =>
      app!.evaluate(
        ({ app, BrowserWindow }) =>
          app.getAppMetrics().find((m) => m.pid === BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId())
            ?.sandboxed,
      ),
    )
    .toBe(true);
  expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
  expect(
    await page.evaluate(() => [
      typeof (globalThis as Record<string, unknown>).require,
      typeof (globalThis as Record<string, unknown>).process,
    ]),
  ).toEqual(['undefined', 'undefined']);
  const csp = await page.evaluate(async () => (await fetch(location.href)).headers.get('content-security-policy'));
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-eval');
  const before = await snap();
  for (const c of [{ type: 'RUN_ENEMY_PHASE' }, { type: 'CONCEDE', extra: 1 }]) {
    const r = await page.evaluate((cmd) => window.chronicleApi.dispatch(cmd as GameCommand), c);
    expect(r.ok).toBe(false);
    expect(r.snapshot.stateHash).toBe(before.stateHash);
  }
});

test('(g) Hard-killing the Electron main process automatically kills the T3 sidecar via Win32 Job Object', async () => {
  if (process.platform !== 'win32') return;
  if (!app) throw new Error('No app');

  await expect
    .poll(async () => (await page.evaluate(() => window.chronicleApi.getSidecarStatus())).connected, {
      timeout: 120_000,
    })
    .toBe(true);

  const sidecarStatus = await page.evaluate(() => window.chronicleApi.getSidecarStatus());
  const sidecarPid = sidecarStatus.pid!;
  expect(sidecarPid).toBeGreaterThan(0);

  const wrapperPid = app.process().pid;
  const electronPid = await app.evaluate(() => process.pid);
  expect(electronPid).toBeGreaterThan(0);
  const childPids = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => m.pid));
  const deadApp = app;
  app = undefined;

  process.kill(electronPid, 'SIGKILL');

  await expect
    .poll(
      () => {
        try {
          process.kill(sidecarPid, 0);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 5_000 },
    )
    .toBe(false);

  for (const childPid of [...childPids, ...(wrapperPid ? [wrapperPid] : [])]) {
    if (childPid !== electronPid && childPid !== sidecarPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  }
  await Promise.race([deadApp.close().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
});

test.describe('Visual gallery', () => {
  test.setTimeout(180_000); // Ten compositor captures plus a full fake generation on disk.

test('atlas gallery: main screens, generation, ranges, enemy phase and epitaph', async () => {
  if (!app) throw new Error('No app');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 1000));
  const { mkdir } = await import('node:fs/promises');
  const directory = path.resolve(__dirname, '../docs/screenshots');
  await mkdir(directory, { recursive: true });
  const shot = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(directory, `${name}.png`), animations:'disabled' });
  };
  await page.getByTestId('tab-menu').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await shot('main-menu');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('motion-setting').selectOption('reduced');
  await shot('settings');
  await page.getByTestId('tab-providers').click();
  await expect(page.getByTestId('sidecar-status')).toContainText('Connected', { timeout: 120_000 });
  await expect(page.getByTestId('architect-model-select')).toBeVisible();
  await shot('providers');
  await page.getByTestId('tab-campaign').click();
  await shot('new-campaign');
  await page.getByTestId('premise-input').fill('Hold the flooded bridge against ironclad raiders. [FORCE_DELAY_MS=700]');
  await page.getByTestId('generate-chapter-btn').click();
  await expect(page.getByTestId('stage-indicator')).toHaveAttribute('data-stage', /planning|building/);
  await shot('generation');
  await expect(page.getByTestId('stage-indicator')).toHaveAttribute('data-stage', 'completed', { timeout: 120_000 });
  await shot('briefing');
  await page.getByTestId('tab-battle').click();
  await tile(1,2); await tile(3,2); // A committed move; another unit still has its range.
  await tile(1,4);
  await hoverTile(3,4);
  await page.getByTestId('danger-zone-btn').click();
  await expect(page.getByTestId('battle-canvas')).toHaveAttribute('data-animating','0');
  await shot('battle-ranges');
  await tile(3,2); await hoverTile(4,2);
  await expect(page.getByTestId('forecast-card')).toBeVisible();
  await shot('battle-forecast');
  await page.getByTestId('enemy-speed-select').selectOption('slow');
  await page.getByTestId('end-phase-btn').click();
  await expect(page.getByTestId('skip-enemy-phase-btn')).toBeVisible();
  await shot('enemy-phase');
  await page.getByTestId('skip-enemy-phase-btn').click();
  await page.getByTestId('concede-btn').click();
  await expect(page.getByTestId('end-screen')).toBeVisible();
  await shot('defeat');
});

});

test('reduced motion follows the OS, persists an override and removes travel without changing resolution', async () => {
  if (!app) throw new Error('No app');
  // Hidden Windows windows receive only one compositor frame per second.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.showInactive());
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-motion','reduced');
  await expect(page.getByTestId('battle-canvas')).toHaveAttribute('data-reduced-motion','true');
  const initial = await snap();
  await tile(1,2); await tile(3,2);
  await expect(page.getByTestId('battle-canvas')).toHaveAttribute('data-animating','0');
  const reduced = await snap();
  await page.evaluate(() => window.chronicleApi.restart());
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('motion-setting').selectOption('full');
  await page.getByTestId('tab-battle').click();
  await expect(page.getByTestId('battle-canvas')).toHaveAttribute('data-reduced-motion','false');
  await tile(1,2);
  await page.getByTestId('battle-canvas').evaluate(canvas => {
    canvas.dataset.motionObserved = 'false';
    const observer = new MutationObserver(() => {
      if (Number(canvas.dataset.animating) > 0) {
        canvas.dataset.motionObserved = 'true'; observer.disconnect();
      }
    });
    observer.observe(canvas, { attributes:true, attributeFilter:['data-animating'] });
  });
  await tile(3,2);
  await expect(page.getByTestId('battle-canvas')).toHaveAttribute('data-motion-observed','true');
  await expect(page.getByTestId('battle-canvas')).toHaveAttribute('data-animating','0');
  expect((await snap()).stateHash).toBe(reduced.stateHash);
  expect((await snap()).state.rngPosition).toBe(initial.state.rngPosition);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('motion-setting').selectOption('reduced');
  await page.reload();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('motion-setting')).toHaveValue('reduced');
});

test('atlas fits common window sizes and preserves keyboard selection', async () => {
  if (!app) throw new Error('No app');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.showInactive());
  for (const size of [{width:960,height:680},{width:1280,height:720},{width:1920,height:1080}]) {
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0]!.setContentSize(size.width,size.height),size);
    const dimensions=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
    const box=await page.getByTestId('battle-canvas').boundingBox();
    expect(box!.width).toBeGreaterThan(300);
    await tile(1,2);
    await expect(page.getByTestId('unit-card-player_vanguard')).toHaveClass(/is-selected/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('unit-card-player_vanguard')).not.toHaveClass(/is-selected/);
  }
  const cadence = await page.evaluate(async () => {
    const samples: number[] = [];
    let previous = performance.now();
    await new Promise<void>(resolve => {
      const frame = (now: number) => {
        samples.push(now - previous); previous = now;
        if (samples.length < 90) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    samples.sort((a,b)=>a-b);
    return { medianMs: samples[45], p95Ms: samples[85], viewport: `${innerWidth}x${innerHeight}` };
  });
  console.log('Atlas frame cadence (ambient board, shared test machine):', cadence);
  await test.info().attach('frame-cadence', { body:JSON.stringify(cadence), contentType:'application/json' });
  await page.keyboard.press('ArrowRight'); // default (1,2) -> (2,2)
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('unit-card-player_vanguard')).toHaveClass(/is-selected/);
});
