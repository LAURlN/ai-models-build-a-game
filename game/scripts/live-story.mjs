// Live Narrator/helper run through the game's own isolated sidecar (never %USERPROFILE%\.t3).
// Usage: node scripts/live-story.mjs --setting "…" --say "…" [--say "…"] [--model gpt-6.1-terra] [--effort low] [--max-calls 3] [--out ./live-output] [--check-only]
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = { says: [], provider: 'codex', model: 'gpt-6.1-terra', effort: 'low', maxCalls: 3, setting: '', out: '', checkOnly: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const [flag, value] = [argv[i], argv[i + 1]];
  if (flag === '--setting') { args.setting = value; i++; }
  else if (flag === '--say') { args.says.push(value); i++; }
  else if (flag === '--provider') { args.provider = value; i++; }
  else if (flag === '--model') { args.model = value; i++; }
  else if (flag === '--effort') { args.effort = value; i++; }
  else if (flag === '--max-calls') { args.maxCalls = Number(value); i++; }
  else if (flag === '--out') { args.out = path.resolve(value); i++; }
  else if (flag === '--check-only') args.checkOnly = true;
}
if (!existsSync(path.join(rootDir, 'dist/sidecar/bin.mjs'))) { console.error('Run `npm run build` first.'); process.exit(1); }

const work = mkdtempSync(path.join(tmpdir(), 'chronicle-live-'));
const lib = path.join(work, 'live-lib.cjs');
buildSync({
  stdin: {
    contents: `
      export { T3SidecarManager } from ${JSON.stringify(path.join(rootDir, 'src/main/t3Sidecar.ts'))};
      export { WorldHost } from ${JSON.stringify(path.join(rootDir, 'src/main/world/worldHost.ts'))};
      export { localWorldApi } from ${JSON.stringify(path.join(rootDir, 'src/main/world/worldClient.ts'))};
      export { Director } from ${JSON.stringify(path.join(rootDir, 'src/main/world/director.ts'))};
    `,
    resolveDir: rootDir, loader: 'ts',
  },
  bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['node:*', 'electron'], outfile: lib,
});
const { T3SidecarManager, WorldHost, localWorldApi, Director } = createRequire(import.meta.url)(lib);

const out = args.out || path.join(work, 'result');
mkdirSync(out, { recursive: true });
const sidecar = new T3SidecarManager({ baseDir: path.join(work, 't3-home'), fakeMode: false });
const log = [];
const note = (line) => { log.push(line); console.log(line); };
let calls = 0;
const counted = {
  listProviders: () => sidecar.listProviders(),
  async gameGenerate(input) {
    if (calls >= args.maxCalls) throw new Error(`Live call budget (${args.maxCalls}) exhausted.`);
    const n = ++calls;
    const t0 = Date.now();
    note(`[call ${n}] ${input.role} → ${input.modelSelection.providerId}/${input.modelSelection.model} (${input.modelSelection.effort ?? 'default'})${input.agent ? ' [agent tools]' : ''}`);
    try {
      const result = await sidecar.gameGenerate(input);
      note(`[call ${n}] ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return result;
    } catch (error) {
      note(`[call ${n}] failed in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${String(error?.message ?? error).slice(0, 400)}`);
      throw error;
    }
  },
};

try {
  await sidecar.ensureStarted();
  const providers = await sidecar.refreshProviders();
  const target = providers.find((p) => p.instanceId === args.provider);
  note(`Providers: ${providers.map((p) => `${p.instanceId}=${p.authStatus}${p.installed ? '' : ' (not installed)'}`).join(', ')}`);
  if (!target || target.authStatus !== 'authenticated') {
    note(`Provider '${args.provider}' is not authenticated inside the game's isolated sidecar. No live generation possible; nothing was sent.`);
    process.exitCode = 2;
  } else if (!args.checkOnly) {
    const selection = { providerId: args.provider, model: args.model, effort: args.effort };
    const settings = { architect: selection, chronicler: selection, narrator: selection, helper: selection, fallbacks: [], helperConcurrency: 2 };
    const host = new WorldHost({ dbPath: path.join(out, 'campaigns.sqlite'), workspacesDir: path.join(out, 'campaigns'), contentDir: path.join(rootDir, 'src/content'), aiDelayMs: 5 });
    const world = localWorldApi(host);
    const director = new Director(world, counted, () => settings, path.join(rootDir, 'src/content'));
    director.subscribe((s) => { const last = s.tasks.at(-1); if (last) note(`  task: [${last.kind}] ${last.title} — ${last.status}${last.error ? ` (${last.error.slice(0, 200)})` : ''}`); });
    const t0 = Date.now();
    await director.create(args.setting);
    await director.whenIdle();
    for (const message of args.says) {
      if (calls >= args.maxCalls) break;
      await director.say(message);
      await director.whenIdle();
    }
    const view = await world.view();
    note(`Elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s, ${calls} model call(s).`);
    note(`Roster: ${view.campaign.roster.map((r) => `${r.name} (${Object.keys(r.stats).join('/')})`).join('; ')}`);
    note(`Modules: ${view.modules.map((m) => `${m.id}:${m.status}${m.error ? ` [${m.error.split('\n')[0]}]` : ''} provides ${Object.entries(m.provides).map(([k, v]) => `${v.length} ${k}`).join(', ')}`).join(' | ') || 'none'}`);
    note(`Battle: ${view.battle ? `${view.battle.state.title} ${view.battle.state.map.width}x${view.battle.state.map.height}, ${view.battle.state.units.length} units` : view.campaign.pendingBattle ? `pending (${view.campaign.pendingBattle.status})` : 'none'}`);
    writeFileSync(path.join(out, 'transcript.json'), JSON.stringify(view.chat, null, 2));
    writeFileSync(path.join(out, 'status.json'), JSON.stringify(director.status(), null, 2));
    director.dispose(); host.dispose();
  }
} catch (error) {
  note(`Live run error: ${error?.stack ?? error}`);
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(out, 'live-log.txt'), log.join('\n'));
  sidecar.dispose();
  console.log(`Output: ${out}`);
}
