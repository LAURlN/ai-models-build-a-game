import { parentPort, workerData } from 'node:worker_threads';
import { GameHost } from './battleHost';
import type { WorkerReply, WorkerRequest } from './gameHost';
const port = parentPort;
if (!port) throw new Error('Battle worker requires a parent.');
const data = workerData as { enemyPhaseDelayMs: number; savePath: string };
const host = new GameHost(data.enemyPhaseDelayMs, data.savePath);
const post = (reply: WorkerReply): void => port.postMessage(reply);
host.subscribe(snapshot => post({ id: null, snapshot }));
port.on('message', (request: WorkerRequest) => {
  try {
    switch (request.type) {
      case 'snapshot': post({ id: request.id, result: host.getSnapshot() }); break;
      case 'dispatch': {
        const result = host.dispatch(request.command);
        post({ id: request.id, result });
        if (result.ok) post({ id: null, snapshot: result.snapshot });
        break;
      }
      case 'forecast': post({ id: request.id, result: host.forecast(request.attackerId, request.targetId) }); break;
      case 'restart': { const snapshot = host.restart(); post({ id: request.id, result: snapshot }); post({ id: null, snapshot }); break; }
      case 'save': { const snapshot = host.save(); post({ id: request.id, result: snapshot }); post({ id: null, snapshot }); break; }
      case 'load': { const snapshot = host.load(); post({ id: request.id, result: snapshot }); post({ id: null, snapshot }); break; }
      case 'rewind': { const snapshot = host.rewind(); post({ id: request.id, result: snapshot }); post({ id: null, snapshot }); break; }
      case 'launchChapter': { const snapshot = host.launchChapter(request.state); post({ id: request.id, result: snapshot }); post({ id: null, snapshot }); break; }
    }
  } catch (error) { post({ id: request.id, error: String(error) }); }
});
port.on('close', () => host.dispose());
