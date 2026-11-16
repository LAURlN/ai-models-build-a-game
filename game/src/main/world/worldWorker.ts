/** Worker entry: hosts the campaign + generated code away from the Electron main thread. */
import { parentPort, workerData } from 'node:worker_threads';
import { WorldHost } from './worldHost';

const port = parentPort;
if (!port) throw new Error('World worker requires a parent.');
const data = workerData as { dbPath: string; workspacesDir: string; contentDir?: string; aiDelayMs: number; crumb: SharedArrayBuffer };

// Breadcrumb for the watchdog: which generated module is executing right now.
const crumb = new Uint8Array(data.crumb);
const stack: string[] = [];
const writeCrumb = (): void => {
  const label = stack[stack.length - 1] ?? '';
  const bytes = Buffer.from(label, 'utf8').subarray(0, crumb.length - 1);
  crumb.set(bytes, 1);
  Atomics.store(crumb, 0, bytes.length);
};
const trace = (label: string | null): void => { if (label === null) stack.pop(); else stack.push(label); writeCrumb(); };

const host = new WorldHost({ dbPath: data.dbPath, workspacesDir: data.workspacesDir, aiDelayMs: data.aiDelayMs, trace, ...(data.contentDir ? { contentDir: data.contentDir } : {}) });
host.subscribe((event) => port.postMessage({ event }));

const METHODS = new Set([
  'listCampaigns', 'createCampaign', 'openCampaign', 'closeCampaign', 'deleteCampaign', 'view', 'appendChat', 'chatCount', 'chatRange',
  'applyNarratorTurn', 'patchCampaign', 'digest', 'runCommand', 'quarantine', 'reloadModules', 'moduleSource', 'syncWorkspace',
  'startBattle', 'battleCommand', 'battleSelect', 'battleForecast', 'battleThreat', 'battlePreview', 'battleRewind', 'resolveBattle',
]);

let chain: Promise<void> = Promise.resolve();
port.on('message', (request: { id: number; method: string; args: unknown[] }) => {
  if (request.method === 'ping') { port.postMessage({ id: request.id, result: true }); return; }
  chain = chain.then(async () => {
    stack.length = 0; writeCrumb();
    try {
      if (!METHODS.has(request.method)) throw new Error(`Unknown world method '${request.method}'.`);
      // battleCommand's second parameter is host-internal; never forward it from outside.
      const args = request.method === 'battleCommand' ? request.args.slice(0, 1) : request.args;
      const result = await (host as unknown as Record<string, (...a: unknown[]) => unknown>)[request.method]!(...args);
      port.postMessage({ id: request.id, result });
    } catch (error) {
      port.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
});
port.on('close', () => host.dispose());
