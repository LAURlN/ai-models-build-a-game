# Chronicle Tactics — living campaigns (R06)

A Windows 11 tactical RPG where you describe any world and then **play it with a Narrator
AI for as long as you like**. Whatever the story needs — creatures to catch, levels and
skills, crops and wolves, a duel on the System's Battle Net — **helper agents build it as
real game code while you keep talking**, and battles of any size erupt whenever the story
calls for them. Built with strict TypeScript, Electron 45, React 19, PixiJS 8, Node 24
(`node:sqlite`), a Win32 Job Object addon and an isolated headless T3 Code sidecar.

## Commands (from `game/`)

Windows 11 x64, Node.js 24+, npm and an x64 MinGW-w64 C compiler (`gcc` on `PATH`, e.g.
LLVM-MinGW) for the Job Object addon.

```sh
npm ci
npm run typecheck
npm test          # builds first
npm run build
npm run e2e       # Electron + Playwright, fake provider only
npm start
npm run dist:win  # self-contained portable x64 executable in release/
```

The portable release includes Electron, the native Job Object addon, bundled game and
sidecar code, and full third-party licence notices in `resources/licenses/`. It needs no
Node/npm/compiler installation to launch. Live providers still require their provider
CLI and authentication. The unsigned executable may trigger Windows reputation prompts.
To test without touching normal saves, pass `--user-data-dir=<temporary-profile>`.
System fonts are used; no font files are redistributed.

Tests and E2E use the deterministic **scripted fake provider** (`CHRONICLE_FAKE_PROVIDER=1`)
and temporary profiles; they never need a login or run live generations. Set
`CHRONICLE_FAKE_PROVIDER=1` before `npm start` to play the scripted loop offline.

Keep caches and outputs in a local directory (PowerShell):

```powershell
$cacheDir = Join-Path (Get-Location) '.cache'
New-Item -ItemType Directory -Force -Path "$cacheDir\temp" | Out-Null
$env:npm_config_cache = "$cacheDir\npm"; $env:electron_config_cache = "$cacheDir\electron"
$env:PLAYWRIGHT_BROWSERS_PATH = "$cacheDir\playwright"; $env:TEMP = "$cacheDir\temp"; $env:TMP = $env:TEMP
$env:CHRONICLE_TEST_OUTPUT = "$cacheDir\test-output"
```

