# R06 Blind Peer Code Review

## Scores

| Impl | Correctness | Completeness | Evidence Rigor | Instruction Following | Usefulness | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **D** | 5 | 5 | 5 | 5 | 5 | 25 |
| **C** | 4 | 4 | 3 | 4 | 4 | 19 |
| **B** | 3 | 3 | 4 | 4 | 3 | 17 |
| **A** | 2 | 3 | 3 | 3 | 2 | 13 |
| **E** | 2 | 1 | 2 | 2 | 2 | 9 |

**Ranking:** D > C > B > A > E

## Implementation Assessments

**A** builds a compact CJS `node:vm` extension loop with snapshot `reconcile` rollback, Turnwheel/save integration, procedural audio recipes, 60 unit tests, and 15 E2E tests. However, it ran 0 live provider calls and fails real-provider schema validation on OpenAI/Codex while exposing poor board scaling (shrink-to-640px without pan/zoom), static `dangerouslySetInnerHTML` panels without script execution, and unbounded repair recursion.

**B** delivers a SQLite-backed `CampaignCoordinator` and `ExtensionRegistry`, tested with 5 real `gpt-6.1-terra` live runs that caught and fixed strict JSON-schema incompatibilities (`*Json` fields) and verified parallel helper tool use. Its engineering falls short on runtime isolation: `vm.Script` timeouts apply only at module load, hooks mutate live battle state with no rollback, provider failures silently fall back to offline narration, and UI/encounter customization remains rigid.

**C** pairs strong `node:vm` determinism (`Math.random` RNG override, 1000 ms load/hook timeouts, JSON round-trip validation, `reconcile` rollback, `replayCache`) with sandboxed `chronicle://extension/` iframe panels supporting interactive JS, inline SVG unit/terrain Pixi art, `mapZoom`, and Turnwheel unwinding. Its main drawbacks are 0 live runs, a race where `prepareBattle` commits a faulted battle before repairs finish, unbounded revision-based repairs, and O(N log N)/quadratic pathfinding and threat scans.

**D** is a clean, complete engine (`src/engine/`, `src/main/world/`, `src/renderer/world/`) that preserves R05 while delivering everything in R06: dedicated `worldWorker` with a `SharedArrayBuffer` heartbeat watchdog that terminates/quarantines hung modules and recovers from SQLite, typed-array binary-heap pathfinding with pan/zoom, full ES-module hooks (combat, custom AI, mapgen, objectives, non-grid modes, custom DOM panels, Pixi drawers/effects, procedural sound/music), 3 worked examples, 82 unit tests, 17 E2E tests, and 10/10 live `gpt-6.1-terra` runs.

**E** explicitly scopes itself as an incomplete prototype (`README.md:113-115, 153-155`), keeping R05 chapter generation while adding only a polling `StoryPanel`, a 3-hook (`beforeCommand`, `afterCommand`, `action`) `new Function` runner without hook timeouts, minimal `<dl>` state dumps, and `0/10` live runs.

## Concrete Defects

**A**
- `A/game/src/main/campaignDirector.ts:15`: `worldPatch: { type: 'object', additionalProperties: true }` breaks strict Codex/OpenAI `--output-schema`.
- `A/game/sidecar/apps/server/src/textGeneration/CodexTextGeneration.ts:391`: Ignores `input.timeoutMs` (`180000` in `campaignDirector.ts:78`), staying at `CODEX_TIMEOUT_MS`.
- `A/game/src/main/campaignDirector.ts:118,134-139`: `repair()` deduplicates by `moduleId@version` while `helper()` bumps `version`, allowing unbounded repair loops.
- `A/game/src/main/campaignDirector.ts:145-147`: `prepareBattle()` deploys dead units from `roster` and ignores `battle.extensionFaults`.
- `A/game/src/main/extensions.ts:33`: Clones and JSON-round-trips the full `BattleState` on every inner-loop hook (`targeting`, `combat`).
- `A/game/src/rules/battle.ts:80`: Dijkstra pops via `Array.sort` + `shift`.
- `A/game/src/renderer/components/ExtensionPanels.tsx:7`: `dangerouslySetInnerHTML` cannot run embedded `<script>` panels.
- `A/game/src/renderer/components/PixiBoard.tsx:95-96,199-203`: Shrinks arbitrary map sizes into 640px with no pan/zoom and only 2 faction shapes.

**B**
- `B/game/src/rules/extensionRuntime.ts:180,470-507,561`: `vm.Script` `{ timeout: 1500 }` guards load only; hooks/actions run with no timeout and mutate live state without rollback.
- `B/game/src/main/campaignCoordinator.ts:703-705`: Silently substitutes `offlineNarratorFallback()` on `!res.ok`, masking real provider errors.
- `B/game/src/renderer/App.tsx:446`: Hardcodes `playCustomEvent('orb_throw')` for every unit-targeted `CUSTOM_ACTION`.
- `B/game/src/main/battleHost.ts:80-85`: `reloadModules()` unconditionally re-runs `onBattleInit` mid-battle.
- `B/game/src/rules/battle.ts:286-301`: `onModifyCombatNumbers` receives mutable live `BattleState`.
- `B/game/src/renderer/components/PixiBoard.tsx:145-156`: `'theater'` mode only draws a static background behind the grid.

