// Verify the actual npm start command, then close exactly the process tree it starts.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';

const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const label = executable ? 'packaged executable' : 'npm start';
if (!executable && !existsSync(npm)) throw new Error('Run this check with the Node/npm installation used for npm start.');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const temporaryRoot = realpathSync(tmpdir());
const profile = mkdtempSync(path.join(temporaryRoot, 'chronicle-start-'));
const env = { ...process.env, CHRONICLE_FAKE_PROVIDER: '1', CHRONICLE_HEADLESS: '1', npm_config_update_notifier: 'false' };
delete env.ELECTRON_RUN_AS_NODE;
if (executable && process.platform === 'win32') {
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = `${process.env.SystemRoot};${process.env.SystemRoot}\\System32`;
}
const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`];
const child = spawn(executable ?? process.execPath, executable ? args : [npm, 'start', '--', ...args], {
  cwd: executable ? temporaryRoot : path.resolve(import.meta.dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let output = '', browser, sidecarPid;
child.on('error', error => { output += String(error); });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-8000); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const deadline = Date.now() + 180_000;
  let endpoint;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`npm start exited early (${child.exitCode}).\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { endpoint = (await response.json()).webSocketDebuggerUrl; break; }
    } catch { /* The app is still starting. */ }
    await delay(200);
  }
  if (!endpoint) throw new Error(`npm start did not expose its compositor.\n${output}`);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 120_000 });
  await page.getByTestId('main-menu').waitFor({ state: 'visible', timeout: 120_000 });
  if (executable) {
    await page.waitForFunction(async () => (await window.chronicleApi.getSidecarStatus()).connected, null, { timeout: 120_000 });
    const health = await page.evaluate(() => window.chronicleApi.getSidecarStatus());
    sidecarPid = health.pid;
    if (!health.fakeMode || path.resolve(health.baseDir) !== path.join(profile, 't3-home')) throw new Error('Packaged sidecar profile is not isolated.');
    const campaigns = await page.evaluate(() => window.chronicleApi.world.list());
    if (!Array.isArray(campaigns) || campaigns.length) throw new Error('Expected a fresh, working campaign worker.');
    console.log('Packaged native addon, sidecar RPC and SQLite campaign worker passed with no Node/npm/compiler on PATH.');
  }
  await page.close();
  await new Promise((resolve, reject) => {
    if (child.exitCode !== null) return child.exitCode === 0 ? resolve() : reject(new Error(output));
    const timer = setTimeout(() => reject(new Error('npm start did not close after its window closed.')), 20_000);
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(output)); });
  });
  if (sidecarPid) {
    let alive = false;
    try { process.kill(sidecarPid, 0); alive = true; } catch { /* Closed with the app's Job Object. */ }
    if (alive) throw new Error('Packaged sidecar survived application exit.');
    sidecarPid = undefined;
  }
  console.log(`${label}: main menu rendered; app and child processes closed normally (exit 0).`);
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill('SIGTERM');
  }
  if (sidecarPid && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(sidecarPid), '/t', '/f'], { windowsHide: true });
  // Only delete the unique profile created above, within the resolved temp root.
  if (path.dirname(realpathSync(profile)) !== temporaryRoot) throw new Error('Unexpected startup-check profile path.');
  // Chromium/Defender may release profile handles shortly after process exit.
  rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
