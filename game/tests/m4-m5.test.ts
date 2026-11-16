import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameHost } from '../src/main/battleHost';
import { GenerationCoordinator } from '../src/main/generationCoordinator';
import { SaveStore } from '../src/main/saveStore';
import { T3SidecarManager } from '../src/main/t3Sidecar';
import { applyCommand, computeFactionThreatTiles, computeStateHash } from '../src/rules/battle';
import { createImpossibleSeizeFixture, validateChapterBuild, validateChapterPlan } from '../src/rules/campaign';
import type { BattleState, GenerationProgressEvent, ProviderSettings } from '../src/shared/contracts';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  }
});

describe('M4 Sidecar lifecycle, --game-profile RPC allowlist & Job Object cleanup', () => {
  it('starts isolated sidecar in fake mode, blocks non-profile RPCs, manages provider auth, and disposes cleanly', async () => {
    const dir = makeTempDir('chronicle-m4-sidecar-');
    const sidecar = new T3SidecarManager({ baseDir: dir, fakeMode: true });
    try {
      const status = await sidecar.ensureStarted();
      expect(status.connected).toBe(true);
      expect(status.fakeMode).toBe(true);
      expect(status.pid).toBeGreaterThan(0);
      expect(status.baseDir).toBe(path.resolve(dir));

      const providers = await sidecar.listProviders();
      expect(providers.length).toBeGreaterThanOrEqual(2);
      const codex = providers.find((p) => p.instanceId === 'codex');
      expect(codex?.authStatus).toBe('authenticated');
      expect(codex?.models.some((m) => m.selectable)).toBe(true);

      // Auth roundtrip through T3 RPCs stays isolated inside baseDir
      const loggedOut = await sidecar.logoutProvider('codex');
      expect(loggedOut.authStatus).toBe('unauthenticated');
      const startedAuth = await sidecar.startProviderAuth('codex');
      expect(startedAuth.activeFlow?.phase).toBe('waiting');
      const flowId = startedAuth.activeFlow?.flowId;
      expect(flowId).toBeTruthy();
      const finishedAuth = await sidecar.respondProviderAuth('codex', flowId!, {
        type: 'browser',
        action: 'complete',
      });
      expect(finishedAuth.authStatus).toBe('authenticated');
      expect(existsSync(path.join(dir, 'userdata', 'fake-providers.json'))).toBe(true);

      // Non-game-profile RPCs must be rejected by RpcAuthorization
      await expect(sidecar.rawRpcCall('server.reclaimDatabaseSpace', {})).rejects.toThrow(
        /game-profile|disabled|authorization/i,
      );
      await expect(
        sidecar.rawRpcCall('terminal.close', { threadId: 't1', terminalId: 'term-1' }),
      ).rejects.toThrow(/game-profile|disabled|authorization/i);
    } finally {
      sidecar.dispose();
    }
  }, 180_000);

  it('kills sidecar process automatically via Win32 Job Object when parent is force-killed', async () => {
    if (process.platform !== 'win32') return;
    const dir = makeTempDir('chronicle-m4-job-');
    const infoFile = path.join(dir, 'sidecar-pid.json');
    const runnerScript = `
      const { writeFileSync } = require('node:fs');
      const path = require('node:path');
      const addon = require(path.resolve('dist/native/job_object.node'));
      const job = addon.createJob();
      const spawned = addon.spawnSuspendedAndAssign({
        jobHandle: job,
        applicationName: process.execPath,
        commandLine: '"' + process.execPath + '" -e "setInterval(() => {}, 1000)"',
        cwd: process.cwd(),
      });
      addon.writeAndCloseHandle(spawned.stdinHandle, '');
      writeFileSync(process.argv[1], JSON.stringify({ pid: spawned.pid }));
      setInterval(() => {}, 1000);
    `;

    const parent = spawn(process.execPath, ['-e', runnerScript, infoFile], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'ignore',
    });

    try {
      const deadline = Date.now() + 8000;
      while (!existsSync(infoFile) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(existsSync(infoFile)).toBe(true);
      const { pid: childPid } = JSON.parse(readFileSync(infoFile, 'utf8')) as { pid: number };
      expect(childPid).toBeGreaterThan(0);

      // Force-kill parent (SIGKILL on Windows calls TerminateProcess) without graceful shutdown
      parent.kill('SIGKILL');
      await new Promise((resolve) => parent.once('exit', resolve));
      await new Promise((r) => setTimeout(r, 200));

      // Verify grandchild inside Job Object is dead
      let alive = true;
      try {
        process.kill(childPid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    } finally {
      try {
        parent.kill('SIGKILL');
      } catch {
        // already exited
      }
    }
  }, 15_000);
});

describe('M5 Generation staging, validation, repair, fallback & SQLite CAS', () => {
  it('runs Plan -> Build -> Validate -> Publish with FakeProvider and rejects invalid Rule IR', async () => {
    const dir = makeTempDir('chronicle-m5-gen-');
    const store = new SaveStore(path.join(dir, 'battle.sqlite'));
    const sidecar = new T3SidecarManager({ baseDir: path.join(dir, 't3-home'), fakeMode: true });
    const coordinator = new GenerationCoordinator(sidecar, store);
    const events: GenerationProgressEvent[] = [];
    coordinator.subscribe((e) => events.push(e));

    try {
      const { attemptId } = coordinator.startGeneration('Hold the sunken bridge with blazing lances.');
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Generation timed out')), 120_000);
        const check = () => {
          const last = events.at(-1);
          if (last && last.attemptId === attemptId && (last.stage === 'completed' || last.stage === 'fallback')) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      const finalEvent = events.at(-1)!;
      expect(finalEvent.stage).toBe('completed');
      expect(finalEvent.preview?.source).toBe('generated');
      expect(finalEvent.preview?.repaired).toBe(false);
      expect(finalEvent.preview?.battleState.units.length).toBeGreaterThanOrEqual(5);

      const host = new GameHost(50, path.join(dir, 'battle.sqlite'));
      const launched = host.launchChapter(finalEvent.preview!.battleState);
      expect(launched.state.chapterTitle).toBe(finalEvent.preview!.title);
      host.dispose();
    } finally {
      sidecar.dispose();
      store.close();
    }
  }, 180_000);

  it('repairs once on [FORCE_REPAIR_ONCE] and falls back cleanly on [FORCE_INVALID_ALWAYS]', async () => {
    const dir = makeTempDir('chronicle-m5-repair-');
    const store = new SaveStore(path.join(dir, 'battle.sqlite'));
    const sidecar = new T3SidecarManager({ baseDir: path.join(dir, 't3-home'), fakeMode: true });
    const coordinator = new GenerationCoordinator(sidecar, store);

    const waitTerminal = (attemptId: string) =>
      new Promise<GenerationProgressEvent>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out waiting for generation')), 120_000);
        const unsub = coordinator.subscribe((ev) => {
          if (ev.attemptId === attemptId && ['completed', 'fallback', 'cancelled', 'failed'].includes(ev.stage)) {
            clearTimeout(timeout);
            unsub();
            resolve(ev);
          }
        });
      });

    try {
      const rep = coordinator.startGeneration('Defend the ford [FORCE_REPAIR_ONCE]');
      const repDone = await waitTerminal(rep.attemptId);
      expect(repDone.stage).toBe('completed');
      expect(repDone.preview?.source).toBe('generated');
      expect(repDone.preview?.repaired).toBe(true);

      const inv = coordinator.startGeneration('Breach the gate [FORCE_INVALID_ALWAYS]');
      const invDone = await waitTerminal(inv.attemptId);
      expect(invDone.stage).toBe('fallback');
      expect(invDone.preview?.source).toBe('local_fallback');
      expect(invDone.preview?.fallbackReason).toMatch(/rejected after repair/i);
    } finally {
      sidecar.dispose();
      store.close();
    }
  }, 180_000);

  it('falls back to Local Fallback when no providers are authenticated', async () => {
    const dir = makeTempDir('chronicle-m5-noprovider-');
    const store = new SaveStore(path.join(dir, 'battle.sqlite'));
    const prevMode = process.env.CHRONICLE_FAKE_MODE;
    process.env.CHRONICLE_FAKE_MODE = 'no-providers';
    const sidecar = new T3SidecarManager({ baseDir: path.join(dir, 't3-home'), fakeMode: true });
    const coordinator = new GenerationCoordinator(sidecar, store);

    try {
      const terminal = new Promise<GenerationProgressEvent>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out')), 120_000);
        const unsub = coordinator.subscribe((ev) => {
          if (ev.stage === 'fallback' || ev.stage === 'completed') {
            clearTimeout(timeout);
            unsub();
            resolve(ev);
          }
        });
      });

      coordinator.startGeneration('Fortress siege at dawn');
      const done = await terminal;
      expect(done.stage).toBe('fallback');
      expect(done.preview?.source).toBe('local_fallback');
      expect(done.preview?.battleState.units.length).toBeGreaterThanOrEqual(5);
    } finally {
      if (prevMode === undefined) delete process.env.CHRONICLE_FAKE_MODE;
      else process.env.CHRONICLE_FAKE_MODE = prevMode;
      sidecar.dispose();
      store.close();
    }
  }, 180_000);

  it('enforces SQLite CAS staging: stale, duplicate, and cancelled attempts cannot publish', () => {
    const dir = makeTempDir('chronicle-m5-cas-');
    const store = new SaveStore(path.join(dir, 'battle.sqlite'));
    try {
      const preview = createImpossibleSeizeFixture();
      const e1 = store.beginGenerationAttempt('job-1', 'attempt-1', 'chapter', 'First');
      const e2 = store.beginGenerationAttempt('job-2', 'attempt-2', 'chapter', 'Second');
      expect(e2).toBeGreaterThan(e1);

      // Stale epoch 1 cannot publish once epoch 2 exists
      expect(store.tryPublishGeneration('job-1', 'attempt-1', e1, preview)).toBe(false);
      // Epoch 2 publishes once, then duplicate publish is rejected
      expect(store.tryPublishGeneration('job-2', 'attempt-2', e2, preview)).toBe(true);
      expect(store.tryPublishGeneration('job-2', 'attempt-2', e2, preview)).toBe(false);

      // Cancelled attempt cannot publish
      const e3 = store.beginGenerationAttempt('job-3', 'attempt-3', 'chapter', 'Third');
      expect(store.markGenerationCancelled('attempt-3')).toBe(true);
      expect(store.tryPublishGeneration('job-3', 'attempt-3', e3, preview)).toBe(false);
    } finally {
      store.close();
    }
  });

  it('validates impossible-seize fixture and reaches expiry defeat cleanly', () => {
    const fixture = createImpossibleSeizeFixture();
    expect(fixture.objective).toBe('seize');
    expect(fixture.battleState.maxTurns).toBe(6);

    const dir = makeTempDir('chronicle-m5-seize-');
    const host = new GameHost(50, path.join(dir, 'battle.sqlite'));
    try {
      let snap = host.launchChapter(fixture.battleState);
      expect(snap.state.status).toBe('ongoing');
      expect(snap.state.seizeTile).toEqual({ x: 9, y: 4 });

      let s: BattleState = snap.state;
      for (let t = 0; t < 6 && s.status === 'ongoing'; t++) {
        const endRes = applyCommand(s, { type: 'END_PHASE' });
        expect(endRes.ok).toBe(true);
        const enemyRes = applyCommand(endRes.state, { type: 'RUN_ENEMY_PHASE' });
        expect(enemyRes.ok).toBe(true);
        s = enemyRes.state;
      }
      expect(s.status).toBe('defeat');
      expect(s.endReason).toBe('expiry');
    } finally {
      host.dispose();
    }
  });

  it('rejects unsupported Rule IR opcodes and invalid plan stats', () => {
    const badPlan = validateChapterPlan({ schemaVersion: 1, title: 'x', archetype: 'unknown', objective: 'rout', maxTurns: 99, summary: 's', units: [] });
    expect(badPlan.ok).toBe(false);

    const badBuild = validateChapterBuild(
      {
        schemaVersion: 1,
        abilityName: 'Warp',
        statusName: 'None',
        abilitySummary: 'Invalid op',
        introChronicle: 'Invalid rule test.',
        rulePack: [
          {
            schemaVersion: 1,
            id: 'bad_op',
            rulesVersion: 'r03-1',
            provenanceJobId: 'draft',
            name: 'Warp',
            kind: 'active',
            costs: { hp: 2, actions: 0 },
            useKey: 'bad_op',
            usesPerPhase: 1,
            stackPolicy: 'add',
            activationPolicy: 'normal',
            listeners: [
              {
                hook: 'useActive',
                scope: 'ownerActor',
                priority: 0,
                maxPerRoot: 1,
                maxPerPhase: 1,
                effect: { op: 'teleportAnywhereUnsupported' },
              },
            ],
          },
        ],
      },
      'job-bad',
    );
    expect(badBuild.ok).toBe(false);
  });
});

