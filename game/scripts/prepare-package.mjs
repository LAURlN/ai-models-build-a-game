import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const app = path.join(root, 'dist/app');
mkdirSync(app, { recursive: true });
// A self-contained app manifest: everything is bundled, no development workspace
// or node_modules belongs in the release.
writeFileSync(path.join(app, 'package.json'), JSON.stringify({
  name: source.name, version: source.version, description: source.description,
  main: source.main, private: true,
}, null, 2) + '\n');
// Keep the packager's dependency discovery inside this dependency-free app.
writeFileSync(path.join(app, 'package-lock.json'), JSON.stringify({
  name: source.name, version: source.version, lockfileVersion: 3, requires: true,
  packages: { '': { name: source.name, version: source.version } },
}, null, 2) + '\n');
for (const dir of ['main', 'preload', 'renderer', 'content']) {
  cpSync(path.join(root, 'dist', dir), path.join(app, 'dist', dir), { recursive: true });
}
