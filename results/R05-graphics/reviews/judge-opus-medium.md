# R05 blind engineering review

Method: I hashed all ~1,140 files in the five trees. 1,081 files are byte-identical in all five. The remaining files are what each implementation changed or added, and I read them against the brief and SPEC §1/§6. Nothing was installed or run, so none of the scores rely on scripts passing; the orchestrator checks those. Aesthetics are not scored.

## Scores

| Impl | correctness | completeness | evidence_rigor | instruction_following | usefulness | total |
|---|---|---|---|---|---|---|
| **A** | 4 | 5 | 4 | 5 | 5 | **23** |
| **E** | 4 | 4 | 5 | 4 | 4 | **21** |
| **B** | 4 | 4 | 4 | 5 | 3 | **20** |
| **D** | 3 | 5 | 3 | 5 | 3 | **19** |
| **C** | 3 | 2 | 2 | 4 | 2 | **13** |

Ranking: **A > E > B > D > C**

## Per-implementation assessment

**A.** This is the most deliberately engineered version.
- **Structure:** Rendering logic lives in a separate, pure `src/presentation/` layer: seeded RNG and value noise, palette, a `Shape[]` vocabulary, unit recipes, terrain planning, animation beats and overlays. Pixi draws the board from it (`board/BoardScene.ts`, `drawShapes.ts`) and SVG draws portraits and cards from the same `Shape[]` (`UnitPortrait.tsx`), so the board and the panels cannot drift apart.
- **Rendering:**
  - `BoardScene` keeps scene objects alive between frames instead of rebuilding them.
  - It renders on demand: full rate only while something animates, about 30 fps for ambient motion, and nothing when idle or under reduced motion.
  - The ground layer is cached as a canvas.
  - The renderer is resized to the real display size and the world is scaled, so the board stays crisp at any window size and works for non-10×10 boards.
- **Correctness:** Paths, threat tiles and attack fringes come from new exported kernel helpers (`computeMovePath`, `computeStrikeTiles`), not a re-implemented search, so the hover path always matches the move. Animation beats are derived from committed state and enemy traces only. Rewinds, loads and restarts snap without animating.
- **Settings and assets:** Reduced motion has System/Reduced/Full options and collapses all timelines. Two OFL fonts are bundled with their licence files.
- **Evidence:** About 20 presentation unit tests cover determinism, class distinctness, faction silhouettes, kernel-exact paths, pointer-to-cell mapping, beat/HP agreement, reduced-motion collapse and contrast. A separate visual e2e checks fit and clicks at four window sizes, checks that full and reduced motion give identical state hashes, and takes an 11-shot screenshot tour.
- **Weaknesses:** It edits kernel code (`src/rules/battle.ts`). The change refactors `computeFactionThreatTiles` and appears behaviour-preserving, but it still touches the rules file. There is no performance measurement.

**B.** A compact, competent pass with a pure helper module (`presentation.ts`).
- **What's good:**
  - Faction is encoded by shape (shield vs diamond), class by mantle/crest, weapon by silhouette.
  - Pointer mapping is a tested function.
  - Combat cues are suppressed on rewind and load.
  - Reduced motion has System/Reduced/Full options.
  - Eleven screenshots, including 960 and 1080 layouts.
  - An e2e test samples frame cadence at 1920×1080 with a median guard.
- **Weaknesses:**
  - It re-implements kernel pathfinding instead of reusing it.
  - Its hit, miss and crit cues come from parsing log strings and matching unit names.
  - It destroys and rebuilds every token, including `Text` objects, on every snapshot.
  - It hard-codes a 10×10 board, a 640 px backbuffer scaled by CSS, and a 640 px ambient wrap.
  - The board code is written in dense, minified-style one-liners that will be hard to extend.

**C.** A minimal reskin.
- **What's there:** Tokens have a hashed crest and a weapon tick. Moves are tweened along a path that mirrors the kernel's search. There is a fade-out ghost on defeat, a reduced-motion checkbox and a seven-shot screenshot test.
- **What's missing:** No attack, hit or crit animation beyond a 220 ms shake under a static badge; no phase banner; no briefing or settings screen beyond a single checkbox. `ART_DIRECTION.md` is 8 lines.
- **Performance:** The whole scene, including terrain and every `Text`, is torn down and rebuilt on every hover.
- **Scaling:** The canvas has a fixed 560 px CSS size and does not grow with the window.
- **Defects:** A mojibake status label ships, and Turnwheel rewinds play movement animations.
- **Evidence:** Two trivial unit tests.

**D.** The largest and most feature-rich version.
- **Features:**
  - Recipe library in `shared/visuals.ts` (archetypes, headgear, armour, cloaks, emblems).
  - 360-line SVG medallion portraits.
  - Synthesized Web Audio sound effects.
  - Weapon-specific strike effects with particles, hit-stop and shake.
  - Cached canvas textures.
  - Dedicated main menu, briefing, epitaph and settings components.
  - Screenshot test covers 7 screens, including victory.
