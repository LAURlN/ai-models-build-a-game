import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import type {
  InteractiveAuthFlow,
  ProviderAuthActionInfo,
  ProviderInfo,
  ProviderModelInfo,
  SidecarHealthStatus,
} from '../shared/contracts';

interface NativeJobObjectAddon {
  createJob(): bigint;
  assignPid(jobHandle: bigint, pid: number): boolean;
  spawnSuspendedAndAssign(options: {
    jobHandle: bigint;
    applicationName?: string;
    commandLine: string;
    cwd: string;
    stdoutPath?: string;
    stderrPath?: string;
    envPairs?: string[];
  }): { pid: number; stdinHandle: bigint };
  writeAndCloseHandle(handle: bigint, utf8Text: string): boolean;
  terminateJob(jobHandle: bigint, exitCode?: number): boolean;
  closeJob(jobHandle: bigint): boolean;
  isProcessAlive(pid: number): boolean;
}

interface RawOptionDescriptor {
  id: string;
  label: string;
  type: 'select' | 'boolean';
  role?: 'reasoning';
  options?: Array<{ id: string; label: string; isDefault?: boolean }>;
  currentValue?: string | boolean;
}

interface RawServerModel {
  slug: string;
  name: string;
  isCustom: boolean;
  isDefault?: boolean;
  supportsTextGeneration?: boolean;
  capabilities: { optionDescriptors?: RawOptionDescriptor[] } | null;
}

interface RawServerProvider {
  instanceId: string;
  driver: string;
  displayName?: string;
  supportsTextGeneration?: boolean;
  setup?: { canAuthenticate: boolean; canInstall: boolean };
  enabled: boolean;
  installed: boolean;
  status: 'ready' | 'warning' | 'error' | 'disabled';
  auth: {
    status: 'authenticated' | 'unauthenticated' | 'unknown';
    type?: string;
    label?: string;
    email?: string;
    canLogout?: boolean;
  };
  message?: string;
  availability?: 'available' | 'unavailable';
  unavailableReason?: string;
  models: RawServerModel[];
}

interface RawProviderAuthState {
  instanceId: string;
  phase: string;
  flowId: string | null;
  authorizationUrl: string | null;
  message: string | null;
  methods?: Array<{
    id: string;
    name: string;
    description: string | null;
    type: string;
    accountEmail?: string;
    canRemove?: boolean;
  }>;
  interaction?: {
    type: 'browser' | 'deviceCode' | 'terminal' | 'credentials';
    id: string;
    url?: string;
    userCode?: string;
    fields?: Array<{ name: string; label: string; secret: boolean }>;
  } | null;
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  isStream: boolean;
  onChunk?: (item: unknown) => void;
}

function resolveGameDistRoot(): string {
  // The child runs as plain Node and cannot resolve files inside app.asar.
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resources && existsSync(path.join(resources, 'runtime/sidecar/bin.mjs'))) {
    return path.join(resources, 'runtime');
  }
  const baseDir = typeof __dirname === 'string' ? __dirname : path.resolve(process.cwd(), 'dist/main');
  const candidates = [
    path.resolve(baseDir, '..'),
    path.resolve(baseDir, '../../dist'),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd(), 'game/dist'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'sidecar/bin.mjs'))) {
      return dir;
    }
  }
  return path.resolve(baseDir, '..');
}

function loadJobAddon(distRoot: string): NativeJobObjectAddon {
  const addonPath = path.join(distRoot, 'native/job_object.node');
  if (!existsSync(addonPath)) {
    throw new Error(`Missing native Job Object addon at ${addonPath}. Run npm run build first.`);
  }
  const baseFile = typeof __filename === 'string' ? __filename : path.join(distRoot, 'main/index.cjs');
  const req = createRequire(baseFile);
  return req(addonPath) as NativeJobObjectAddon;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('Failed to bind ephemeral loopback port'));
        return;
      }
      const { port } = addr;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function extractRpcFailureMessage(cause: unknown): string {
  if (!cause) return 'Unknown RPC error';
  if (typeof cause === 'string') return cause;
  if (Array.isArray(cause)) {
    const msgs = cause.map(extractRpcFailureMessage).filter(Boolean);
    if (msgs.length > 0) return msgs.join('; ');
  }
  if (typeof cause === 'object') {
    const rec = cause as Record<string, unknown>;
    if (rec._tag === 'Fail' && rec.error) {
      return extractRpcFailureMessage(rec.error);
    }
    if (rec._tag === 'Die' && rec.defect) {
      return extractRpcFailureMessage(rec.defect);
    }
    if (typeof rec.detail === 'string' && rec.detail.length > 0) return rec.detail;
    if (typeof rec.message === 'string' && rec.message.length > 0) return rec.message;
    if (typeof rec.defect === 'string' && rec.defect.length > 0) return rec.defect;
    if (rec.error) return extractRpcFailureMessage(rec.error);
  }
  return JSON.stringify(cause);
}

