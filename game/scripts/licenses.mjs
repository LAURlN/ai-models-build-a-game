import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Collect full notices for packages that actually contribute bytes to the bundles.
// Do not publish absolute metafile input paths or install-time package metadata.
export function writeThirdPartyLicenses(root, builds, rendererInputs = []) {
  const inputs = new Set(rendererInputs);
  for (const build of builds) {
    for (const output of Object.values(build.metafile.outputs)) {
      for (const [input, details] of Object.entries(output.inputs)) {
        if (details.bytesInOutput > 0) inputs.add(path.resolve(root, input));
      }
    }
  }
  const packages = new Map();
  for (const input of inputs) {
    if (!input.replaceAll('\\', '/').includes('/node_modules/')) continue;
    let dir = path.dirname(path.resolve(input));
    while (dir !== path.dirname(dir)) {
      const manifest = path.join(dir, 'package.json');
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (pkg.name && pkg.version) { packages.set(dir, pkg); break; }
      }
      dir = path.dirname(dir);
    }
  }
  const sections = [];
  for (const [dir, pkg] of [...packages].sort((a, b) => `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`))) {
    const files = readdirSync(dir).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name) && statSync(path.join(dir, name)).isFile()).sort();
    if (!files.some(name => /^(licen[cs]e|copying)([.-]|$)/i.test(name))) {
      throw new Error(`Missing full licence text for bundled ${pkg.name}@${pkg.version}`);
    }
    sections.push(`${pkg.name}@${pkg.version}\nLicense: ${pkg.license ?? 'See text below'}\n\n` + files.map(name => `${name}\n${readFileSync(path.join(dir, name), 'utf8').trim()}`).join('\n\n'));
  }
  const out = path.join(root, 'dist/licenses');
  mkdirSync(path.join(out, 't3code'), { recursive: true });
  for (const name of ['LICENSE', 'NOTICE', 'FORK_PATCHES.md']) cpSync(path.join(root, 'sidecar', name), path.join(out, 't3code', name));
  writeFileSync(path.join(out, 'THIRD_PARTY_LICENSES.txt'),
    'Chronicle Tactics — bundled npm dependency licences\n\n' +
    'T3 Code: see t3code/LICENSE, NOTICE and FORK_PATCHES.md.\n' +
    'Fonts: system fonts only; no font binaries are redistributed.\n' +
    'Electron/Chromium notices: see LICENSE.electron.txt and LICENSES.chromium.html beside the executable.\n\n' +
    sections.join('\n\n' + '='.repeat(78) + '\n\n') + '\n');
  console.log(`Collected full licence texts for ${packages.size} bundled npm packages.`);
}
