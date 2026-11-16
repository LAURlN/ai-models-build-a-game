import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { BattleSnapshot, BattleState, CombatForecast, DispatchResponse } from '../shared/contracts';
export type WorkerCommand =
  | { type: 'snapshot' | 'restart' | 'save' | 'load' | 'rewind' }
  | { type: 'dispatch'; command: unknown }
  | { type: 'forecast'; attackerId: string; targetId: string }
  | { type: 'launchChapter'; state: BattleState };
export type WorkerRequest = { id: number } & WorkerCommand;
type Result = BattleSnapshot | DispatchResponse | CombatForecast;
export type WorkerReply = { id: number; result: Result } | { id: number; error: string } | { id: null; snapshot: BattleSnapshot };
export class GameHost {
  private readonly worker: Worker;
  private nextId = 0;
  private failure: Error | null = null;
  private readonly listeners = new Set<(snapshot: BattleSnapshot) => void>();
  private readonly pending = new Map<number, { resolve: (result: Result) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(enemyPhaseDelayMs: number, savePath: string) {
    this.worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { enemyPhaseDelayMs, savePath } });
    this.worker.on('message', (reply: WorkerReply) => {
      if (reply.id === null) { for (const listener of this.listeners) listener(reply.snapshot); }
      else {
        const item = this.pending.get(reply.id); if (!item) return;
        clearTimeout(item.timer); this.pending.delete(reply.id);
        if ('error' in reply) item.reject(new Error(reply.error)); else item.resolve(reply.result);
      }
    });
    this.worker.on('error', (error: Error) => this.fail(error));
    this.worker.on('exit', code => this.fail(new Error(`Battle worker exited (${code}). Restart the app.`)));
  }
  subscribe(listener: (snapshot: BattleSnapshot) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private fail(error: Error): void {
    this.failure = error;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
  private request(request: WorkerCommand): Promise<Result> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      // Forecast is pure computation. Other requests can wait on FULL-sync
      // SQLite writes or first-run disk initialization; don't kill a healthy
      // writer merely because the save drive is busy.
      const timeoutMs = request.type === 'forecast' ? 5000 : 60_000;
      const timer = setTimeout(() => { this.fail(new Error('Battle worker timed out. Restart the app.')); void this.worker.terminate(); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ ...request, id });
    });
  }
  getSnapshot(): Promise<BattleSnapshot> { return this.request({ type: 'snapshot' }) as Promise<BattleSnapshot>; }
  dispatch(command: unknown): Promise<DispatchResponse> { return this.request({ type: 'dispatch', command }) as Promise<DispatchResponse>; }
  forecast(attackerId: string, targetId: string): Promise<CombatForecast> { return this.request({ type: 'forecast', attackerId, targetId }) as Promise<CombatForecast>; }
  save(): Promise<BattleSnapshot> { return this.request({ type: 'save' }) as Promise<BattleSnapshot>; }
  load(): Promise<BattleSnapshot> { return this.request({ type: 'load' }) as Promise<BattleSnapshot>; }
  rewind(): Promise<BattleSnapshot> { return this.request({ type: 'rewind' }) as Promise<BattleSnapshot>; }
  restart(): Promise<BattleSnapshot> { return this.request({ type: 'restart' }) as Promise<BattleSnapshot>; }
  launchChapter(state: BattleState): Promise<BattleSnapshot> { return this.request({ type: 'launchChapter', state }) as Promise<BattleSnapshot>; }
  dispose(): void { this.fail(new Error('Battle host closed.')); this.listeners.clear(); void this.worker.terminate(); }
}
