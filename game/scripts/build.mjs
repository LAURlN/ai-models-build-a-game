import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { writeThirdPartyLicenses } from './licenses.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const sidecarRoot = path.join(rootDir, 'sidecar');

// Keep an optional build-directory junction intact when cleaning output.
mkdirSync(distDir, { recursive: true });
for (const entry of readdirSync(distDir)) {
  const target = path.resolve(distDir, entry);
  if (path.dirname(target) !== distDir) throw new Error('Build output escaped dist');
  rmSync(target, { recursive: true, force: true });
}
mkdirSync(path.join(distDir, 'native'), { recursive: true });
mkdirSync(path.join(distDir, 'sidecar'), { recursive: true });

if (process.platform === 'win32') {
  execFileSync(
    'gcc',
    [
      '-shared',
      '-O2',
      '-Wall',
      '-Wextra',
      path.join(rootDir, 'native/job_object.c'),
      '-o',
      path.join(distDir, 'native/job_object.node'),
      '-lkernel32',
    ],
    { stdio: 'inherit' },
  );
}

const sidecarTsconfig = JSON.parse(readFileSync(path.join(sidecarRoot, 'tsconfig.json'), 'utf8'));
const sidecarPaths = sidecarTsconfig?.compilerOptions?.paths ?? {};

const sidecarAliasPlugin = {
  name: 'sidecar-tsconfig-paths',
  setup(build) {
    const exactEntries = [];
    const prefixEntries = [];
    for (const [pattern, targets] of Object.entries(sidecarPaths)) {
      const target = targets[0];
      if (!target) continue;
      if (pattern.endsWith('/*') && target.endsWith('/*.ts')) {
        prefixEntries.push({
          prefix: pattern.slice(0, -1),
          targetPrefix: path.resolve(sidecarRoot, target.slice(0, -4)) + path.sep,
        });
      } else {
        exactEntries.push({
          exact: pattern,
          resolved: path.resolve(sidecarRoot, target),
        });
      }
    }

    build.onResolve({ filter: /.*/ }, (args) => {
      for (const item of exactEntries) {
        if (args.path === item.exact) {
          return { path: item.resolved };
        }
      }
      for (const item of prefixEntries) {
        if (args.path.startsWith(item.prefix)) {
          const rest = args.path.slice(item.prefix.length);
          const candidate = item.targetPrefix + rest + (rest.endsWith('.ts') || rest.endsWith('.json') ? '' : '.ts');
          return { path: candidate };
        }
      }
      return undefined;
    });
  },
};

const sidecarBuild = await esbuild({
  entryPoints: [path.join(sidecarRoot, 'apps/server/src/bin.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['node:*'],
  plugins: [sidecarAliasPlugin],
  banner: {
    js: "import { createRequire as __chronicleCreateRequire } from 'node:module'; const require = __chronicleCreateRequire(import.meta.url);",
  },
  outfile: path.join(distDir, 'sidecar/bin.mjs'),
  sourcemap: false,
  metafile: true,
  logLevel: 'warning',
});

const mainBuild = await esbuild({
  entryPoints: [path.join(rootDir, 'src/main/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
  outfile: path.join(distDir, 'main/index.cjs'),
  sourcemap: false,
  metafile: true,
});

const workerBuild = await esbuild({
  entryPoints: [path.join(rootDir, 'src/main/worker.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: path.join(distDir, 'main/worker.cjs'),
  metafile: true,
});

const worldBuild = await esbuild({
  entryPoints: [path.join(rootDir, 'src/main/world/worldWorker.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: path.join(distDir, 'main/worldWorker.cjs'),
  metafile: true,
});

// Extension API documentation and example modules handed to the Narrator and helper agents.
cpSync(path.join(rootDir, 'src/content'), path.join(distDir, 'content'), { recursive: true });

await esbuild({
  entryPoints: [path.join(rootDir, 'src/preload/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['electron'],
  outfile: path.join(distDir, 'preload/index.cjs'),
  sourcemap: false,
});

const rendererInputs = new Set();
await viteBuild({
  configFile: path.join(rootDir, 'vite.config.ts'),
  plugins: [{
    name: 'bundled-license-inputs',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(output.modules)) {
          if (module.renderedLength > 0) rendererInputs.add(id);
        }
      }
    },
  }],
});

writeThirdPartyLicenses(rootDir, [sidecarBuild, mainBuild, workerBuild, worldBuild], rendererInputs);