- **Engineering weaknesses:**
  - Every cursor move re-renders the terrain layer and destroys and rebuilds every unit token.
  - A defeated unit is removed in the snapshot sync before its scheduled strike plays, so the defeat appears before the hit.
  - Side effects (sounds, timers, setState) run inside a `setSnapshot` updater, which is impure.
  - Kernel logic (weapon advantage, display stats) is duplicated instead of imported.
  - The unit recipe is keyed on battle seed and weapon name, so a unit's look changes between chapters and when its weapon changes. This breaks the spec's persistent-identity rule.
  - The canvas is a 560 px backbuffer stretched up to 740 px by CSS, so it is upscaled and blurred.
  - The reduced-motion e2e only toggles the setting; it never checks that motion is actually removed.
  - No performance measurement.

**E.** B's footprint, written more cleanly.
- **Rendering:** The terrain cache is keyed on seed and terrain; hover redraws only highlights; tokens are rebuilt only when the snapshot changes. There is one capped ticker, and seeded recipes are kept separate for identity (skin/hair) and class (helm/mantle/crest/trim).
- **Evidence (the strongest of the five):**
  - Unit tests prove `visualPath` matches the kernel for every reachable tile and that recipes do not mutate the state hash.
  - E2E checks the OS reduced-motion preference, the explicit override and its persistence, that motion is observed in full mode, and that the hash is identical with full vs reduced motion.
  - It checks layout at 960, 1280 and 1920 widths with keyboard input, takes a 10-screen gallery and measures frame cadence (median 16.7 ms).
  - It adds a verification note and a `check-start` script.
- **Weaknesses:**
  - It went outside the round's scope into sidecar and worker timeouts: worker requests 5 s → 60 s, sidecar startup 20 s → 120 s, plus generation test timeouts.
  - It parses log strings for combat feedback.
  - Board size and tile size are hard-coded.

## Concrete defects

### A
- `src/rules/battle.ts:126-147`: the kernel's `computeFactionThreatTiles` was refactored into `collectThreatTiles` to serve presentation. It looks equivalent, but it is a rules-file change in a presentation-only round. The presentation helpers should live in a separate module that imports `reachable`.
- `src/renderer/App.tsx:418-430`: the phase-banner effect depends on `visualState`, so each enemy-playback step clears the hide timer. The `phaseSig === last` early return then never re-arms it, so `banner` stays mounted until the next phase change. The CSS `animation ... both` hides it visually, so the impact is cosmetic.
- `src/presentation/beats.ts:33-35`: strikes and HP losses are recovered by regex over log messages. Any change to the log text silently drops animations. Typed event payloads would be safer.
- `src/renderer/board/BoardScene.ts:139`: `GROUND_CACHE` is an unbounded module-level map of full-board canvases; it grows with every chapter, seed and size.
- `src/presentation/unitVisual.ts:107`: the class look (`classKey`) includes the weapon, and a class change replaces everything except skin and hair. SPEC §6 says "identity silhouettes persist across class changes", so this is only partly met.
- No frame-time or performance measurement anywhere.

### B
- `src/renderer/presentation.ts:84-105`: `visualPath` duplicates the kernel's Dijkstra (`rules/battle.ts:70`). If the kernel changes, hover and travel paths can disagree with the real move.
- `src/renderer/presentation.ts:132-135, 154`: combat cues come from `startsWith("${name} → ")` and `' crit;'` string matching. Duplicate unit names can pick the wrong actor. The ability label falls back to the hard-coded `'Borrowed Second'`.
- `src/renderer/components/PixiBoard.tsx:207-220`: every token, including a new `Text`, is destroyed and rebuilt on each snapshot. During enemy playback that happens for every step.
- `src/renderer/components/PixiBoard.tsx:9, 287`: the 10×10 board and the 640 px ambient wrap are hard-coded, and the canvas is a fixed backbuffer stretched by CSS (`:246`).
- `src/renderer/components/PixiBoard.tsx:279, 283`: `[...models.values()].find` runs per effect, every frame, allocating each time.
- `src/renderer/components/PixiBoard.tsx:153`: `JSON.stringify(s.terrain)` runs on every refresh, including every hover, just to check the cache.

### C
- `src/renderer/components/PixiBoard.tsx:409`: the status label ships as mojibake (`DBTÃ—`).
- `src/renderer/components/PixiBoard.tsx:59-62, 632-665`: every prop change, including each hover, destroys and redraws terrain, labels, highlights and all tokens.
- `src/renderer/components/PixiBoard.tsx:541-542`: the canvas CSS size is fixed at 560 px, so the board does not grow on large windows and only shrinks via `max-width`. Bounds are hard-coded to 10 at `:485, :503`.
- `src/renderer/components/PixiBoard.tsx:632-645`: there is no ordinal or chapter guard, so Turnwheel rewinds and loads animate units travelling backwards.
- `src/renderer/motion.ts:33`: when no path is found, the fallback is `[unit.pos, to]`, a straight line that can pass through walls.
- `src/renderer/App.tsx:89-90`: the preference is written to storage on first mount, so after the first launch the OS reduced-motion setting is never followed again.
- No attack, hit, crit or defeat feedback beyond a badge and a small shake (`:583-595`), and no phase-change cue.
- `tests/visuals.test.ts`: two shallow tests. There is no click-accuracy test at other sizes and no performance measurement.

