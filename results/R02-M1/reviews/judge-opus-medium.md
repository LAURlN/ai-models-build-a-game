# R02 blind engineering review (M1 micro-battle)

Scope: code and engineering only. I read the code; I did not run the apps. The one exception: I installed `pixi.js@8.8.1` in a scratch folder to confirm one A defect from Pixi's source.

## Scores

| Impl | correctness | completeness | evidence_rigor | instruction_following | usefulness | total |
|---|---|---|---|---|---|---|
| **B** | 5 | 5 | 5 | 5 | 4 | **24** |
| **C** | 5 | 5 | 4 | 4 | 5 | **23** |
| **A** | 2 | 2 | 2 | 2 | 1 | **9** |

**Ranking: B > C > A** (B and C are close; A is far behind)

Unit tests per implementation: A has 5 Vitest cases. B has 21 (one `it.each` with 9 invalid inputs). C has 9. E2E tests per implementation: A has 4 separate tests, each with a fresh app. B has 1 long test. C has 5 tests that run in order on one shared app.

---

## A

A is a very small, compressed solution of about 200 lines. Most files are minified one-liners. The rules module `src/rules.ts` is pure and deterministic, and it has a correct BFS for movement. Electron security is set up properly: a worker thread owns the state, main checks the sender and payload shape, and the renderer has context isolation and sandboxing.

However, A has a serious hidden defect. The CSP in `index.html` is `script-src 'self'` with no `'unsafe-eval'`, and the code never imports `pixi.js/unsafe-eval`. Pixi 8.8.1 checks for eval support in the renderer constructor. That check is `AbstractRenderer.mjs:42`, which calls `_unsafeEvalCheck`, which throws "Current environment does not allow unsafe-eval". So the async Pixi init almost certainly rejects, and nothing catches it. The tiles are transparent DOM buttons (`style.css`, `.grid button{background:transparent}`). As a result, the board and the movement-range highlight are most likely never drawn.

The e2e tests still pass because they only click the invisible buttons. They never check that the canvas exists and never collect page errors. The enemy phase is resolved synchronously inside `endPhase`, so the `'enemy'` phase never actually exists. The test for "rejected during enemy phase" uses a hand-made state. The package pins are old (Electron 35.0.2, Vite 6.2.2, pixi 8.8.1). B and C pin identical, newer versions, so A is almost certainly the implementation with the 8 npm audit vulnerabilities. The state shape hardcodes `ally` and `enemy` fields, so it is a poor base for M2.

**Defects**
- `index.html:1` + `src/main.tsx:3,9`: the CSP blocks eval and there is no `pixi.js/unsafe-eval` import. Pixi `Application.init` throws, so the board and movement range are not shown. This breaks the "see its movement range" requirement. The rejection is unhandled (async IIFE at `src/main.tsx:9`).
- `tests/battle.e2e.ts:4-11`: the e2e never checks the canvas or page errors, which is why the defect above passes.
- `src/main.tsx:9-12`: a whole new Pixi `Application` (and WebGL context) is created and destroyed on every state change.
- `src/rules.ts:38-52`: the enemy phase runs synchronously inside `endPhase`, and `phase:'enemy'` is never reached. `tests/rules.test.ts:6` only covers it by building the state by hand.
- `src/rules.ts:26-53`: invalid commands return `s` without a reason, so the renderer cannot explain a rejection.
- `electron/main.ts:9,21`: the worker has no error or exit handling and requests have no timeout. If the worker dies, IPC promises hang forever.
- `src/main.tsx:4,10`: the renderer imports `canMove` from the rules to compute legality itself, instead of displaying a snapshot.
- `src/rules.ts:2-4`: `Unit.id` is `'ally'|'enemy'`, `State` has fixed `ally`/`enemy` fields, and `select` only accepts `'ally'`. None of this extends to more units.
- `package.json:15-29`: outdated pins (Electron 35.0.2, Vite 6.2.2), most likely the source of the 8 audit vulnerabilities. Commands are validated by hand rather than with the Effect Schema the spec asks for.
- `tests/rules.test.ts:10`: the determinism test only runs `reduce` twice on the same input. The tests are compressed into one-liners and cover few cases.

## B

B is compact (rules about 120 lines) and has the most disciplined architecture. `src/contracts.ts` defines the request and command schemas with Effect Schema and `onExcessProperty:'error'`. The rules are pure, return a `Result` with `accepted`/`error`, and keep a `commandOrdinal`. Enemy resolution is a separate host-only transition that the renderer cannot reach (`resolveEnemyPhase`, not part of the IPC schema). A `worker_threads` worker owns the authoritative state, which matches spec §6. Main validates the sender, frame and URL and decodes every request. The page is served through a custom `chronicle://` protocol with a path-traversal guard. All permissions are denied, and the CSP is strict (no `unsafe-inline`). Pixi is correctly paired with `pixi.js/unsafe-eval`.

The unit tests are the strongest of the three. They deep-freeze inputs and compare `JSON.stringify` before and after for 9 invalid inputs (including a non-integer coordinate, an extra property, `null`, and the internal `ResolveEnemyPhase`). They cover every ending played through legal commands only. The expiry test finds an evasion path at run time instead of using a script. The replay test compares byte-identical snapshot sequences.

