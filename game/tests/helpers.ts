import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { createRegistry, type Registry } from '../src/engine/registry';
import { ModuleLoader } from '../src/main/world/moduleLoader';

const temp: string[] = [];
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temp.push(dir);
  return dir;
}
afterEach(() => {
  while (temp.length) {
    const dir = temp.pop()!;
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* Windows handle lag */ }
  }
});

const EXAMPLES = path.resolve(__dirname, '../src/content/examples');
export async function loadExamples(names: string[], extra: Record<string, string> = {}): Promise<{ reg: Registry; loader: ModuleLoader; workspace: string }> {
  const workspace = tempDir('chronicle-ws-');
  mkdirSync(path.join(workspace, 'modules'), { recursive: true });
  writeFileSync(path.join(workspace, 'package.json'), '{"type":"module"}');
  for (const name of names) cpSync(path.join(EXAMPLES, `${name}.js`), path.join(workspace, 'modules', `${name}.js`));
  for (const [file, source] of Object.entries(extra)) writeFileSync(path.join(workspace, 'modules', file), source);
  const reg = createRegistry();
  const loader = new ModuleLoader(reg, workspace);
  await loader.sync();
  return { reg, loader, workspace };
}

