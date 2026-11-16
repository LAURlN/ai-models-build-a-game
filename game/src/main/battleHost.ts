import { Either } from 'effect';
import { applyCommand, buildSnapshot, forecastCombat } from '../rules/battle';
import { decodeGameCommand, type BattleSnapshot, type BattleState, type DispatchResponse, type EngineCommand } from '../shared/contracts';
import { SaveStore, newSession, type SessionData } from './saveStore';

export class GameHost {
  private data: SessionData;
  private revision = 0;
  private enemyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(snapshot: BattleSnapshot) => void>();
  private readonly store: SaveStore;
  private ioError: string | null = null;
  constructor(private readonly enemyPhaseDelayMs = 80, file = ':memory:') {
    this.store = new SaveStore(file);
    this.data = this.store.read() ?? newSession();
    if (this.data.state.phase === 'enemy' && this.data.state.status === 'ongoing') this.scheduleEnemyPhase();
  }
  subscribe(listener: (snapshot: BattleSnapshot) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  getSnapshot(lastError: string | null = this.ioError): BattleSnapshot {
    return { ...buildSnapshot(this.data.state, lastError), revision: ++this.revision, rewindsLeft: 3 - this.data.spent,
      canRewind: this.data.history.length > 1 && this.data.spent < 3, hasSave: this.store.hasBookmark() };
  }
  forecast(attackerId: string, targetId: string) { return forecastCombat(this.data.state, attackerId, targetId); }
  private commit(next: SessionData, command: unknown, bookmark = false): void {
    try { this.store.commit(next, command, bookmark); this.data = next; this.ioError = null; }
    catch (error) { this.ioError = `Save failed; commands paused. ${String(error)}`; throw error; }
  }
  dispatch(rawCommand: unknown): DispatchResponse {
    const decoded = decodeGameCommand(rawCommand);
    if (Either.isLeft(decoded)) return { ok: false, error: 'Invalid command payload.', snapshot: this.getSnapshot('Invalid command payload.') };
    const quarantined = this.store.quarantined();
    if (quarantined.length && !['CONCEDE', 'TECHNICAL_ABORT'].includes(decoded.right.type)) {
      const error = 'Quarantined rule fault: ' + quarantined.join(', ') + '. Choose Technical abort.';
      return { ok: false, error, snapshot: this.getSnapshot(error) };
    }
    if (this.ioError) return { ok: false, error: this.ioError, snapshot: this.getSnapshot() };
    return this.resolve(decoded.right);
  }
  private resolve(command: EngineCommand): DispatchResponse {
    const result = applyCommand(this.data.state, command);
    if (!result.ok) {
      if (result.fault) this.store.recordFault({ ...result.fault, command, state: this.data.state, error: result.error });
      return { ok: false, error: result.error, snapshot: this.getSnapshot(result.error) };
    }
    try {
      if (command.type === 'SELECT_UNIT') this.data = { ...this.data, state: result.state };
      else this.commit({ ...this.data, state: result.state, history: [...this.data.history, { state: result.state, command }] }, command);
    } catch (error) { return { ok: false, error: String(error), snapshot: this.getSnapshot() }; }
    this.clearEnemyTimer();
    if (this.data.state.status === 'ongoing' && this.data.state.phase === 'enemy') this.scheduleEnemyPhase();
    return { ok: true, error: null, snapshot: this.getSnapshot() };
  }
  save(): BattleSnapshot { this.commit(this.data, { type: 'SAVE' }, true); return this.getSnapshot(); }
  load(): BattleSnapshot {
    const saved = this.store.read('bookmark'); if (!saved) throw new Error('No saved checkpoint');
    // A bookmark is an explicit branch. Its ledger cannot refund already spent charges in this battle.
    const next = { ...saved, spent: saved.spent, branch: this.data.branch + 1 };
    this.commit(next, { type: 'LOAD' }); this.clearEnemyTimer();
    if (next.state.phase === 'enemy' && next.state.status === 'ongoing') this.scheduleEnemyPhase();
    return this.getSnapshot();
  }
  rewind(): BattleSnapshot {
    if (this.data.spent >= 3 || this.data.history.length < 2) throw new Error('No Turnwheel rewinds available');
    let index = this.data.history.length - 2;
    // An automatic enemy root must not immediately replay the boundary being rewound.
    while (index > 0 && this.data.history[index]!.state.phase === 'enemy') index--;
    const history = this.data.history.slice(0, index + 1);
    const next = { battleId: this.data.battleId, state: structuredClone(history.at(-1)!.state), history, spent: this.data.spent + 1, branch: this.data.branch + 1 };
    this.commit(next, { type: 'REWIND' }); this.clearEnemyTimer();
    if (next.state.phase === 'enemy' && next.state.status === 'ongoing') this.scheduleEnemyPhase();
    return this.getSnapshot();
  }
  restart(): BattleSnapshot { this.commit(newSession(), { type: 'RESTART' }); this.clearEnemyTimer(); return this.getSnapshot(); }
  launchChapter(state: BattleState): BattleSnapshot {
    this.commit(newSession(state), { type: 'LAUNCH_CHAPTER', chapterId: state.chapterId ?? null });
    this.clearEnemyTimer();
    if (this.data.state.status === 'ongoing' && this.data.state.phase === 'enemy') this.scheduleEnemyPhase();
    return this.getSnapshot();
  }
  private scheduleEnemyPhase(): void {
    this.clearEnemyTimer();
    this.enemyTimer = setTimeout(() => {
      this.enemyTimer = null;
      const response = this.resolve({ type: 'RUN_ENEMY_PHASE' });
      for (const listener of this.listeners) listener(response.snapshot);
    }, this.enemyPhaseDelayMs);
  }
  private clearEnemyTimer(): void { if (this.enemyTimer !== null) clearTimeout(this.enemyTimer); this.enemyTimer = null; }
  dispose(): void { this.clearEnemyTimer(); this.listeners.clear(); this.store.close(); }
}