### D
- `src/renderer/components/PixiBoard.tsx:1428-1430` (with `:387`): `syncUnitsAndBoard` runs on every cursor change and rebuilds the terrain Graphics (100× `deriveTerrainTileVisual`), the parchment sprite and every unit token each time.
- `src/renderer/components/PixiBoard.tsx:934-950` vs `:1432+`: dead units are destroyed, with an ember burst, during the snapshot sync. The `combatEvent` strikes are scheduled afterwards, so the slash, damage number and flash play on an empty tile after the unit has already vanished.
- `src/renderer/App.tsx:258-330`: sounds, `setTimeout` (`triggerPhaseBanner`, `pushBadge`), `setFloatingBadges` and `setPlayback` run inside the `setSnapshot` updater. That is impure (StrictMode double-fires it in dev), and `:337-346` reads a stale `snapshot` closure inside another updater.
- `src/shared/visuals.ts:134`: the recipe seed includes `battleSeed` and `weapon.name`, so the same unit looks different in every chapter and after a weapon swap. This breaks SPEC §6 persistent identity.
- `src/shared/visuals.ts:360-380`: weapon advantage and display stats re-implement the kernel's `advantage` and `attackSpeed`, which are already exported at `rules/battle.ts:155-158`.
- `src/renderer/styles.css:400-401`: the 560 px backbuffer is CSS-scaled up to 740 px without raising `resolution`, so the board blurs on large windows. Bounds are hard-coded to 10 at `PixiBoard.tsx:1043, 1059`.
- `src/renderer/components/PixiBoard.tsx:928`: the chapter reset is detected only at `commandOrdinal === 0`, so Turnwheel rewinds play reverse travel animations.
- `src/renderer/components/PixiBoard.tsx:1438-1446`: the reduced-motion summary shows only the first actor's damage, so a counter-attack's damage is lost.
- `e2e/battle.e2e.ts:446-465`: the reduced-motion test only toggles attributes; it never checks that motion is absent or that resolution is unchanged. No performance measurement.

### E
- `src/main/gameHost.ts:41-45`, `src/main/t3Sidecar.ts:334, 362`, `tests/m4-m5.test.ts:76-243`: worker and sidecar watchdogs were raised from 5 s to 60 s and from 20 s to 120 s. Generation and provider infrastructure is outside a graphics round, and the longer timeouts can hide real hangs.
- `src/renderer/components/PixiBoard.tsx:206, 216-217`: crit, miss and the sweep's actor/target are recovered from log text by unit name, which is ambiguous when names collide.
- `src/renderer/presentation.ts:47-67`: `visualPath` duplicates the kernel search. It is well tested against the kernel, but it is still a second implementation.
- `src/renderer/components/PixiBoard.tsx:124, 257`: tile size 64 and board size 10 are hard-coded in the highlight and hit-test code, and the canvas is a CSS-scaled fixed backbuffer (`:251`).
- `src/renderer/components/PixiBoard.tsx:270`: a dying token stays in the scene at alpha 0 until the next snapshot. That is harmless, but it is a leak-shaped pattern.

## Recommendation for the next base

**Use A as the next base.** It has the right architecture:
- pure, tested presentation modules that both Pixi and SVG consume;
- one retained-mode, on-demand `BoardScene`;
- kernel-exact paths and threat tiles;
- beat timelines derived only from committed state;
- resolution-correct scaling for any board size.

Before building on it, move A's three helpers out of `rules/battle.ts` into a `presentation/kernelQueries.ts` that imports the kernel (or get them reviewed as kernel API). Also make `GROUND_CACHE` an LRU.

Worth porting from the others:
- **E:** the reduced-motion e2e (OS preference + override + persistence + motion actually observed + identical hash), the window-size/keyboard e2e, the frame-cadence probe, and the verification-note habit. Leave out the timeout changes.
- **B:** the shield/diamond faction grammar, the movement-region outline plus hatched danger and range diamonds, the rewind/load suppression checks, and the cadence guard at 1920×1080.
- **D:**
  - the synthesized SFX module (`art/soundEffects.ts`), behind A's settings;
  - weapon-specific strike effects (arrow, rune ring, slash arc) and the cached glow-texture particle approach;
  - dedicated briefing and epitaph components with the SVG minimap.

  Port these only after fixing the defeat-ordering and identity-seed bugs.
- **All:** replace log-string parsing (A, B, D, E all do it) with typed strike/effect payloads on committed events, so presentation never depends on log wording.