The e2e tests drive the real Electron app. They check that the renderer is sandboxed, that `window.battle` is frozen, and that `require` is absent. They play all four endings through UI clicks and the keyboard, and confirm that commands are rejected during the enemy phase. The main weakness is that the unit model is hardcoded to `'ally'`/`'enemy'` literals.

**Defects / weaknesses**
- `src/contracts.ts:8-10`, `src/rules.ts:10`, `src/rules.ts:71`: command `unitId` is `Literal('ally')`, and the rules look units up by fixed ids. M2 needs these generalized to N units and factions.
- `src/renderer/Board.tsx:6,13,84`, `src/renderer/main.tsx:4,48`: the renderer imports `reachable`/`distance` from the rules to compute the range and attack eligibility. This is display logic only, but it duplicates legality in the renderer. C's snapshot read model is cleaner.
- `tests/e2e/battle.spec.ts:205-276`: all four endings run in one test, so an early failure hides the later ones.
- `src/rules.ts:49`: the log is capped at 80 entries (`slice(-80)`), which loses information for a future event log or replay.
- Selection lives only in the presentation layer (`main.tsx:17`) and is not a typed command. This is defensible, but "select" is not part of the rules.
- `src/worker.ts:29`: a 400 ms presentation delay runs inside the authoritative worker. It does not affect outcomes, but it adds timing to the state owner.
- `src/main.ts:32-36`: if the worker crashes it is not restarted. All later requests are rejected with a message instead of hanging, which is acceptable for M1.

## C

C is the most general and the most verbose (rules about 800 lines). Units have string ids, factions, `minRange`/`maxRange` and an `alive` flag. The enemy AI loops over all enemies, ranks targets and attack tiles with stable tie-breaks, and sorts by id. The state carries `rulesVersion`, `seed`, `commandOrdinal` and typed `BattleEvent`s with ids. The host-only `RUN_ENEMY_PHASE` is excluded from the IPC schema. `buildSnapshot` produces a real read model: `reachableTiles`, `attackableTargetIds` and an FNV-style `stateHash`. Because of this, the renderer truly only displays snapshot data and sends commands (`App.tsx:68-112`), which best fits the brief.

C's e2e is the strongest at proving the Pixi board works: it clicks canvas coordinates directly and asserts no page errors. It also checks the renderer has no `require`/`process`.

The weaknesses are mostly against the spec's architecture. Authoritative state lives in a `GameHost` class in the Electron main process, not in a worker. Command decoding silently strips extra properties instead of rejecting them. The unit tests replay fixed scripted sequences and check identity and hash. That is solid, but less adversarial than B's.

**Defects / weaknesses**
- `src/main/gameHost.ts:14-23`, `src/main/index.ts:15`: authoritative command resolution runs in the Electron main process, not in a game worker (spec §6).
- `src/shared/contracts.ts:81`: `decodeUnknownEither(GameCommandSchema)` uses the default excess-property handling, so extra fields are silently dropped instead of rejected. `CoordSchema` (`:8-11`) is an unbounded Int. The rules check bounds, so this is not exploitable.
- `src/rules/battle.ts:564-595`: `SELECT_UNIT` (including deselect) is a committed command that increments `commandOrdinal`. UI noise therefore enters the authoritative command log, which matters for M6 replay and Turnwheel.
- `src/rules/battle.ts:57`: `seed` is stored but never used. That is harmless, but it implies determinism that is not yet backed by a PRNG.
- `src/renderer/App.tsx:56-59,61-65`: `dispatch`/`restart` have no `catch` and no busy lock. An IPC throw becomes an unhandled rejection with no message to the user.
- `src/main/index.ts:93-102`: the CSP is injected through `webRequest.onHeadersReceived`, which probably does not apply to `file://` loads. The `<meta>` CSP in `index.html` covers it anyway. There is no permission-request handler and no `will-attach-webview` guard (B has both).
- `e2e/battle.e2e.ts:297-455`: the tests depend on order and share one app, because each restarts the app state for the next.
- `src/rules/battle.ts` repeats boilerplate throughout (unit lookup, alive and faction checks repeated per command, verbose event appending). A small validation helper would roughly halve it.

---

## Recommendation for the M2 base (engineering)

**Use B as the M2 base.** It already has the architecture the spec requires: a worker that owns the state, strict Effect Schema IPC with excess properties rejected, a host-only enemy transition, a custom protocol, a strict CSP, and permission denial. It also has the most rigorous test style: frozen inputs, byte-identical invalid-command checks, and endings reached only through legal commands. Its rules file is small, so generalizing it is cheap. M2 has to rework the kernel for the §2 formulas anyway.

**Port from C:**
1. The general unit model: string ids, faction, `minRange`/`maxRange`, `alive`, and C's multi-enemy AI loop with stable tie-breaks. This replaces B's `'ally'`/`'enemy'` literals.
2. The `buildSnapshot` read model (`reachableTiles`, `attackableTargetIds`), so the renderer stops importing the rules.
3. `computeStateHash`, `rulesVersion` and typed `BattleEvent`s with ids. M2's requirement of identical hashes for 20-command logs needs these. Drop B's 80-entry log cap.
4. C's e2e technique of clicking the Pixi canvas and asserting no page errors, so the board itself is proven to render. Split B's single long e2e into one test per ending.

**From A:** nothing worth porting beyond its per-test fresh-app e2e isolation. If anyone reuses its Pixi setup, they must add `import 'pixi.js/unsafe-eval'`.
