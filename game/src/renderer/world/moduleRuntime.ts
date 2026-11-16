/**
 * Renderer half of the extension API. The same generated module files are imported
 * here (served from the campaign workspace through chronicle://app/ws/…) so their
 * panels, procedural drawing, effects, sounds, music and non-grid mode views run in
 * the UI. Failures are recorded, never thrown: the simulation side owns repair.
 */
import { createRegistry, recordLoadError, registerModule, unregisterModule, type Registry } from '../../engine/registry';
import type { WorldView } from '../../engine/types';

export interface ViewRuntime { reg: Registry; key: string; errors: Record<string, string> }

let current: ViewRuntime = { reg: createRegistry(), key: '', errors: {} };
const loaded = new Map<string, string>(); // file → hash
let pending: Promise<ViewRuntime> | null = null;
let pendingKey = '';

export function viewRuntime(): ViewRuntime { return current; }

/** Brings the renderer registry in line with the workspace modules listed in the view. */
export function syncViewRuntime(view: WorldView | null): Promise<ViewRuntime> {
  const campaignId = view?.campaign?.id ?? '';
  const files = view?.moduleFiles ?? [];
  const key = `${campaignId}|${files.map((f) => `${f.file}:${f.hash}`).join(',')}`;
  if (key === current.key) return Promise.resolve(current);
  if (pending && pendingKey === key) return pending;
  pendingKey = key;
  pending = (async () => {
    const reset = !current.key.startsWith(`${campaignId}|`) || !campaignId;
    const reg = reset ? createRegistry() : current.reg;
    if (reset) loaded.clear();
    const errors: Record<string, string> = reset ? {} : { ...current.errors };
    const wanted = new Set(files.map((f) => f.file));
    for (const [file] of [...loaded]) {
      if (!wanted.has(file)) {
        const id = file.replace(/\.[a-z]+$/, '');
        unregisterModule(reg, Object.values(reg.modules).find((m) => m.file === `modules/${file}`)?.id ?? id);
        loaded.delete(file);
      }
    }
    for (const { file, hash } of files) {
      if (loaded.get(file) === hash) continue;
      const fallbackId = file.replace(/\.[a-z]+$/, '');
      const previous = Object.values(reg.modules).find((m) => m.file === `modules/${file}`);
      if (previous) unregisterModule(reg, previous.id);
      try {
        const exported = await import(/* @vite-ignore */ `chronicle://app/ws/${campaignId}/modules/${file}?v=${hash}`);
        const record = registerModule(reg, exported, { file: `modules/${file}`, fallbackId }, { side: 'view' });
        if (record.error) errors[record.id] = record.error; else delete errors[record.id];
      } catch (error) {
        const record = recordLoadError(reg, `modules/${file}`, fallbackId, error);
        errors[record.id] = record.error ?? String(error);
      }
      loaded.set(file, hash);
    }
    current = { reg, key, errors };
    return current;
  })().finally(() => { if (pendingKey === key) pending = null; });
  return pending;
}
