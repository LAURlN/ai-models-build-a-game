import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    provider: undefined,
    model: undefined,
    effort: undefined,
    premise: 'Hold the sunken stone causeway against iron raiders with an ember surge.',
    userDataDir: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--provider' && next) {
      opts.provider = next;
      i++;
    } else if (arg === '--model' && next) {
      opts.model = next;
      i++;
    } else if (arg === '--effort' && next) {
      opts.effort = next;
      i++;
    } else if (arg === '--premise' && next) {
      opts.premise = next;
      i++;
    } else if (arg === '--user-data-dir' && next) {
      opts.userDataDir = path.resolve(next);
      i++;
    }
  }
  return opts;
}

const args = parseArgs(process.argv.slice(2));
const sidecarEntry = path.join(rootDir, 'dist/sidecar/bin.mjs');
if (!existsSync(sidecarEntry)) {
  console.error('Missing dist/sidecar/bin.mjs. Run `npm run build` first.');
  process.exit(1);
}

const tempDir = mkdtempSync(path.join(tmpdir(), 'chronicle-smoke-live-'));
const libOut = path.join(tempDir, 'smoke-lib.cjs');

buildSync({
  stdin: {
    contents: `
      export { T3SidecarManager } from ${JSON.stringify(path.join(rootDir, 'src/main/t3Sidecar.ts'))};
      export { SaveStore } from ${JSON.stringify(path.join(rootDir, 'src/main/saveStore.ts'))};
      export { CHAPTER_PLAN_JSON_SCHEMA, validateChapterPlan } from ${JSON.stringify(path.join(rootDir, 'src/rules/campaign.ts'))};
    `,
    resolveDir: rootDir,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['node:*', 'electron'],
  outfile: libOut,
});

const req = createRequire(import.meta.url);
const { T3SidecarManager, SaveStore, CHAPTER_PLAN_JSON_SCHEMA, validateChapterPlan } = req(libOut);

let provider = args.provider ?? 'codex';
let model = args.model ?? 'gpt-6.1-terra';
let effort = args.effort ?? 'low';

if (args.userDataDir) {
  const dbPath = path.join(args.userDataDir, 'saves.sqlite');
  if (existsSync(dbPath)) {
    const store = new SaveStore(dbPath);
    try {
      const saved = store.getProviderSettings();
      if (!args.provider) provider = saved.architect.providerId;
      if (!args.model) model = saved.architect.model;
      if (!args.effort && saved.architect.effort) effort = saved.architect.effort;
    } finally {
      store.close();
    }
  }
}

const t0 = Date.now();
const sidecar = new T3SidecarManager({
  baseDir: path.join(tempDir, 't3-home'),
  fakeMode: false,
});

try {
  const status = await sidecar.ensureStarted();
  const tBoot = Date.now() - t0;
  const providers = await sidecar.refreshProviders();
  const target = providers.find((p) => p.instanceId === provider);
  if (!target) {
    throw new Error(`Provider '${provider}' not found. Available: ${providers.map((p) => p.instanceId).join(', ')}`);
  }
  if (target.authStatus !== 'authenticated') {
    throw new Error(`Provider '${provider}' is not authenticated (${target.authStatus}: ${target.authLabel}).`);
  }

  const tGenStart = Date.now();
  const prompt = [
    'You are the Campaign Architect for Chronicle Tactics, a turn-based tactical grid RPG.',
    'Design a compact, thematic tactical chapter plan from the player premise below.',
    'Choose one of the 4 map archetypes: bridge_assault, fortress_siege, forest_ambush, twin_path_escort.',
    'Choose objective: "rout" or "seize".',
    'Include 5 to 8 units total (2 to 4 faction="player", 2 to 4 faction="enemy"), with balanced stats and at least 1 player unit having grantActiveAbility=true.',
    '',
    `Premise: ${args.premise}`,
  ].join('\n');

  const res = await sidecar.gameGenerate({
    attemptId: `smoke-live-${Date.now()}`,
    prompt,
    jsonSchema: CHAPTER_PLAN_JSON_SCHEMA,
    modelSelection: {
      providerId: target.instanceId,
      model,
      ...(effort ? { effort } : {}),
    },
    role: 'architect',
    timeoutMs: 90_000,
  });
  const tGenMs = Date.now() - tGenStart;

  const validated = validateChapterPlan(res.output);
  if (!validated.ok) {
    throw new Error(`Live output failed deterministic validation: ${validated.errors.join('; ')}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        sidecarPid: status.pid,
        provider: res.provider,
        model: res.model,
        effort,
        timingsMs: { boot: tBoot, generate: tGenMs, total: Date.now() - t0 },
        plan: {
          title: validated.plan.title,
          archetype: validated.plan.archetype,
          objective: validated.plan.objective,
          maxTurns: validated.plan.maxTurns,
          units: validated.plan.units.length,
        },
      },
      null,
      2,
    ),
  );
} finally {
  sidecar.dispose();
  await new Promise((r) => setTimeout(r, 250));
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 80 });
  } catch {
    // ignore transient Windows handle cleanup delay
  }
}
