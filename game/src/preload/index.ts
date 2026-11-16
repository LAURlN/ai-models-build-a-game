import { contextBridge, ipcRenderer } from 'electron';
import type {
  BattleSnapshot,
  BattleState,
  ChronicleApi,
  GenerationProgressEvent,
  ProviderInfo,
  ProviderSettings,
  WorldBridge,
} from '../shared/contracts';

const subscribe = <T>(channel: string) => (listener: (payload: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
};

const world: WorldBridge = {
  list: () => ipcRenderer.invoke('world:list'),
  create: (setting) => ipcRenderer.invoke('world:create', setting),
  open: (id) => ipcRenderer.invoke('world:open', id),
  close: () => ipcRenderer.invoke('world:close'),
  remove: (id) => ipcRenderer.invoke('world:remove', id),
  view: () => ipcRenderer.invoke('world:view'),
  status: () => ipcRenderer.invoke('world:status'),
  say: (text) => ipcRenderer.invoke('world:say', text),
  retry: () => ipcRenderer.invoke('world:retry'),
  command: (name, args) => ipcRenderer.invoke('world:command', name, args),
  battleCommand: (command) => ipcRenderer.invoke('world:battle-command', command),
  battleSelect: (unitId) => ipcRenderer.invoke('world:battle-select', unitId),
  battleForecast: (attackerId, targetId, weapon, from) => ipcRenderer.invoke('world:battle-forecast', attackerId, targetId, weapon, from),
  battleThreat: () => ipcRenderer.invoke('world:battle-threat'),
  battlePreview: (unitId, abilityId, target) => ipcRenderer.invoke('world:battle-preview', unitId, abilityId, target),
  battleRewind: () => ipcRenderer.invoke('world:battle-rewind'),
  battleResolve: () => ipcRenderer.invoke('world:battle-resolve'),
  onView: subscribe('world:view'),
  onStatus: subscribe('world:status'),
};

const api: ChronicleApi = {
  world: Object.freeze(world),
  getSnapshot: () => ipcRenderer.invoke('game:get-snapshot'),
  dispatch: command => ipcRenderer.invoke('game:dispatch', command),
  forecast: (attackerId, targetId) => ipcRenderer.invoke('game:forecast', attackerId, targetId),
  save: () => ipcRenderer.invoke('game:save'),
  load: () => ipcRenderer.invoke('game:load'),
  rewind: () => ipcRenderer.invoke('game:rewind'),
  restart: () => ipcRenderer.invoke('game:restart'),
  onSnapshot: listener => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: BattleSnapshot) => listener(snapshot);
    ipcRenderer.on('game:state-updated', handler);
    return () => { ipcRenderer.removeListener('game:state-updated', handler); };
  },

  getSidecarStatus: () => ipcRenderer.invoke('t3:sidecar-status'),
  listProviders: () => ipcRenderer.invoke('t3:providers-list'),
  refreshProviders: () => ipcRenderer.invoke('t3:providers-refresh'),
  startProviderAuth: (instanceId, methodId) => ipcRenderer.invoke('t3:providers-auth-start', instanceId, methodId),
  respondProviderAuth: (instanceId, flowId, response) =>
    ipcRenderer.invoke('t3:providers-auth-respond', instanceId, flowId, response),
  completeProviderAuth: (instanceId, flowId) =>
    ipcRenderer.invoke('t3:providers-auth-complete', instanceId, flowId),
  cancelProviderAuth: (instanceId, flowId) =>
    ipcRenderer.invoke('t3:providers-auth-cancel', instanceId, flowId),
  logoutProvider: (instanceId) => ipcRenderer.invoke('t3:providers-logout', instanceId),
  onProvidersUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, providers: ProviderInfo[]) => listener(providers);
    ipcRenderer.on('t3:providers-updated', handler);
    return () => { ipcRenderer.removeListener('t3:providers-updated', handler); };
  },

  getProviderSettings: () => ipcRenderer.invoke('settings:get-providers'),
  saveProviderSettings: (settings: ProviderSettings) => ipcRenderer.invoke('settings:save-providers', settings),

  startGeneration: (premise: string) => ipcRenderer.invoke('campaign:generate', premise),
  cancelGeneration: (attemptId: string) => ipcRenderer.invoke('campaign:cancel', attemptId),
  getGenerationStatus: () => ipcRenderer.invoke('campaign:status'),
  onGenerationProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: GenerationProgressEvent) => listener(event);
    ipcRenderer.on('campaign:generation-progress', handler);
    return () => { ipcRenderer.removeListener('campaign:generation-progress', handler); };
  },
  launchChapter: (state: BattleState) => ipcRenderer.invoke('campaign:launch', state),
};
contextBridge.exposeInMainWorld('chronicleApi', Object.freeze(api));
