/**
 * Main-process side of the world worker, with a watchdog. If generated code hangs
 * (an infinite loop cannot be caught from inside), the worker is terminated, the
 * offending module is quarantined, a fresh worker reopens the campaign from SQLite
 * and a fault event asks the director to send a repair helper.
 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ModuleFaultInfo } from '../../engine/types';
import type { WorldEvent, WorldHost, WorldView } from './worldHost';

type AsyncMethods<T> = { [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };
/** Promise-returning facade over WorldHost, implemented by the worker client and by `localWorldApi` in tests. */
export type WorldApi = Omit<AsyncMethods<WorldHost>, 'subscribe' | 'dispose' | 'workspaceOf'> & {
  subscribe(listener: (event: WorldEvent) => void): () => void;
  dispose(): void;
};

/** In-process adapter (tests, tools): same surface, no worker. */
export function localWorldApi(host: WorldHost): WorldApi {
  return new Proxy({}, {
    get(_target, key: string) {
      if (key === 'subscribe') return (listener: (event: WorldEvent) => void) => host.subscribe(listener);
      if (key === 'dispose') return () => host.dispose();
      return async (...args: unknown[]) => (host as unknown as Record<string, (...a: unknown[]) => unknown>)[key]!(...args);
    },
  }) as WorldApi;
}

export interface WorldClientOptions { dbPath: string; workspacesDir: string; contentDir?: string; aiDelayMs?: number; workerPath?: string; timeoutMs?: number }

export function createWorldClient(options: WorldClientOptions): WorldApi {
  const workerPath = options.workerPath ?? path.join(__dirname, 'worldWorker.cjs');
  const timeoutMs = options.timeoutMs ?? 20_000;
  const listeners = new Set<(event: WorldEvent) => void>();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let crumb = new SharedArrayBuffer(256);
  let worker: Worker;
  let nextId = 0;
  let openId: string | null = null;
  let disposed = false;
  let recovering: Promise<void> | null = null;

  const emit = (event: WorldEvent): void => { for (const listener of listeners) listener(event); };
  const failAll = (error: Error): void => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  };
  const spawn = (): void => {
    crumb = new SharedArrayBuffer(256);
    worker = new Worker(workerPath, { workerData: { dbPath: options.dbPath, workspacesDir: options.workspacesDir, contentDir: options.contentDir, aiDelayMs: options.aiDelayMs ?? 80, crumb } });
    const mine = worker;
    mine.on('message', (message: { id?: number; result?: unknown; error?: string; event?: WorldEvent }) => {
      if (message.event) { emit(message.event); return; }
      const item = message.id === undefined ? undefined : pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id!);
      if (message.error !== undefined) item.reject(new Error(message.error)); else item.resolve(message.result);
    });
    mine.on('error', (error: Error) => { if (worker === mine && !disposed) void recover(`World worker crashed: ${error.message}`); });
    mine.on('exit', (code: number) => { if (worker === mine && !disposed && code !== 0) void recover(`World worker exited (${code}).`); });
  };
  const readCrumb = (): string => {
    const view = new Uint8Array(crumb), length = Atomics.load(view, 0);
    return length ? Buffer.from(view.slice(1, 1 + length)).toString('utf8') : '';
  };
  const raw = (method: string, args: unknown[], limit: number): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`World worker timed out during '${method}'.`));
        void recover(`Timed out during '${method}' (possible infinite loop in generated code).`);
      }, limit);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, method, args });
    });
  const recover = (message: string): Promise<void> => {
    if (disposed) return Promise.resolve();
    recovering ??= (async () => {
      const label = readCrumb();
      const old = worker;
      failAll(new Error(message));
      await old.terminate().catch(() => {});
      spawn();
      const faults: ModuleFaultInfo[] = [];
      try {
        if (label) {
          await raw('quarantine', [label, message], timeoutMs);
          const moduleId = label.startsWith('load:') ? (label.split(':')[1] ?? label).replace(/\.[a-z]+$/, '') : label;
          faults.push({ moduleId, where: label.startsWith('load:') ? 'module load' : 'watchdog', message, stack: '' });
        }
        if (openId) {
          const view = (await raw('openCampaign', [openId], timeoutMs * 3)) as WorldView;
          emit({ type: 'view', view });
        }
      } catch { /* a second failure surfaces through the next call */ }
      if (faults.length) emit({ type: 'faults', faults });
    })().finally(() => { recovering = null; });
    return recovering;
  };
  spawn();
  // Heartbeat: AI phases run on a worker timer, so a hang there has no pending request to time out.
  const heartbeat = setInterval(() => { if (!disposed && !recovering && pending.size === 0 && openId) raw('ping', [], Math.min(timeoutMs, 8000)).catch(() => {}); }, 4000);
  heartbeat.unref();

  return new Proxy({}, {
    get(_target, key: string) {
      if (key === 'subscribe') return (listener: (event: WorldEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
      if (key === 'dispose') return () => { disposed = true; clearInterval(heartbeat); failAll(new Error('World host closed.')); listeners.clear(); void worker.terminate(); };
      return async (...args: unknown[]) => {
        if (recovering) await recovering;
        const limit = key === 'openCampaign' || key === 'createCampaign' || key === 'reloadModules' ? timeoutMs * 3 : timeoutMs;
        const result = await raw(key, args, limit);
        if (key === 'openCampaign' || key === 'createCampaign') openId = (result as WorldView).campaign?.id ?? null;
        if (key === 'closeCampaign' || (key === 'deleteCampaign' && args[0] === openId)) openId = null;
        return result;
      };
    },
  }) as WorldApi;
}
