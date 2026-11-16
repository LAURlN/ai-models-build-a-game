# R02 Blind Peer Code Review (Engineering)

## Score Table & Ranking

| Impl | Correctness | Completeness | Evidence Rigor | Instruction Following | Usefulness | Total |
|---|---:|---:|---:|---:|---:|---:|
| **B** | 5 | 5 | 5 | 4 | 5 | 24 |
| **C** | 4 | 5 | 4 | 4 | 4 | 21 |
| **A** | 3 | 4 | 2 | 3 | 2 | 14 |

**Ranking (best first):** **B > C > A**

---

## Implementation A (`A/game`)

**Strengths:**
- Runs authoritative battle state in a `worker_threads` worker (`A/game/electron/worker.ts:1-4`) with Electron sandbox/context isolation (`A/game/electron/main.ts:26-28`).
- Concise pure kernel (`A/game/src/rules.ts:1-54`) and Electron E2E covering all four endings (`A/game/tests/battle.e2e.ts:8-11`).

**Weaknesses:**
- Code-golfed layout (`A/game/src/main.tsx:1-18`) with hardcoded single-unit fields (`ally`/`enemy`), no `Result` wrapper, and no `effect` Schema (`SPEC.md` §6).
- Minimal test suite (`A/game/tests/rules.test.ts:1-11`, `A/game/tests/battle.e2e.ts:1-12`) skips occupied-tile blocking, out-of-bounds moves, immutability checks, and Electron security assertions.

**Bugs:**
- `A/game/src/main.tsx:9-12`: `useEffect` destroys and recreates the Pixi `Application` (and WebGL context) on every `state` update.
- `A/game/src/rules.ts:3,38-52`: `phase: 'enemy'` is unreachable dead state (`endPhase` runs AI synchronously).
- `A/game/src/rules.ts:26-54` & `A/game/src/main.tsx:15`: `applyCommand` returns raw `State` without rejection status, and `send` gives no UI feedback if IPC throws.
- `A/game/electron/main.ts:8-9,21`: `pending` worker callbacks lack timeout or worker `error`/`exit` rejection handling.
- `A/game/src/main.tsx:4,17`: renderer imports `canMove`/`distance` from `./rules`, hardcodes `"PLAYER PHASE"`, and uses index `key={i}` on unbounded `state.log`.

---

## Implementation B (`B/game`)

**Strengths:**
- Best Electron hardening: custom `chronicle://` protocol with traversal guard, permission handlers denied, strict `'none'`/`'self'` CSP with `pixi.js/unsafe-eval`, and `app.getAppMetrics()` sandbox assertion (`B/game/src/main.ts:55-68`, `B/game/index.html:6`, `B/game/tests/e2e/battle.spec.ts:39-46`).
- Strongest test rigor: deep-freezes state (`B/game/tests/rules.test.ts:13-16`), validates excess-property rejection (`B/game/src/contracts.ts:21`), and drives all four endings + restarts in Electron.

**Weaknesses:**
- Renderer leaks rules logic by importing `living`, `reachable`, and `distance` from `../rules` and computing damage locally (`B/game/src/renderer/Board.tsx:6`, `B/game/src/renderer/main.tsx:4,50-51`).
- E2E clicks DOM `.tile` overlay buttons rather than canvas coordinates (`B/game/tests/e2e/battle.spec.ts:59`).

**Bugs:**
- `B/game/src/rules.ts:103-107`: `resolveEnemyPhase` unconditionally sets `moved: true` and logs `"The Warden advances..."` when `distance > 1`, even if the best choice is staying on `enemy.position`.
- `B/game/src/renderer/Board.tsx:66`: `instance.init` forces `preference: 'webgl'` with no `'canvas'` fallback.
- `B/game/src/renderer/main.tsx:39,55`: local `selected` state persists across `Attack`, `Wait`, and `EndPhase` (cleared only on `Restart`).

---

## Implementation C (`C/game`)

**Strengths:**
- Cleanest rules/renderer boundary: `src/renderer/` imports only `src/shared/contracts.ts` and reads `reachableTiles`, `attackableTargetIds`, and `stateHash` from `BattleSnapshot` (`C/game/src/rules/battle.ts:783-807`).
- Strong M2+ foundation with split strict `tsconfig`s, structured `BattleEvent` log, `rulesVersion`, `seed`, range fields, and real canvas-coordinate clicks in E2E (`C/game/e2e/battle.e2e.ts:12-22`).

**Weaknesses:**
- `GameHost` runs in Electron main (`C/game/src/main/index.ts:15`) instead of a `worker_threads` worker (`SPEC.md` §6).
- Unit tests omit deep-freeze mutation and excess-property checks; E2E lacks invalid-command and `getAppMetrics().sandboxed` checks.

**Bugs:**
- `C/game/src/renderer/App.tsx:149-155`: global `keydown` handler triggers `handleTileClick(cursor)` on `Enter`/`Space` without guarding `e.target`, colliding with focused `<button>` activation.
- `C/game/src/renderer/App.tsx:56-65` & `C/game/src/main/gameHost.ts:58,67`: no in-flight request lock in `App`, while `dispatch` both emits `onSnapshot` and returns `snapshot`, causing double renders and potential async races.
- `C/game/src/shared/contracts.ts:81`: `decodeGameCommand` omits `{ onExcessProperty: 'error' }`, silently stripping extra IPC payload fields.
- `C/game/src/main/index.ts:65,93-102`: `webRequest.onHeadersReceived` CSP does not apply to `file://` URLs loaded via `loadFile`, leaving only the looser `<meta>` CSP (`C/game/src/renderer/index.html:5-8`).

---

## Authorship Guess

- **A — GPT-6.1 Terra (65% confidence):** hyper-terse formatting, omitted `effect` Schema, and older memorized dependency versions (`electron 35.0.2`, `pixi.js 8.8.1`).
- **B — GPT-6.1 Sol (60% confidence):** compact yet thorough security engineering (`chronicle://` protocol, `allowScripts`, strict CSP, deep-freeze tests).
- **C — Gemini 4 Hydrogen (65% confidence):** verbose multi-file layout (`shared/`, `rules/`, `main/`, `renderer/components/`), split `tsconfig`s, `StrictMode`, and `"Brass Ward"` naming. I think **C** is most likely my own work.