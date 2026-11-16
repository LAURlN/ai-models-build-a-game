import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { GameHost } from '../src/main/battleHost';
import { SaveStore, newSession } from '../src/main/saveStore';
import { applyCommand, computeStateHash } from '../src/rules/battle';
import type { BattleSnapshot } from '../src/shared/contracts';

afterEach(() => vi.useRealTimers());
describe('worker host', () => {
  it('runs enemies automatically, persists before notification, and revisions increase', () => {
    vi.useFakeTimers(); const host = new GameHost(80); const updates: BattleSnapshot[] = [];
    host.subscribe(s => updates.push(s));
    const ended = host.dispatch({ type: 'END_PHASE' }); expect(ended.ok).toBe(true); expect(updates).toHaveLength(0);
    vi.advanceTimersByTime(80); expect(updates).toHaveLength(1); expect(updates[0]!.state.turn).toBe(2); expect(updates[0]!.revision).toBeGreaterThan(ended.snapshot.revision); host.dispose();
  });
  it('cancels pending enemies on concession, restart or disposal', () => {
    vi.useFakeTimers();
    for (const operation of ['concede', 'restart', 'dispose']) {
      const host = new GameHost(80), listener = vi.fn(); host.subscribe(listener); host.dispatch({ type: 'END_PHASE' });
      if (operation === 'concede') host.dispatch({ type: 'CONCEDE' }); else if (operation === 'restart') host.restart(); else host.dispose();
      vi.advanceTimersByTime(1000); expect(listener).not.toHaveBeenCalled(); if (operation !== 'dispose') host.dispose();
    }
  });
  it('blocks host-only, malformed and unknown commands without changing state/RNG', () => {
    const host = new GameHost(), initial = host.getSnapshot();
    for (const command of [null, { type: 'RUN_ENEMY_PHASE' }, { type: 'CONCEDE', injected: 1 }]) {
      const r = host.dispatch(command); expect(r.ok).toBe(false); expect(r.snapshot.state).toBe(initial.state); expect(r.snapshot.stateHash).toBe(initial.stateHash);
    }
    host.dispose();
  });
});
function temporary(test: (file: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'chronicle-r03-'));
  try { test(path.join(dir, 'battle.sqlite')); }
  finally { if (!path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path'); rmSync(dir, { recursive: true, force: true }); }
}
describe('SQLite and Turnwheel', () => {
  it('restores identical full state/hash after closing and reopening, including debt and history', () => temporary(file => {
    let host = new GameHost(80, file);
    host.dispatch({ type: 'USE_ABILITY', unitId: 'player_vanguard', abilityId: 'borrowed_second' });
    host.dispatch({ type: 'MOVE_UNIT', unitId: 'player_vanguard', to: { x: 3, y: 2 } });
    const saved = host.save(); host.dispose();
    host = new GameHost(80, file); const loaded = host.load();
    expect(loaded.state).toEqual(saved.state); expect(loaded.stateHash).toBe(saved.stateHash); expect(loaded.canRewind).toBe(true); host.dispose();
  }));
  it('restores RNG and all counters; identical actions cannot reroll, and 3 charges never refund on load', () => {
    const host = new GameHost();
    host.dispatch({ type: 'MOVE_UNIT', unitId: 'player_vanguard', to: { x: 3, y: 2 } });
    const before = host.save();
    const command = { type: 'ATTACK_UNIT', attackerId: 'player_vanguard', targetId: 'enemy_raider' };
    const first = host.dispatch(command); expect(first.ok).toBe(true); expect(first.snapshot.state.rngPosition).toBeGreaterThan(0);
    for (let i = 1; i <= 3; i++) {
      const rewound = host.rewind(); expect(rewound.stateHash).toBe(before.stateHash); expect(rewound.rewindsLeft).toBe(3 - i);
      const replayed = host.dispatch(command); expect(replayed.snapshot.stateHash).toBe(first.snapshot.stateHash);
    }
    expect(() => host.rewind()).toThrow(); expect(host.load().rewindsLeft).toBe(0); host.restart(); expect(host.load().rewindsLeft).toBe(0); host.dispose();
  });
  it('persists a reproducible root fault, quarantines the definition, and permits host-owned abort', () => temporary(file => {
    const store = new SaveStore(file), data = newSession();
    data.state.units[0]!.actionCredits = 1000000;
    store.commit(data, { type: 'FIXTURE' }); store.close();
    const host = new GameHost(80, file), before = host.getSnapshot();
    const fault = host.dispatch({ type: 'USE_ABILITY', unitId: 'player_vanguard', abilityId: 'borrowed_second' });
    expect(fault.ok).toBe(false); expect(fault.snapshot.stateHash).toBe(before.stateHash);
    expect(host.dispatch({ type: 'END_PHASE' }).error).toContain('Quarantined');
    expect(host.dispatch({ type: 'TECHNICAL_ABORT' }).snapshot.state.endReason).toBe('technical_abort'); host.dispose();
    const reopened = new SaveStore(file); expect(reopened.quarantined()).toContain('borrowed_second'); reopened.close();
  }));  it('rewinds an automatic enemy phase to a stable player decision without replaying the enemy timer', () => {
    vi.useFakeTimers(); const host = new GameHost(80), initial = host.getSnapshot();
    host.dispatch({ type: 'END_PHASE' }); vi.advanceTimersByTime(80);
    expect(host.getSnapshot().state.turn).toBe(2);
    const rewound = host.rewind(); expect(rewound.stateHash).toBe(initial.stateHash); expect(rewound.rewindsLeft).toBe(2);
    vi.advanceTimersByTime(1000); expect(host.getSnapshot().stateHash).toBe(initial.stateHash); host.dispose();
  });  it('keeps the old atomic state and event log after an interrupted commit, then accepts a complete new commit', () => temporary(file => {
    const store = new SaveStore(file), old = newSession(); store.commit(old, { type: 'START' });
    const changed = { ...old, state: applyCommand(old.state, { type: 'CONCEDE' }).state };
    expect(() => store.commit(changed, { type: 'CONCEDE' }, false, true)).toThrow(/interrupted/);
    expect(store.read()).toEqual(old); store.close();
    // Abrupt process death with dirty SQLite pages (no JS finally/ROLLBACK) exercises journal recovery.
    const child = spawnSync(process.execPath, ['-e', "const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync(process.argv[1]); d.exec('BEGIN IMMEDIATE'); d.prepare('UPDATE slots SET data=? WHERE id=?').run('broken-uncommitted-state','current'); process.exit(23)", file]);
    expect(child.status).toBe(23);
    const reopened = new SaveStore(file); expect(reopened.read()).toEqual(old);
    reopened.commit(changed, { type: 'CONCEDE' }); expect(computeStateHash(reopened.read()!.state)).toBe(computeStateHash(changed.state)); reopened.close();
  }));
});