function quoteWinArg(arg: string): string {
  if (!/[\s"&<>|^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export class T3SidecarManager {
  private readonly baseDir: string;
  private readonly fakeMode: boolean;
  private readonly distRoot: string;
  private readonly addon: NativeJobObjectAddon | null;

  private jobHandle: bigint | null = null;
  private pid: number | null = null;
  private port: number | null = null;
  private ws: WebSocket | null = null;
  private startPromise: Promise<SidecarHealthStatus> | null = null;
  private disposed = false;
  private lastError: string | null = null;

  private reqSeq = 0;
  private readonly pending = new Map<string, PendingRpc>();
  private configSubId: string | null = null;
  private rawProviders: RawServerProvider[] = [];
  private readonly activeAuthStates = new Map<string, RawProviderAuthState>();
  private readonly providerListeners = new Set<(providers: ProviderInfo[]) => void>();

  constructor(options: { baseDir: string; fakeMode?: boolean }) {
    this.baseDir = path.resolve(options.baseDir);
    this.fakeMode = options.fakeMode ?? process.env.CHRONICLE_FAKE_PROVIDER === '1';
    this.distRoot = resolveGameDistRoot();
    this.addon = process.platform === 'win32' ? loadJobAddon(this.distRoot) : null;
  }

  getStatus(): SidecarHealthStatus {
    const alive =
      this.pid !== null &&
      (this.addon ? this.addon.isProcessAlive(this.pid) : true) &&
      this.ws?.readyState === WebSocket.OPEN;
    return {
      connected: alive,
      fakeMode: this.fakeMode,
      pid: this.pid,
      baseDir: this.baseDir,
      lastError: this.lastError,
    };
  }

  subscribeProviders(listener: (providers: ProviderInfo[]) => void): () => void {
    this.providerListeners.add(listener);
    return () => {
      this.providerListeners.delete(listener);
    };
  }

  async ensureStarted(): Promise<SidecarHealthStatus> {
    if (this.disposed) {
      throw new Error('Sidecar manager has been disposed.');
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.pid !== null) {
      return this.getStatus();
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<SidecarHealthStatus> {
    this.cleanupConnectionOnly();
    mkdirSync(this.baseDir, { recursive: true });
    mkdirSync(path.join(this.baseDir, 'logs'), { recursive: true });

    const sidecarEntry = path.join(this.distRoot, 'sidecar/bin.mjs');
    if (!existsSync(sidecarEntry)) {
      throw new Error(`Missing sidecar bundle at ${sidecarEntry}. Run npm run build first.`);
    }

    const port = await findFreePort();
    const bootstrapToken = randomBytes(32).toString('hex');
    const stdoutPath = path.join(this.baseDir, 'logs/sidecar.stdout.log');
    const stderrPath = path.join(this.baseDir, 'logs/sidecar.stderr.log');

    if (process.platform === 'win32' && this.addon) {
      if (this.jobHandle !== null) {
        try {
          this.addon.terminateJob(this.jobHandle, 1);
        } catch {
          // ignore prior cleanup error
        }
        this.jobHandle = null;
      }
      const job = this.addon.createJob();
      this.jobHandle = job;

      const args = [
        sidecarEntry,
        'serve',
        '--mode',
        'desktop',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--base-dir',
        this.baseDir,
        '--no-browser',
        '--bootstrap-fd',
        '0',
        '--game-profile',
      ];
      const commandLine = `${quoteWinArg(process.execPath)} ${args.map(quoteWinArg).join(' ')}`;

      const envMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v === undefined) continue;
        // Never allow ambient T3CODE_HOME / T3CODE_PORT to redirect the isolated sidecar
        if (k.startsWith('T3CODE_')) continue;
        envMap[k] = v;
      }
      if (process.versions.electron) {
        envMap.ELECTRON_RUN_AS_NODE = '1';
      }
      envMap.T3CODE_HOME = this.baseDir;
      envMap.T3CODE_GAME_PROFILE = '1';
      if (this.fakeMode) {
        envMap.CHRONICLE_FAKE_PROVIDER = '1';
      }
      const envPairs = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);

      const spawned = this.addon.spawnSuspendedAndAssign({
        jobHandle: job,
        applicationName: process.execPath,
        commandLine,
        cwd: this.baseDir,
        stdoutPath,
        stderrPath,
        envPairs,
      });

      this.pid = spawned.pid;
      this.port = port;

      const bootstrapEnvelope = JSON.stringify({
        mode: 'desktop',
        noBrowser: true,
        port,
        t3Home: this.baseDir,
        host: '127.0.0.1',
        desktopBootstrapToken: bootstrapToken,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
      this.addon.writeAndCloseHandle(spawned.stdinHandle, `${bootstrapEnvelope}\n`);
    } else {
      throw new Error('Chronicle Tactics Windows Job Object sidecar requires Win32.');
    }

    // Wait for HTTP readiness on localhost
    const baseUrl = `http://127.0.0.1:${port}`;
    // First-run SQLite migrations on a busy disk can exceed 20 seconds.
    // Startup stays asynchronous; a dead process still fails immediately.
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (this.disposed) {
        throw new Error('Sidecar manager disposed during startup.');
      }
      if (this.pid !== null && this.addon && !this.addon.isProcessAlive(this.pid)) {
        const errTail = this.readLogTail(stderrPath) || this.readLogTail(stdoutPath);
        const msg = `Sidecar process exited prematurely.${errTail ? ` Log: ${errTail}` : ''}`;
        this.lastError = msg;
        throw new Error(msg);
      }
      try {
        const res = await fetch(`${baseUrl}/.well-known/t3/environment`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // still booting
      }
      await new Promise((r) => setTimeout(r, 120));
    }

    if (!ready) {
      const errTail = this.readLogTail(stderrPath) || this.readLogTail(stdoutPath);
      const msg = `Sidecar HTTP endpoint did not become ready within 120s.${errTail ? ` Log: ${errTail}` : ''}`;
      this.lastError = msg;
      throw new Error(msg);
    }

    // Exchange desktop bootstrap token -> access token -> WebSocket ticket
    const form = new URLSearchParams();
    form.set('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
    form.set('subject_token', bootstrapToken);
    form.set('subject_token_type', 'urn:t3:params:oauth:token-type:environment-bootstrap');
    form.set('requested_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    form.set('client_label', 'Chronicle Tactics');
    form.set('client_device_type', 'desktop');

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Sidecar token exchange failed (${tokenRes.status}): ${body}`);
    }
    const tokenJson = (await tokenRes.json()) as { access_token: string };

    const ticketRes = await fetch(`${baseUrl}/api/auth/websocket-ticket/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!ticketRes.ok) {
      const body = await ticketRes.text();
      throw new Error(`Sidecar WS ticket request failed (${ticketRes.status}): ${body}`);
    }
    const ticketJson = (await ticketRes.json()) as { ticket: string | { value: string } };
    const wsTicket = typeof ticketJson.ticket === 'string' ? ticketJson.ticket : ticketJson.ticket.value;

    await this.connectWebSocket(port, wsTicket);
    await this.subscribeServerConfig();
    this.lastError = null;
    return this.getStatus();
  }

  private readLogTail(logPath: string): string {
    try {
      const text = readFileSync(logPath, 'utf8').trim();
      return text.slice(-600);
    } catch {
      return '';
    }
  }

  private connectWebSocket(port: number, wsTicket: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://127.0.0.1:${port}/ws?wsTicket=${encodeURIComponent(wsTicket)}&orchestrationProtocol=2`;
      const ws = new WebSocket(wsUrl);
      let settled = false;

      ws.addEventListener('open', () => {
        this.ws = ws;
        settled = true;
        resolve();
      });

      ws.addEventListener('message', (event) => {
        const text = typeof event.data === 'string' ? event.data : String(event.data);
        try {
          const parsed = JSON.parse(text) as unknown;
          const frames = Array.isArray(parsed) ? parsed : [parsed];
          for (const frame of frames) {
            this.handleRpcFrame(frame as Record<string, unknown>);
          }
        } catch {
          // ignore malformed frames
        }
      });

      ws.addEventListener('close', () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        for (const [, p] of this.pending) {
          p.reject(new Error('Sidecar WebSocket closed.'));
        }
        this.pending.clear();
        if (!settled) {
          settled = true;
          reject(new Error('Sidecar WebSocket closed during handshake.'));
        }
      });

      ws.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          reject(new Error('Sidecar WebSocket connection error.'));
        }
      });
    });
  }

  private handleRpcFrame(frame: Record<string, unknown>): void {
    const tag = frame._tag;
    const requestId = frame.requestId !== undefined ? String(frame.requestId) : '';
    if (tag === 'Chunk' && requestId) {
      const entry = this.pending.get(requestId);
      const values = Array.isArray(frame.values) ? frame.values : [];
      if (entry?.onChunk) {
        for (const item of values) {
          entry.onChunk(item);
        }
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ _tag: 'Ack', requestId }));
      }
      return;
    }

    if (tag === 'Exit' && requestId) {
      const entry = this.pending.get(requestId);
      if (!entry) return;
      this.pending.delete(requestId);
      const exit = frame.exit as { _tag: string; value?: unknown; cause?: unknown } | undefined;
      if (exit?._tag === 'Success') {
        entry.resolve(exit.value);
      } else {
        const msg = extractRpcFailureMessage(exit?.cause ?? frame);
        entry.reject(new Error(msg));
      }
      return;
    }

    if (tag === 'Defect') {
      const msg = extractRpcFailureMessage(frame.defect);
      this.lastError = msg;
    }
  }

  async rawRpcCall<T = unknown>(method: string, payload: unknown = {}): Promise<T> {
    await this.ensureStarted();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Sidecar WebSocket is not connected.');
    }
    const id = String(++this.reqSeq);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        isStream: false,
      });
      this.ws!.send(
        JSON.stringify({
          _tag: 'Request',
          id,
          tag: method,
          payload,
          headers: [],
        }),
      );
    });
  }

  private startStreamRpc(method: string, payload: unknown, onChunk: (item: unknown) => void): string {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Sidecar WebSocket is not connected.');
    }
    const id = String(++this.reqSeq);
    this.pending.set(id, {
      resolve: () => {},
      reject: () => {},
      isStream: true,
      onChunk,
    });
    this.ws.send(
      JSON.stringify({
        _tag: 'Request',
        id,
        tag: method,
        payload,
        headers: [],
      }),
    );
    return id;
  }

  private async subscribeServerConfig(): Promise<void> {
    if (this.configSubId && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    this.configSubId = this.startStreamRpc('subscribeServerConfig', {}, (event) => {
      if (!event || typeof event !== 'object') return;
      const ev = event as {
        type?: string;
        config?: { providers?: RawServerProvider[] };
        payload?: { providers?: RawServerProvider[] };
      };
      if (ev.type === 'snapshot' && ev.config?.providers) {
        this.rawProviders = ev.config.providers;
        this.emitProvidersUpdated();
      } else if (ev.type === 'providerStatuses' && ev.payload?.providers) {
        this.rawProviders = ev.payload.providers;
        this.emitProvidersUpdated();
      }
    });
  }

  private emitProvidersUpdated(): void {
    const mapped = this.mapProviders();
    for (const listener of this.providerListeners) {
      listener(mapped);
    }
  }

  async listProviders(): Promise<ProviderInfo[]> {
    await this.ensureStarted();
    if (this.rawProviders.length === 0) {
      const config = await this.rawRpcCall<{ providers?: RawServerProvider[] }>('server.getConfig', {});
      this.rawProviders = config.providers ?? [];
    }
    return this.mapProviders();
  }

  async refreshProviders(): Promise<ProviderInfo[]> {
    await this.ensureStarted();
    const res = await this.rawRpcCall<{ providers?: RawServerProvider[] }>('server.refreshProviders', {
      fresh: true,
      refreshModels: true,
    });
    if (Array.isArray(res.providers) && res.providers.length > 0) {
      this.rawProviders = res.providers;
      this.emitProvidersUpdated();
    } else {
      const cfg = await this.rawRpcCall<{ providers?: RawServerProvider[] }>('server.getConfig', {});
      this.rawProviders = cfg.providers ?? this.rawProviders;
      this.emitProvidersUpdated();
    }
    return this.mapProviders();
  }

  async startProviderAuth(instanceId: string, methodId?: string): Promise<ProviderInfo> {
    await this.ensureStarted();
    const authState = await this.rawRpcCall<RawProviderAuthState>('provider.auth.start', {
      instanceId,
      ...(methodId ? { methodId } : {}),
    });
    this.activeAuthStates.set(instanceId, authState);
    await this.refreshProviders();
    return this.findProviderOrThrow(instanceId);
  }

  async respondProviderAuth(
    instanceId: string,
    flowId: string,
    response: { type: 'browser'; action: 'complete' | 'decline' } | { type: 'code'; code: string },
  ): Promise<ProviderInfo> {
    await this.ensureStarted();
    const prior = this.activeAuthStates.get(instanceId);
    const interactionId = prior?.interaction?.id ?? 'interactive-auth';
    const interactionType = prior?.interaction?.type;

    let wireResponse: unknown;
    if (response.type === 'browser') {
      if (interactionType === 'credentials' && response.action === 'complete') {
        const fields = prior?.interaction?.fields ?? [{ name: 'label', label: 'Account', secret: false }];
        const values: Record<string, string> = {};
        for (const f of fields) {
          values[f.name] = 'Chronicle Session';
        }
        wireResponse = { type: 'credentials', values };
      } else {
        wireResponse = {
          type: 'browser',
          action: response.action === 'complete' ? 'accept' : 'decline',
        };
      }
    } else {
      const fields = prior?.interaction?.fields ?? [{ name: 'code', label: 'Code', secret: false }];
      const values: Record<string, string> = {};
      for (const f of fields) {
        values[f.name] = response.code;
      }
      wireResponse =
        interactionType === 'terminal'
          ? { type: 'terminal', data: `${response.code}\n` }
          : { type: 'credentials', values };
    }

    const authState = await this.rawRpcCall<RawProviderAuthState>('provider.auth.respond', {
      instanceId,
      flowId,
      interactionId,
      response: wireResponse,
    });
    this.activeAuthStates.set(instanceId, authState);
    await this.refreshProviders();
    return this.findProviderOrThrow(instanceId);
  }

  async completeProviderAuth(instanceId: string, flowId: string): Promise<ProviderInfo> {
    await this.ensureStarted();
    const authState = await this.rawRpcCall<RawProviderAuthState>('provider.auth.complete', {
      instanceId,
      flowId,
      callbackUrl: 'http://127.0.0.1/callback',
    });
    this.activeAuthStates.set(instanceId, authState);
    await this.refreshProviders();
    return this.findProviderOrThrow(instanceId);
  }

  async cancelProviderAuth(instanceId: string, flowId: string): Promise<ProviderInfo> {
    await this.ensureStarted();
    const authState = await this.rawRpcCall<RawProviderAuthState>('provider.auth.cancel', {
      instanceId,
      flowId,
    });
    this.activeAuthStates.set(instanceId, authState);
    await this.refreshProviders();
    return this.findProviderOrThrow(instanceId);
  }

  async logoutProvider(instanceId: string): Promise<ProviderInfo> {
    await this.ensureStarted();
    const authState = await this.rawRpcCall<RawProviderAuthState>('provider.auth.logout', {
      instanceId,
    });
    this.activeAuthStates.set(instanceId, authState);
    await this.refreshProviders();
    return this.findProviderOrThrow(instanceId);
  }

  async gameGenerate(input: {
    attemptId: string;
    prompt: string;
    jsonSchema: unknown;
    modelSelection: { providerId: string; model: string; effort?: string };
    role?: string;
    timeoutMs?: number;
    /** Agent mode: the provider runs with full native tools inside this workspace directory. */
    agent?: { cwd: string };
  }): Promise<{ attemptId: string; output: unknown; provider: string; model: string }> {
    await this.ensureStarted();
    const options =
      input.modelSelection.effort && input.modelSelection.effort.length > 0
        ? [{ id: 'reasoningEffort', value: input.modelSelection.effort }]
        : undefined;
    return this.rawRpcCall('game.generate', {
      attemptId: input.attemptId,
      prompt: input.prompt,
      jsonSchema: input.jsonSchema,
      modelSelection: {
        instanceId: input.modelSelection.providerId,
        model: input.modelSelection.model,
        ...(options ? { options } : {}),
      },
      ...(input.role ? { role: input.role } : {}),
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
    });
  }

  async gameCancel(attemptId: string): Promise<{ cancelled: boolean }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { cancelled: false };
    }
    return this.rawRpcCall<{ cancelled: boolean }>('game.cancel', { attemptId });
  }

  private findProviderOrThrow(instanceId: string): ProviderInfo {
    const found = this.mapProviders().find((p) => p.instanceId === instanceId);
    if (!found) {
      throw new Error(`Provider '${instanceId}' not found.`);
    }
    return found;
  }

  private mapProviders(): ProviderInfo[] {
    return this.rawProviders.map((p) => {
      const authState = this.activeAuthStates.get(p.instanceId);
      const isInstalled = p.installed && p.availability !== 'unavailable';
      const isAuthenticated = p.auth.status === 'authenticated';
      const providerTextGen = p.supportsTextGeneration !== false;

      const models: ProviderModelInfo[] = (p.models ?? []).map((m) => {
        const effortDesc = m.capabilities?.optionDescriptors?.find(
          (d) =>
            d.type === 'select' &&
            (d.role === 'reasoning' || d.id === 'reasoningEffort' || d.id === 'effort'),
        );
        const supportedEffortLevels = (effortDesc?.options ?? []).map((o) => o.id);
        const defaultEffort =
          typeof effortDesc?.currentValue === 'string'
            ? effortDesc.currentValue
            : effortDesc?.options?.find((o) => o.isDefault)?.id ?? null;

        let disabledReason: string | null = null;
        if (!p.enabled) {
          disabledReason = 'Provider is disabled.';
        } else if (!isInstalled) {
          disabledReason = p.unavailableReason ?? `${p.displayName ?? p.instanceId} is not installed.`;
        } else if (!isAuthenticated) {
          disabledReason = 'Not authenticated — connect provider first.';
        } else if (!providerTextGen || m.supportsTextGeneration === false) {
          disabledReason = 'Model does not support structured JSON generation.';
        }

        return {
          slug: m.slug,
          name: m.name,
          isCustom: m.isCustom,
          supportsTextGeneration: m.supportsTextGeneration !== false,
          supportedEffortLevels,
          defaultEffort,
          selectable: disabledReason === null,
          disabledReason,
        };
      });

      const authMethods: ProviderAuthActionInfo[] =
        authState?.methods?.map((m) => ({
          methodId: m.id,
          kind: m.type,
          label: m.name,
          available: p.setup?.canAuthenticate !== false,
          ...(m.description ? { reason: m.description } : {}),
        })) ?? [
          {
            methodId: 'default',
            kind: p.auth.type ?? 'auth',
            label: isAuthenticated ? 'Reconnect' : 'Connect',
            available: p.setup?.canAuthenticate !== false && isInstalled,
            ...(isInstalled ? {} : { reason: p.unavailableReason ?? 'CLI not installed' }),
          },
        ];

      const activeFlow: InteractiveAuthFlow | null =
        authState &&
        authState.flowId &&
        ['starting', 'waiting', 'verifying'].includes(authState.phase)
          ? {
              flowId: authState.flowId,
              providerId: p.instanceId,
              phase: authState.phase,
              message: authState.message,
              ...(authState.authorizationUrl ? { url: authState.authorizationUrl } : {}),
              ...(authState.interaction?.url ? { url: authState.interaction.url } : {}),
              ...(authState.interaction?.userCode ? { userCode: authState.interaction.userCode } : {}),
              canCancel: true,
            }
          : null;

      return {
        instanceId: p.instanceId,
        driverKind: p.driver,
        name: p.displayName ?? p.instanceId,
        enabled: p.enabled,
        installed: isInstalled,
        status: p.status,
        authStatus: p.auth.status,
        authLabel: p.auth.label ?? (isAuthenticated ? 'Connected' : 'Not connected'),
        ...(p.auth.email ? { accountEmail: p.auth.email } : {}),
        message: p.message ?? p.unavailableReason ?? null,
        models,
        authMethods,
        activeFlow,
      };
    });
  }

  private cleanupConnectionOnly(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.configSubId = null;
    for (const [, p] of this.pending) {
      p.reject(new Error('Sidecar connection reset.'));
    }
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.cleanupConnectionOnly();
    this.providerListeners.clear();
    if (this.addon && this.jobHandle !== null) {
      try {
        this.addon.terminateJob(this.jobHandle, 1);
      } catch {
        // ignore
      }
      this.jobHandle = null;
    }
    this.pid = null;
    this.port = null;
  }
}