Live helpers: `npm run smoke:live -- --provider codex --model gpt-6.1-terra --effort low`
(one structured call) and `node scripts/live-story.mjs --setting "…" --say "…" --max-calls 4`
(a capped Narrator/helper session). Both start their own sidecar in a temp `--base-dir`
and never touch `%USERPROFILE%\.t3\`. See [docs/LIVE_RUNS.md](docs/LIVE_RUNS.md).

## The gameplay loop

1. **Campaigns → Begin a living campaign.** Describe a setting (three examples are one
   click away: a creature-catching adventure, a System apocalypse, a cozy farm with wolves).
2. **Chat with the Narrator.** It establishes your character(s), companions, places and
   factions as real world state, and answers anything you say or do. Suggestions are offered,
   free text always works.
3. **Helpers build what the story needs, in the background.** When the fiction introduces
   something the engine does not have, the Narrator spawns helper agents (several in
   parallel). They write content modules into the campaign workspace; the game hot-loads them.
   The **Activity** tab shows what is being built; a small "⚒ building" pill appears in the
   header. Nothing blocks the chat — only a battle that needs unfinished content waits
   ("Preparing — waiting for: …").
4. **Battles start whenever the story demands.** The Narrator writes a battle spec
   (inline or through a helper): any map size, any number of factions and units, any
   objectives, generated templates, weapons and abilities — or a non-grid encounter mode.
   You play it; other factions act in a step-by-step replay (Slow/Normal/Fast, Skip).
5. **The outcome flows back.** Deaths stay dead (campaign rules may change that), captures
   join the roster or a module's storage, loot enters the inventory, module systems fold in
   their results, and the Narrator tells the aftermath. Repeat forever.

Everything is saved continuously in SQLite (`<userData>/campaigns.sqlite`): world state,
the full chat, battle snapshots with Turnwheel history and the activity feed. Quit at any
moment — including mid-battle — and **Continue** resumes exactly. Long campaigns keep the
Narrator consistent with durable **facts** (written by the Narrator, battles and modules),
a **rolling summary** that an archivist pass folds older chat into, lexical **retrieval**
of relevant old facts/chat/battles every turn, and the full transcript in the workspace
for agents to grep.

The original **Brass Ward** battle and the single-chapter **Chapter Forge** (Rule IR,
local fallback) remain available from the menu and tabs.

## The extension API: content is code

A **content module** is an ES module in `modules/` of the campaign workspace
(`<userData>/campaigns/<id>/`). The simulation worker imports it (rules, AI, meta-systems)
and the renderer imports the same file (panels, drawing, effects, sound, mode views).
`setup(api)` registers anything: weapons with free-form kinds and stats, abilities (active,
passive, reactions via hooks, any number per unit), statuses, unit templates, terrain, AI
behaviours, objectives, map generators, matchup tables, whole **encounter modes** (including
non-grid ones), campaign **commands** and **UI panels**, procedural **unit/tile drawing**,
**effects**, **sounds** and **music**. Hooks reach turn flow, movement and its costs,
targeting, combat numbers, strikes, damage, healing, statuses, defeat, AI planning and
scoring, objectives, battle build/resolution and the Narrator's context. The Rule IR-style
declarative `effects` remain for simple cases.

```js
// modules/tide-tables.js
export default {
  id: 'tide-tables',
  name: 'Tide Tables',
  description: 'A tide clock that floods low ground every third round.',
  setup(api) {
    api.defineWeapon({ id: 'ledger-hook', name: 'Ledger Hook', kind: 'hook', range: [1, 2], might: 4,
      attackStat: 'wit', defenseStat: 'poise', description: 'Reach 1–2; drags the target 1 tile.',
      effects: [{ op: 'pull', distance: 1 }] });
    api.defineAbility({
      id: 'read-the-swell', name: 'Read the Swell', target: 'self', cost: { acts: 0 }, usesPerPhase: 1,
      description: 'Free: see when the next flood comes.',
      use(ctx, unit) { ctx.float(unit, `Flood in ${3 - (ctx.round % 3)} round(s)`, 'info'); },
    });
    api.on('round:start', (ev, ctx) => {
      if (ev.round % 3 !== 0) return;
      for (const u of ctx.units((u) => ctx.tile(u.pos).tags.includes('low'))) ctx.applyStatus(u, 'soaked');
      ctx.log('The tide comes in.'); ctx.sound('tide');
    });
    api.defineStatus({ id: 'soaked', name: 'Soaked', duration: 2, mods: { spd: -2 }, tone: 'debuff' });
    api.sound('tide', { voices: [{ wave: 'noise', dur: 1.2, gain: 0.2, attack: 0.4, filter: { type: 'lowpass', freq: 600 } }] });
    api.describe('Weapon ledger-hook, ability read-the-swell; tiles tagged "low" flood every 3rd round.');
  },
};
```

Full reference: [`src/content/EXTENSION_API.md`](src/content/EXTENSION_API.md) (copied into
every workspace as `docs/EXTENSION_API.md`, with three complete example modules in
[`src/content/examples/`](src/content/examples/)).

**No caps.** Unit counts, map size, factions, weapon kinds, stats, abilities per unit and
mechanic counts are unlimited; there is no weapon triangle or class list (matchups are
data from modules). The engine uses typed-array pathfinding and occupancy caches; a 96-unit
battle on a 56×40 map runs a full AI round in well under a second in tests, and the board
camera pans/zooms large maps.

**Determinism, saves and the Turnwheel with generated code.** All state is JSON on the
battle/campaign objects; modules keep theirs in `vars`. Randomness is a counter-based
seeded RNG stored in state (`ctx.rng`). Each command runs as a transaction on a snapshot;
battle history is persisted per command, so the Turnwheel restores exact snapshots
(including module state and RNG position) and identical commands reroll identically.
Charges are never refunded.

**Trust, and keeping the game running.** There are no allow-lists. Validation exists only
to keep playing: if a module fails to parse, throws in `setup`, or throws at runtime, the
command is rolled back, the module is switched off and the command is retried without it;
the error is shown in the chat and a **repair helper is dispatched automatically** with the
error and source (bounded to two attempts, then reported). A deliberate `throw new
Error('…')` from a command or mode command is a player-facing rejection, not a fault.
Generated code runs in a worker thread with a watchdog: an infinite loop is killed, the
module quarantined, the campaign reopened from SQLite and a repair requested.

## Narrator and helper agents

- **Narrator** — one structured turn per player message: narration, suggestions, scene and
  mood, world-state operations, module commands, helper requests, a battle request, durable
  memories and an optional ending. It also runs in the campaign workspace with native tools.
- **Helpers** — background agents with **full native tools** (Codex `danger-full-access`,
  Claude Code full tool set with bypassed permissions) with the campaign workspace as
  their working directory; this is not a filesystem sandbox. They read `chat/transcript.md`, `state/campaign.json`,
  `state/modules.json`, the API doc and examples, write `modules/*.js` and `battles/*.json`,
  and may run `node` to check their work. Up to N run in parallel (default 3).
- **Archivist** — folds older chat into the running summary (falls back to a local
  extractive summary when no model is available).

Prompts ([`src/main/world/prompts.ts`](src/main/world/prompts.ts)) explain the whole API
and explicitly push toward setting-specific systems, resources, objectives and map shapes
rather than generic fantasy archetypes.

**Configure models** in **Providers & Models**: connect providers inside the isolated
sidecar, then choose provider, model and effort for **Narrator** and **Helper agents**
(defaults fall back to the Chronicler and Architect slots), the number of parallel helpers,
and ordered fallbacks. Settings persist in SQLite.

## Sound

Procedural WebAudio only (see [ART_DIRECTION.md](ART_DIRECTION.md#sound)): synthesized UI,
movement, attack/hit/miss/crit, defeat, ability, status, heal and phase cues, victory and
defeat stingers, and adaptive generative music (story, tense, battle, danger, victory,
defeat). Modules add or override cues and themes. **Settings → Sound**: master, music,
effects, mute and calm audio, all persisted.

## Architecture

- `src/engine/` — pure, deterministic engine: battle kernel, AI, grid/pathfinding, map
  generation, registry + extension API, campaign state, memory/retrieval.
- `src/main/world/` — world host (SQLite campaigns, module loader, battle hosting) in a
  worker thread with watchdog; Director (Narrator/helper/archivist orchestration, repair,
  battle staging); prompts.
- `src/renderer/world/` — story and battle screens, Pixi board with camera, renderer-side
  module runtime, panel host; `src/renderer/audio/` — synthesis and adaptive music.
- `sidecar/` — headless T3 Code fork (pinned `e72dd50…`), spawned with `--game-profile`
  inside a Win32 Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) and its own
  `--base-dir <userData>/t3-home`. Patches: [`sidecar/FORK_PATCHES.md`](sidecar/FORK_PATCHES.md).
- The renderer stays sandboxed and context-isolated; generated modules are served to it
  from the workspace via `chronicle://app/ws/<campaign>/modules/…` under the same CSP.

## Screenshots

E2E (fake provider only) writes the gallery in `docs/screenshots/`: main menu, campaign
lobby, story chat, activity feed, Creature Box (generated UI), System interface (generated
UI), generated battle (40×28, 38 units), forecast, other-faction replay, battle end, the
non-grid Battle Net duel, plus the earlier Brass Ward, Chapter Forge, Providers and Settings
screens. Verification details: [docs/R06_VERIFICATION.md](docs/R06_VERIFICATION.md).