**C**
- `C/game/src/main/campaignService.ts:128-130`: `prepareBattle()` invokes `createBattle`/`battleStart` and persists `pendingBattle` without checking faults or awaiting repair jobs queued by `onFault`.
- `C/game/src/main/campaignService.ts:103,173-176`: `repair()` keys on `revision`, which `build()` increments, leaving no retry cap.
- `C/game/src/rules/battle.ts:76,138-156`: `reachable()` calls `queue.sort` + `shift`, and `computeFactionThreatTiles()` runs `reachable` + `visible` across every tile in weapon range per unit.
- `C/game/src/rules/battle.ts:319`: `enemyPhase()` lumps all `faction !== 'player'` units into one group.
- `C/game/docs/LIVE_RUNS.md`: 0 live provider runs executed.

**D**
- `D/game/src/main/world/moduleLoader.ts:55-68`, `D/game/src/main/world/worldHost.ts:145`, `D/game/src/renderer/world/moduleRuntime.ts:40-53`: Quarantined/blocked worker files still emit hashes in `view.moduleFiles`, causing the renderer to dynamic-import and execute `setup(api)` on Chromium's UI thread without a watchdog.
- `D/game/src/main/world/director.ts:154,290-316`: Chat stays unlocked while `pendingBattle.status === 'preparing'`, allowing a subsequent `battle.start` to overwrite an in-flight battle spec.

**E**
- `E/game/src/main/storyCoordinator.ts:72`: Narrator battles still invoke R05's static generator (`coordinator.startGeneration`).
- `E/game/src/main/extensionRuntime.ts:23-24,40-84`: `new Function` executes hooks on the worker with no timeout (despite `extensionValidation.ts:21` validating initial load).
- `E/game/sidecar/apps/server/src/game/CampaignTools.ts:3`, `E/game/sidecar/apps/server/src/game/GameGeneration.ts:68`: `useCampaignTools` excludes the Narrator; `storyCoordinator.ts:60,108` omits `timeoutMs`, hitting the 90s cap.
- `E/game/src/renderer/components/StoryPanel.tsx:13`: Polls `getStory()` every 2 s instead of subscribing to push events.
- `E/game/src/renderer/components/PixiBoard.tsx:254-259`, `E/game/src/rules/battle.ts:139-154`: Fixed 64px canvas without pan/zoom; full-board threat scan.
- `E/game/docs/LIVE_RUNS.md:1-3`: 0 live runs and no `R06_VERIFICATION.md`.

## Recommendation

Adopt **D** as the next base. Its `src/engine/` + `worldWorker`/`worldClient` watchdog + `src/content/EXTENSION_API.md` + 3 working examples + 10/10 live-tested prompts form by far the strongest foundation. Before R07, fix D's two edge cases (`filter` blocked modules out of `view.moduleFiles` before renderer sync, and guard `pendingBattle` against concurrent overwrites). Port two standout ideas from **C**: (1) `replayCache` keyed by `stateHash + command` (`C/game/src/main/battleHost.ts:46-55`) for extra determinism safety, and (2) optional sandboxed `<iframe sandbox="allow-scripts">` extension panels (`C/game/src/renderer/components/ExtensionPanels.tsx:13`) with error-bridge reporting if modules ever need full embedded HTML widgets beyond `ui.h(...)`.

## Authorship Guess

- **A — GPT-6.1 Sol (high effort)** (75% confidence): Identical compressed, whitespace-free single-line TS style to C, stopped earlier with unfixed strict-schema `worldPatch` and 0 live runs.
- **B — GPT-6.1 Terra** (55% confidence): Pragmatic TypeScript (`ExtensionRegistry`, SQLite `CampaignCoordinator`), explicitly wired `AntigravityTextGeneration.ts` alongside Codex/Claude, and ran 5 live `gpt-6.1-terra` calls to catch the strict schema bug.
- **C — GPT-6.1 Sol (xhigh effort)** (80% confidence): Same distinctive terse compressed coding style as A, pushed noticeably further into `chronicle://extension/` iframe CSP, SVG Pixi visuals, `replayCache`, and strict `worldJson` schema.
- **D — Claude (Fable 5.2, finished by Opus 5.5)** (65% confidence): Massive clean greenfield `engine/` + `world/` architecture, `// ----` section dividers, `Loose` alias, consistent British spelling (`serialisable`, `centre`, `defences`, `realises`), SharedArrayBuffer worker watchdog, and 10/10 live runs.
- **E — Gemini 4 Hydrogen** (45% confidence): Small incremental diff with honest self-scoping in `README.md`, American spelling, and minimal 3-hook runtime. Of the five, **E** (or less likely **B**) matches my own model family's profile, though with low certainty.
