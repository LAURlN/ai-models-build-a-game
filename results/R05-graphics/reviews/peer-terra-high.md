# R05 engineering review

Static review only: the copies omit screenshots and build outputs, and the brief forbids execution. Screenshot files committed, script results, live-generation history, and measured GPU performance cannot be independently verified here. Scores reflect source evidence, not visual taste.

| Implementation | Correctness | Completeness | Evidence rigor | Instruction following | Usefulness |
|---|---:|---:|---:|---:|---:|
| A | 4 | 5 | 5 | 5 | 5 |
| B | 3 | 4 | 4 | 5 | 4 |
| C | 2 | 3 | 2 | 4 | 3 |
| D | 3 | 4 | 3 | 5 | 4 |
| E | 3 | 4 | 4 | 5 | 4 |

**A.** Strong separation of seeded recipes, command-derived beats, scene and settings; board sizing and hit testing use actual dimensions. Tests cover mapping, determinism, motion and click scaling, and the tour uses Electron capture. The 32-pixel minimum cell size can make a large board exceed a small stage and become clipped instead of fitting (A/game/src/renderer/components/PixiBoard.tsx:58; A/game/src/renderer/styles.css:51). The render loop still schedules a frame every refresh even when idle or hidden (A/game/src/renderer/board/BoardScene.ts:1141); no hardware frame-budget measurement was found.

**B.** Cached terrain, independent unit recipes, replay tests and a broad screenshot tour are useful. Board drawing iterates actual dimensions, but the canvas is fixed at ten tiles (B/game/src/renderer/components/PixiBoard.tsx:9,239) while pointer conversion divides the entire canvas by the actual width and height (B/game/src/renderer/presentation.ts:159); non-10×10 boards are clipped or map clicks to the wrong tile. Its frame-cadence smoke test is useful but does not establish the target on a mid-range GPU (B/game/e2e/battle.e2e.ts:549).

**C.** Seeded visual recipes and movement helpers have tests, but the board and pointer bounds are fixed at 10×10 (C/game/src/renderer/components/PixiBoard.tsx:9,481,485), clipping or rejecting cells on larger maps. The screenshot called briefing is captured immediately after generation while still on the campaign tab (C/game/e2e/battle.e2e.ts:455-459); there is no briefing tab in its navigation (C/game/src/renderer/App.tsx:458). The initial OS motion preference is immediately persisted as an override, so subsequent OS changes are ignored (C/game/src/renderer/App.tsx:89-90). The tour checks a motion attribute, not actual travel or click accuracy at multiple scales.

**D.** Extensive procedural terrain, texture caching, token recipes, audio and a real-screen tour make this a useful source of components. Its fixed canvas and pointer bounds exclude non-10×10 cells (D/game/src/renderer/components/PixiBoard.tsx:16,1039-1043). In reduced motion a connected zero-damage exchange is labelled MISS because feedback infers the outcome from total damage (D/game/src/renderer/components/PixiBoard.tsx:1443-1447). Its tour and unit tests are valuable, but no frame-budget measurement was found.

**E.** Retained terrain, state-derived motion and real screenshot tour are maintainable, with determinism and path tests plus a frame-cadence smoke check. The fixed canvas and hard-coded pointer divisor misrepresent non-10×10 boards (E/game/src/renderer/components/PixiBoard.tsx:8,246,257). A new snapshot clears all active movement and reconstructs units (E/game/src/renderer/components/PixiBoard.tsx:184-185), so a subsequent command during travel can truncate an in-flight animation. Attack feedback also parses names out of display messages (E/game/src/renderer/components/PixiBoard.tsx:215-219), making it fragile for duplicate names or message changes.

**Recommendation.** Use A as the next base for its dynamic board, isolated presentation model and stronger tests. Port B's replay/forecast assertions and cadence smoke measurement, D's reusable texture/audio ideas, E's duplicate-snapshot guard and C's lightweight recipe examples where useful. Fix the sizing and feedback defects before integrating. No source inspection can prove that live generation was never run; no runtime asset violation was established.

## Authorship guess

Purely speculative, low-confidence attribution from code style; no identity evidence was sought. A: GPT-6.1 Sol (xhigh), 25%; B: GPT-6.1 Sol (high), 25%; C: Gemini 4 Hydrogen, 25%; D: Claude Opus 5.5, 25%; E: GPT-6.1 Terra, 25%. I cannot determine whether any is my own work; E is only a guess, not a recognition.
