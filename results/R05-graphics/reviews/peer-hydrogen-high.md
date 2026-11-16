# R05 Blind Engineering Peer Review

## Scores

| Impl | Correctness | Completeness | Evidence Rigor | Instruction Following | Usefulness | Total |
|---|---:|---:|---:|---:|---:|---:|
| **A** | 5 | 5 | 4 | 5 | 5 | **24** |
| **B** | 3 | 5 | 5 | 5 | 4 | **22** |
| **E** | 3 | 4 | 4 | 5 | 3 | **19** |
| **D** | 3 | 5 | 3 | 5 | 3 | **19** |
| **C** | 2 | 2 | 2 | 4 | 2 | **12** |

**Ranking:** `A > B > E > D > C`

## Implementation Reviews

**A** has the strongest architecture, cleanly separating pure presentation specs (`src/presentation/*`) from Pixi (`BoardScene.ts`, `drawShapes.ts`) and SVG (`UnitPortrait.tsx`). It adds only three read-only path/threat helpers to `src/rules/battle.ts`, scales dynamically to any `boardWidth`/`boardHeight` via `ResizeObserver` and `pointToCell`, caches terrain in an LRU offscreen canvas (`GROUND_CACHE`), and runs an on-demand `requestAnimationFrame` loop (0 fps idle under reduced motion). All screens are complete, local OFL fonts (`Cinzel`, `Alegreya Sans`) include licences, and tests cover 295 lines of unit specs plus `e2e/visual.e2e.ts` compositor checks; only runtime FPS measurement is missing.

**B** cleanly extracts deterministic art/path/cue helpers into `src/renderer/presentation.ts` and implements all screens including a dedicated Briefing tab, SVG portraits/plate (`AtlasArt.tsx`), OS/override reduced-motion persistence, and 960x720/1920x1080 overflow checks. Its `e2e/battle.e2e.ts` adds a real 65-frame 1920x1080 compositor cadence check (`median < 34ms`) alongside strong unit tests (`combatCues`, `cellFromPointer`, `visualPath`). Weaknesses are a fixed 640x640 (`TILE_SIZE * 10`) canvas clipping non-10x10 generated boards, recreating all unit containers on every `state` change, an always-on ticker, and minor UI error-handling slips.

**E** shares the "Brass Atlas" structure and `terrainKey` caching while adding operational hardening: `gameHost.ts`/`t3Sidecar.ts` timeouts, `backgroundThrottling` adjustment in `main/index.ts`, `scripts/check-start.mjs`, `docs/R05_VERIFICATION.md`, and a 90-frame E2E cadence probe. However, it omits a dedicated Briefing screen (`e2e/battle.e2e.ts` captures Campaign preview as `briefing.png`), hardcodes 10x10 geometry and `0..9` cursor bounds, rebuilds all unit containers on any snapshot change, runs a permanent 60 fps ticker, and has a thinner 56-line unit test file.

**D** builds a feature-rich presentation layer (`src/shared/visuals.ts`, `boardTextures.ts`, Web Audio `soundEffects.ts`, `PortraitMedallion.tsx`, `BriefingScreen.tsx`, `MainMenuScreen.tsx`, `EpitaphModal.tsx`, `SettingsModal.tsx`) with 113 lines of unit tests and a 7-screen E2E tour. Engineering lags visual scope: `PixiBoard.tsx` (1,472 lines) destroys and rebuilds the entire terrain layer, a new parchment `Sprite`, and every unit token on every hover (`syncUnitsAndBoard`), runs a continuous ticker, hardcodes 10x10 in the board, minimap, and cursor clamping, and calls React setters inside `setPlayback`'s updater.

**C** takes a minimal approach (`visuals.ts` 11 lines, `motion.ts` 33 lines) crammed into `PixiBoard.tsx` (668 lines) and `App.tsx` (872 lines). It omits a Briefing screen (screenshotting Campaign as `briefing.png`), offers only a reduced-motion checkbox, leaves `README.md` titled `R04`, and has only 22 lines of unit tests. `renderBoardScene` rebuilds all terrain, labels, and units on every hover, `ghost:` sprites leak across re-renders, a permanent `requestAnimationFrame` loop spins when idle/reduced, and 10x10 bounds are hardcoded.

## Concrete Defects

- **A**
  - `A/game/src/renderer/board/BoardScene.ts:214-217,1148,1252-1254`: Toggling `reduced` while idle skips `stepAmbient()`, leaving sway `skew.x`, `hpPreview.alpha`, and `flag` unreset (`targetG.alpha = 1` unreachable).
  - `A/game/src/presentation/beats.ts:36-40,73-74`: Matches attack logs by `unit.name` (ambiguous if units share names).
  - `A/game/src/renderer/components/PixiBoard.tsx:157,178-180`: Resize effect omits `[cols, rows]`.
  - `A/game/src/renderer/styles.css:3-9`: Root-relative `url('/fonts/...')` despite Vite `base: './'`.
