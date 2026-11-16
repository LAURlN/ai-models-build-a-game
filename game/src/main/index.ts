import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session,
  type IpcMainInvokeEvent,
} from 'electron';
import { GenerationCoordinator } from './generationCoordinator';
import { GameHost } from './gameHost';
import { SaveStore } from './saveStore';
import { T3SidecarManager } from './t3Sidecar';
import { Director } from './world/director';
import { MODULE_EXTENSIONS } from './world/moduleLoader';
import { createWorldClient, type WorldApi } from './world/worldClient';
import type { BattleState, ProviderSettings, RoleModelSelection } from '../shared/contracts';

protocol.registerSchemesAsPrivileged([{
  scheme: 'chronicle', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);
const rendererUrl = 'chronicle://app/index.html';
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

let mainWindow: BrowserWindow | null = null;
let gameHost: GameHost | null = null;
let mainStore: SaveStore | null = null;
let sidecar: T3SidecarManager | null = null;
let coordinator: GenerationCoordinator | null = null;
let world: WorldApi | null = null;
let director: Director | null = null;
let workspacesDir = '';
let disposed = false;

const enemyDelayEnv = Number(process.env.CHRONICLE_ENEMY_DELAY_MS ?? '80');
const enemyDelayMs = Number.isFinite(enemyDelayEnv) && enemyDelayEnv >= 0 ? enemyDelayEnv : 80;

function cleanupAll(): void {
  if (disposed) return;
  disposed = true;
  try { gameHost?.dispose(); } catch { /* ignore */ }
  try { director?.dispose(); } catch { /* ignore */ }
  try { world?.dispose(); } catch { /* ignore */ }
  try { sidecar?.dispose(); } catch { /* ignore */ }
  try { mainStore?.close(); } catch { /* ignore */ }
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  const webContents = mainWindow.webContents;
  return (
    event.sender.id === webContents.id &&
    event.senderFrame !== null &&
    event.senderFrame.routingId === webContents.mainFrame.routingId &&
    event.senderFrame.processId === webContents.mainFrame.processId &&
    event.senderFrame.url === rendererUrl
  );
}

function assertBoundedString(value: unknown, field: string, maxLen = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLen) {
    throw new Error(`Invalid ${field}.`);
  }
  return value;
}

function validateRoleSelection(raw: unknown, field: string): RoleModelSelection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid ${field} selection.`);
  }
  const rec = raw as Record<string, unknown>;
  const providerId = assertBoundedString(rec.providerId, `${field}.providerId`, 64);
  const model = assertBoundedString(rec.model, `${field}.model`, 128);
  const effort = rec.effort;
  if (effort !== undefined && effort !== '' && !['low', 'medium', 'high', 'xhigh'].includes(String(effort))) {
    throw new Error(`Invalid ${field}.effort.`);
  }
  return {
    providerId,
    model,
    ...(typeof effort === 'string' ? { effort: effort as NonNullable<RoleModelSelection['effort']> } : {}),
  };
}

function validateProviderSettingsPayload(raw: unknown): ProviderSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid provider settings payload.');
  }
  const rec = raw as Record<string, unknown>;
  const architect = validateRoleSelection(rec.architect, 'architect');
  const chronicler = validateRoleSelection(rec.chronicler, 'chronicler');
  const rawFallbacks = Array.isArray(rec.fallbacks) ? rec.fallbacks : [];
  if (rawFallbacks.length > 8) {
    throw new Error('Too many fallback entries.');
  }
  const fallbacks = rawFallbacks.map((entry, idx) => validateRoleSelection(entry, `fallbacks[${idx}]`));
  const concurrency = Number(rec.helperConcurrency);
  return {
    architect, chronicler, fallbacks,
    ...(rec.narrator ? { narrator: validateRoleSelection(rec.narrator, 'narrator') } : {}),
    ...(rec.helper ? { helper: validateRoleSelection(rec.helper, 'helper') } : {}),
    ...(Number.isFinite(concurrency) && concurrency >= 1 ? { helperConcurrency: Math.min(8, Math.round(concurrency)) } : {}),
  };
}

function validateLaunchBattleState(raw: unknown): BattleState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid chapter BattleState payload.');
  }
  const state = raw as BattleState;
  if (
    state.rulesVersion !== 'r03-1' ||
    !Array.isArray(state.terrain) ||
    !Array.isArray(state.units) ||
    state.units.length === 0
  ) {
    throw new Error('Invalid chapter BattleState fields.');
  }
  return state;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: 'Chronicle Tactics — Brass Ward',
    show: process.env.CHRONICLE_HEADLESS !== '1',
    backgroundColor: '#172e30',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Exercise real animation frames in the hidden E2E compositor, while
      // retaining normal background power saving in the interactive game.
      backgroundThrottling: process.env.CHRONICLE_HEADLESS !== '1',
    },
  });

  win.setMenuBarVisibility(false);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== rendererUrl) {
      event.preventDefault();
    }
  });

  void win.loadURL(rendererUrl);
  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle('game:get-snapshot', (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return gameHost!.getSnapshot();
  });

  ipcMain.handle('game:dispatch', (event, rawCommand: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return gameHost!.dispatch(rawCommand);
  });

  for (const operation of ['save', 'load', 'rewind', 'restart'] as const) {
    ipcMain.handle('game:' + operation, (event) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
      return gameHost![operation]();
    });
  }

  ipcMain.handle('game:forecast', (event, attackerId: unknown, targetId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    if (typeof attackerId !== 'string' || typeof targetId !== 'string' || attackerId.length > 128 || targetId.length > 128) {
      throw new Error('Invalid forecast payload.');
    }
    return gameHost!.forecast(attackerId, targetId);
  });

  // Sidecar & Provider management
  ipcMain.handle('t3:sidecar-status', (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return sidecar!.getStatus();
  });

  ipcMain.handle('t3:providers-list', (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return sidecar!.listProviders();
  });

  ipcMain.handle('t3:providers-refresh', (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return sidecar!.refreshProviders();
  });

  ipcMain.handle('t3:providers-auth-start', (event, instanceId: unknown, methodId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    const id = assertBoundedString(instanceId, 'instanceId', 64);
    const method = methodId === undefined ? undefined : assertBoundedString(methodId, 'methodId', 64);
    return sidecar!.startProviderAuth(id, method);
  });

  ipcMain.handle('t3:providers-auth-respond', (event, instanceId: unknown, flowId: unknown, response: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    const id = assertBoundedString(instanceId, 'instanceId', 64);
    const flow = assertBoundedString(flowId, 'flowId', 128);
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw new Error('Invalid auth response payload.');
    }
    const rec = response as Record<string, unknown>;
    if (rec.type === 'browser' && (rec.action === 'complete' || rec.action === 'decline')) {
      return sidecar!.respondProviderAuth(id, flow, { type: 'browser', action: rec.action });
    }
    if (rec.type === 'code' && typeof rec.code === 'string' && rec.code.length > 0 && rec.code.length <= 256) {
      return sidecar!.respondProviderAuth(id, flow, { type: 'code', code: rec.code });
    }
    throw new Error('Unsupported auth response payload.');
  });

  ipcMain.handle('t3:providers-auth-complete', (event, instanceId: unknown, flowId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return sidecar!.completeProviderAuth(
      assertBoundedString(instanceId, 'instanceId', 64),
      assertBoundedString(flowId, 'flowId', 128),
    );
  });

  ipcMain.handle('t3:providers-auth-cancel', (event, instanceId: unknown, flowId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return sidecar!.cancelProviderAuth(
      assertBoundedString(instanceId, 'instanceId', 64),
      assertBoundedString(flowId, 'flowId', 128),
    );
  });

  ipcMain.handle('t3:providers-logout', (event, instanceId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return sidecar!.logoutProvider(assertBoundedString(instanceId, 'instanceId', 64));
  });

  // Provider settings persisted in SQLite
  ipcMain.handle('settings:get-providers', (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return mainStore!.getProviderSettings();
  });

  ipcMain.handle('settings:save-providers', (event, rawSettings: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return mainStore!.saveProviderSettings(validateProviderSettingsPayload(rawSettings));
  });

  // Campaign generation & launch
  ipcMain.handle('campaign:generate', (event, rawPremise: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    if (typeof rawPremise !== 'string' || rawPremise.length > 1000) {
      throw new Error('Invalid campaign premise.');
    }
    return coordinator!.startGeneration(rawPremise);
  });

  ipcMain.handle('campaign:cancel', (event, rawAttemptId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return coordinator!.cancelGeneration(assertBoundedString(rawAttemptId, 'attemptId', 128));
  });

  ipcMain.handle('campaign:status', (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return coordinator!.getStatus();
  });

  ipcMain.handle('campaign:launch', (event, rawState: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
    return gameHost!.launchChapter(validateLaunchBattleState(rawState));
  });

  // Open-ended campaigns: Narrator chat, helper agents, generated modules and limitless battles.
  // Payloads are forwarded as-is: the world host tolerates anything and nothing here restricts content.
  const worldHandle = (channel: string, handler: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender.');
      return handler(...args);
    });
  };
  const text = (value: unknown, max: number): string => {
    if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text payload.');
    return value;
  };
  worldHandle('world:list', () => world!.listCampaigns());
  worldHandle('world:create', (setting) => director!.create(text(setting, 20_000)));
  worldHandle('world:open', (id) => director!.open(text(id, 128)));
  worldHandle('world:close', () => director!.close());
  worldHandle('world:remove', async (id) => { await world!.deleteCampaign(text(id, 128)); });
  worldHandle('world:view', () => world!.view());
  worldHandle('world:status', () => director!.status());
  worldHandle('world:say', (message) => director!.say(text(message, 20_000)));
  worldHandle('world:retry', () => director!.retry());
  worldHandle('world:command', (name, args) => world!.runCommand(text(name, 200), args));
  worldHandle('world:battle-command', (command) => world!.battleCommand(command as never));
  worldHandle('world:battle-select', (unitId) => world!.battleSelect(text(unitId, 200)));
  worldHandle('world:battle-forecast', (a, t, weapon, from) => world!.battleForecast(text(a, 200), text(t, 200), typeof weapon === 'number' ? weapon : undefined, (from ?? null) as never));
  worldHandle('world:battle-threat', () => world!.battleThreat());
  worldHandle('world:battle-preview', (unitId, abilityId, target) => world!.battlePreview(text(unitId, 200), text(abilityId, 200), target));
  worldHandle('world:battle-rewind', () => world!.battleRewind());
  worldHandle('world:battle-resolve', () => director!.resolveBattle());
}

/** Serves generated module files to the renderer from campaign workspaces (same origin, so CSP 'self' applies). */
async function serveWorkspaceModule(pathname: string): Promise<Response> {
  const parts = pathname.split('/').filter(Boolean); // ws/<campaignId>/modules/<file>
  const [, campaignId, folder, ...rest] = parts;
  const file = rest.join('/');
  if (!campaignId || folder !== 'modules' || !file || !/^[\w-]+$/.test(campaignId) || !MODULE_EXTENSIONS.includes(path.extname(file))) {
    return new Response('Forbidden', { status: 403 });
  }
  const root = path.join(workspacesDir, campaignId, 'modules');
  const full = path.resolve(root, file);
  if (path.relative(root, full).startsWith('..')) return new Response('Forbidden', { status: 403 });
  try {
    let source = await readFile(full, 'utf8');
    if (full.endsWith('.ts')) {
      const strip = (await import('node:module') as unknown as { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;
      if (strip) source = strip(source);
    }
    return new Response(source, { headers: { 'Content-Type': 'text/javascript', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
  } catch (error) {
    // A missing or unparsable module must surface as a failed import in the renderer, not crash the app.
    return new Response(`throw new Error(${JSON.stringify(`Module could not be served: ${String(error)}`)});`, { headers: { 'Content-Type': 'text/javascript', 'Content-Security-Policy': csp } });
  }
}

void app.whenReady().then(() => {
  const userDataDir = app.getPath('userData');
  const dbPath = path.join(userDataDir, 'battle.sqlite');
  const t3HomeDir = path.join(userDataDir, 't3-home');

  // Initialize the fresh database before the worker opens its own connection.
  mainStore = new SaveStore(dbPath);
  gameHost = new GameHost(enemyDelayMs, dbPath);
  sidecar = new T3SidecarManager({ baseDir: t3HomeDir });
  coordinator = new GenerationCoordinator(sidecar, mainStore);
  workspacesDir = path.join(userDataDir, 'campaigns');
  world = createWorldClient({ dbPath: path.join(userDataDir, 'campaigns.sqlite'), workspacesDir, aiDelayMs: enemyDelayMs, contentDir: path.resolve(__dirname, '../content') });
  director = new Director(world, sidecar, () => mainStore!.getProviderSettings(), path.resolve(__dirname, '../content'));

  const rendererRoot = path.resolve(__dirname, '../renderer');
  protocol.handle('chronicle', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return new Response('Bad path', { status: 400 }); }
    if (pathname.startsWith('/ws/')) return serveWorkspaceModule(pathname);
    const file = path.resolve(rendererRoot, `.${pathname}`);
    const relative = path.relative(rendererRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || pathname.includes('\0')) {
      return new Response('Forbidden', { status: 403 });
    }
    const contentType: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    try {
      return new Response(await readFile(file), { headers: {
        'Content-Type': contentType[path.extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
      } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerIpcHandlers();

  gameHost.subscribe((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:state-updated', snapshot);
    }
  });

  sidecar.subscribeProviders((providers) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('t3:providers-updated', providers);
    }
  });

  coordinator.subscribe((ev) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('campaign:generation-progress', ev);
    }
  });

  world.subscribe((ev) => {
    if (ev.type === 'view' && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('world:view', ev.view);
  });
  director.subscribe((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('world:status', status);
  });

  // Warm the headless T3 sidecar asynchronously; errors remain non-fatal because Local Fallback handles unavailability.
  void sidecar.ensureStarted().catch(() => {});

  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('before-quit', () => cleanupAll());
app.on('will-quit', () => cleanupAll());
process.on('SIGINT', () => {
  cleanupAll();
  app.quit();
});
process.on('SIGTERM', () => {
  cleanupAll();
  app.quit();
});