describe('Provider settings persistence & UX pass invariants', () => {
  it('persists architect, chronicler, and fallback model settings across SQLite reopen', () => {
    const dir = makeTempDir('chronicle-r04-settings-');
    const file = path.join(dir, 'battle.sqlite');
    const desired: ProviderSettings = {
      architect: { providerId: 'codex', model: 'gpt-6.1-terra', effort: 'low' },
      chronicler: { providerId: 'claudeAgent', model: 'claude-sonnet-4-5', effort: 'medium' },
      fallbacks: [{ providerId: 'codex', model: 'gpt-5.1-codex', effort: 'high' }],
    };
    const store1 = new SaveStore(file);
    store1.saveProviderSettings(desired);
    store1.close();

    const store2 = new SaveStore(file);
    expect(store2.getProviderSettings()).toEqual(desired);
    store2.close();
  });

  it('keeps enemyPhaseTrace deterministic and excluded from simulation hashes, and removes attack confirmation in UI', () => {
    const hostA = new GameHost(50);
    const hostB = new GameHost(50);
    try {
      const endA = hostA.dispatch({ type: 'END_PHASE' });
      const endB = hostB.dispatch({ type: 'END_PHASE' });
      expect(endA.ok && endB.ok).toBe(true);

      const resA = applyCommand(endA.snapshot.state, { type: 'RUN_ENEMY_PHASE' });
      const resB = applyCommand(endB.snapshot.state, { type: 'RUN_ENEMY_PHASE' });
      expect(resA.ok && resB.ok).toBe(true);
      expect(resA.state.enemyPhaseTrace?.length).toBeGreaterThan(0);
      expect(resA.state.enemyPhaseTrace).toEqual(resB.state.enemyPhaseTrace);
      expect(computeStateHash(resA.state)).toBe(computeStateHash(resB.state));

      // Stripping enemyPhaseTrace (cosmetic UI replay data) preserves identical simulation hash
      const withoutTrace = structuredClone(resA.state);
      delete withoutTrace.enemyPhaseTrace;
      expect(computeStateHash(withoutTrace)).toBe(computeStateHash(resA.state));

      // Danger zone computation returns non-empty threat tiles
      expect(computeFactionThreatTiles(resA.state, 'enemy').length).toBeGreaterThan(0);
    } finally {
      hostA.dispose();
      hostB.dispose();
    }

    const appSource = readFileSync(path.resolve(__dirname, '../src/renderer/App.tsx'), 'utf8');
    expect(appSource).not.toContain('confirm-attack-btn');
    expect(appSource).toContain('enemy-phase-playback');
    expect(appSource).toContain('skip-enemy-phase-btn');
    expect(appSource).toContain('enemy-speed-select');
  });
});
