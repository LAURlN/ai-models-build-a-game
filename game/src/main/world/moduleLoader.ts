/**
 * Loads generated content modules from a campaign workspace into a Registry.
 * A module that fails to parse, import or register is recorded as an error
 * (never thrown) so play continues and a repair helper can be dispatched.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordLoadError, registerModule, unregisterModule, type Registry } from '../../engine/registry';
import type { ModuleRecord } from '../../engine/types';

// esbuild keeps non-literal dynamic imports as native `import()` for node24 CJS output; Vitest resolves them itself.
const nativeImport = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

export const MODULE_EXTENSIONS = ['.js', '.mjs', '.ts'];

export interface LoadedFile { file: string; hash: string; moduleId: string }

export class ModuleLoader {
  private readonly loaded = new Map<string, LoadedFile>();
  /** file → content hash that must not be imported again (hung while loading). */
  private readonly blocked = new Map<string, { hash: string; message: string }>();
  constructor(private readonly reg: Registry, private readonly workspace: string, private readonly onEnter?: (label: string | null) => void) {}

  get modulesDir(): string { return path.join(this.workspace, 'modules'); }

  listFiles(): string[] {
    if (!existsSync(this.modulesDir)) return [];
    return readdirSync(this.modulesDir).filter((f) => MODULE_EXTENSIONS.includes(path.extname(f)) && !f.endsWith('.d.ts')).sort();
  }

  block(file: string, hash: string, message: string): void { this.blocked.set(file, { hash, message }); }

  fileHash(file: string): string {
    try { return createHash('sha1').update(readFileSync(path.join(this.modulesDir, file))).digest('hex').slice(0, 16); }
    catch { return ''; }
  }

  /** (Re)loads changed files, drops deleted ones. Returns the records that changed in this pass. */
  async sync(): Promise<{ changed: ModuleRecord[]; all: ModuleRecord[] }> {
    mkdirSync(this.modulesDir, { recursive: true });
    const files = this.listFiles();
    const changed: ModuleRecord[] = [];
    for (const [file, info] of [...this.loaded]) {
      if (!files.includes(file)) { unregisterModule(this.reg, info.moduleId); this.loaded.delete(file); }
    }
    for (const file of files) {
      const hash = this.fileHash(file);
      const previous = this.loaded.get(file);
      if (previous && previous.hash === hash && this.reg.modules[previous.moduleId]) continue;
      if (previous) unregisterModule(this.reg, previous.moduleId);
      const relative = `modules/${file}`, fallbackId = path.basename(file, path.extname(file));
      let record: ModuleRecord;
      const blocked = this.blocked.get(file);
      if (blocked && blocked.hash === hash) {
        record = recordLoadError(this.reg, relative, fallbackId, new Error(blocked.message));
      } else {
        try {
          this.onEnter?.(`load:${file}:${hash}`);
          const url = `${pathToFileURL(path.join(this.modulesDir, file)).href}?v=${hash}`;
          const exported = await nativeImport(url);
          record = registerModule(this.reg, exported, { file: relative, fallbackId }, { side: 'sim' });
        } catch (error) {
          record = recordLoadError(this.reg, relative, fallbackId, error);
        } finally { this.onEnter?.(null); }
      }
      this.loaded.set(file, { file, hash, moduleId: record.id });
      changed.push(record);
    }
    return { changed, all: Object.values(this.reg.modules) };
  }

  /** Version map for the renderer, which imports the same files through the chronicle:// protocol. */
  versions(): { file: string; hash: string }[] {
    return [...this.loaded.values()].map(({ file, hash }) => ({ file, hash }));
  }
}