- **B**
  - `B/game/src/renderer/components/PixiBoard.tsx:9,239,272`: Hardcodes `BOARD_PIXEL_SIZE = 640`, clipping non-10x10 maps while `cellFromPointer` (`:249`) uses `boardWidth`/`boardHeight`.
  - `B/game/src/renderer/components/PixiBoard.tsx:207-214,241,256-289`: Recreates all units on any `state` change; ticker runs and clears `impact`/moves `ambient` under `reduced`; invalid Pixi v8 `'canvas'` fallback.
  - `B/game/src/renderer/components/PixiBoard.tsx:182-187`: Threat preview omits `attackFringe` from reachable tiles.
  - `B/game/src/renderer/App.tsx:50-59,257-259`: Hover forecast failure triggers sticky `setError`; status badge hides HP loss (`'Status expiry'`).
- **E**
  - `E/game/src/renderer/components/PixiBoard.tsx:8,248,251,255,257`: Hardcodes 10x10 canvas and `* 10` hit-testing; invalid `'canvas'` fallback.
  - `E/game/src/renderer/components/PixiBoard.tsx:184-185,215-217,263-280`: Rebuilds all units on snapshot changes; matches attack logs by `unit.name`; continuous ticker when idle/reduced.
  - `E/game/src/renderer/App.tsx:18,77,165,198-204,303-305,364-365`: No Briefing tab (`e2e/battle.e2e.ts:477` shoots Campaign); `!==` ordinal check; `setFloatingBadges` inside `setPlayback` updater; hover `setError`; cursor clamped to `9`; status badge hides HP loss.
- **D**
  - `D/game/src/renderer/components/PixiBoard.tsx:15-16,386-387,917,1043,1059,1082,1164,1428-1430`: Hardcodes 10x10 canvas/clicks; rebuilds terrain, parchment sprite, and all units on every hover; permanent 60 fps ticker; invalid `'canvas'` fallback.
  - `D/game/src/renderer/components/BriefingScreen.tsx:46-54`: Minimap hardcodes 10x10 (`x * 10`, `viewBox="0 0 100 100"`).
  - `D/game/src/renderer/App.tsx:123,154-155,342-355,456-458,522-523`: Cursor clamped to `9`; hover `setError`; name-based log parsing; `setState` inside `setPlayback` updater; status badge hides HP loss.
  - `D/game/src/renderer/art/soundEffects.ts:19-60`: `AudioContext` is never closed.
- **C**
  - `C/game/src/renderer/components/PixiBoard.tsx:59-62,481-505,526,541-542,648-665`: Hardcodes 10x10 board/clicks; rebuilds terrain, labels, and units on every hover; invalid `'canvas'` fallback.
  - `C/game/src/renderer/components/PixiBoard.tsx:563-602,658-663`: Duplicate `ghost:${id}` sprites leak when `ghostsRef.delete(id)` runs; `requestAnimationFrame` spins permanently.
  - `C/game/src/renderer/App.tsx:19,80,153-169,306,366-367` & `C/game/README.md:1`: No Briefing tab (`e2e/battle.e2e.ts:459` shoots Campaign); `!==` ordinal check; hover `setError`; cursor clamped to `9`; status badge hides HP loss; `README.md` says `R04`.

## Recommendation

Adopt **A** as the next base: it alone has true dynamic board sizing, offscreen terrain caching, an on-demand 0-fps-idle render loop, bundled OFL fonts, and clean Pixi/SVG separation. Fix `stepAmbient()` reset, `[cols, rows]` resize tracking, and relative font URLs, then port:
1. **From B & E:** 1920x1080 E2E cadence check (`B/game/e2e/battle.e2e.ts:548-559`), `scripts/check-start.mjs`, `dist/` junction preservation (`scripts/build.mjs`), and `E`'s main-process SQLite timeouts (`gameHost.ts`, `t3Sidecar.ts`).
2. **From D:** Optional Web Audio SFX (`soundEffects.ts`, adding cleanup) and weapon-triangle pips on targets.

## Authorship Guess

- **A — Claude Opus 5.5 (85%)**: Clean `src/presentation/` architecture, bundled OFL fonts with licences, demand-driven `BoardScene`, and `e2e/visual.e2e.ts`.
- **B — GPT-6.1 Sol (xhigh effort) (60%)**: "Brass Atlas" sibling to `E`, adding Briefing tab, `cellFromPointer`/`combatCues` tests, and asserted 1920x1080 cadence.
- **E — GPT-6.1 Sol (high effort) (60%)**: "Brass Atlas" sibling with `check-start.mjs`, `R05_VERIFICATION.md`, and worker timeouts, but dense inline TS and missed Briefing tab.
- **D — Gemini 4 Hydrogen (55%)**: Modular React screens (`MainMenuScreen`, `BriefingScreen`, `SettingsModal`, `EpitaphModal`), procedural textures, and Web Audio SFX, missing 10x10 scaling/hover-cache checks. Likely my own work (moderate confidence).
- **C — GPT-6.1 Terra (80%)**: Minimal 11-line/33-line helpers, stripped-down Settings/Briefing, and 22-line test suite.
