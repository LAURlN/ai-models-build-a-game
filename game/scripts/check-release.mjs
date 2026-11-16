import { extractAll } from '@electron/asar';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const release = path.join(root, 'release');
// Builder diagnostics include local NSIS include/cache paths and are not release
// artefacts. Remove the exact generated file before auditing the output folder.
const debugLog = path.join(release, 'builder-debug.yml');
if (existsSync(debugLog)) unlinkSync(debugLog);
const unpacked = path.join(release, 'win-unpacked');
const extracted = path.join(release, 'audit-app');
if (path.dirname(extracted) !== release) throw new Error('Audit output escaped release directory.');
rmSync(extracted, { recursive: true, force: true, maxRetries: 5 });
extractAll(path.join(unpacked, 'resources/app.asar'), extracted);
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) yield* files(file);
    else yield file;
  }
}
const errors = [];
let count = 0;
for (const dir of [release]) {
  for (const file of files(dir)) {
    count++;
    const relative = path.relative(release, file);
    if (file.endsWith('.map')) errors.push(`${relative}: source map`);
    if (relative.split(path.sep).includes('node_modules')) errors.push(`${relative}: unbundled dependency`);
    const bytes = readFileSync(file);
    for (const encoding of ['utf8', 'utf16le']) {
      const text = bytes.toString(encoding);
      // Binary opcodes can coincidentally contain D-colon-slash. Require path
      // components there; Electron's embedded Node also documents a bare D root.
      const drivePath = /\.(?:m?js|cjs|json|html|css|txt|md)$/i.test(file)
        ? /\bD:(?:\\+|\/)/i
        : /\bD:(?:\\+|\/)[A-Za-z0-9_.-]+(?:\\+|\/)[A-Za-z0-9_.-]+/i;
      const normalized = text.replaceAll(/\\+/g, '/').toLowerCase();
      const buildRoot = path.dirname(root).replaceAll('\\', '/').toLowerCase();
      if (drivePath.test(text) || /C:(?:\\+|\/)Users\b/i.test(text) || normalized.includes(buildRoot)) {
        errors.push(`${relative}: local build path or identifier (${encoding})`);
      }
    }
  }
}
for (const name of ['THIRD_PARTY_LICENSES.txt', 't3code/LICENSE', 't3code/NOTICE', 't3code/FORK_PATCHES.md']) {
  if (!existsSync(path.join(unpacked, 'resources/licenses', name))) errors.push(`Missing licence notice: ${name}`);
}
for (const name of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) {
  if (!existsSync(path.join(unpacked, name))) errors.push(`Missing Electron notice: ${name}`);
}
for (const name of ['sidecar/bin.mjs', 'native/job_object.node']) {
  if (!existsSync(path.join(unpacked, 'resources/runtime', name))) errors.push(`Missing runtime: ${name}`);
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Release audit passed: ${count} files scanned as UTF-8 and UTF-16LE, including extracted app.asar and all runtime resources; no local paths, source maps or unbundled dependencies.`);
