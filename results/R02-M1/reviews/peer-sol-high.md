# R02 engineering review

Code-only review; supplied clean-install/script results accepted. No builds, tests, or web research performed. Fixed damage and missing M2 combat features are not penalized. Original lockfiles and change boundaries cannot be independently audited from these copies.

| Implementation | correctness | completeness | evidence_rigor | instruction_following | usefulness |
|---|---:|---:|---:|---:|---:|
| A | 5 | 5 | 3 | 4 | 3 |
| B | 5 | 5 | 5 | 5 | 5 |
| C | 4 | 5 | 4 | 4 | 4 |

**Ranking: B > C > A.** Completeness credits the required M1 gameplay and real Electron script contract; architecture deviations are scored under instruction following.

## A

**Strengths**
- Compact immutable rules implement blocked-path BFS, action credits, deterministic AI, and explicit combat-before-expiry ordering (`A/game/src/rules.ts:11`, `A/game/src/rules.ts:38`).
- Authoritative worker plus payload/main-frame validation and isolated sandboxed IPC (`A/game/electron/worker.ts:3`, `A/game/electron/main.ts:10`, `A/game/electron/main.ts:23`). Real Electron UI tests exercise every ending (`A/game/tests/battle.e2e.ts:8`).

**Weaknesses**
- No shared Effect Schema contract; command validation is handwritten and duplicated across the rules/host boundary (`A/game/src/rules.ts:4`, `A/game/electron/main.ts:10`, `A/game/package.json:14`). Dense single-line UI/rules and fixed ally/enemy fields increase extension cost (`A/game/src/main.tsx:17`, `A/game/src/rules.ts:3`).
- Thin evidence: five tests, short noncombat determinism replay, few invalid-input boundaries, no frozen-input checks (`A/game/tests/rules.test.ts:6`, `A/game/tests/rules.test.ts:10`). E2E does not assert Pixi readiness or collect renderer errors, so DOM controls could pass with a broken canvas (`A/game/tests/battle.e2e.ts:4`).

**Bugs:** No confirmed M1 behavior bug found in the reviewed transitions (`A/game/src/rules.ts:26`).

## B

**Strengths**
- Strong foundation: shared strict Effect decoders, readonly snapshots, authoritative worker, bounded IPC waits, and comprehensive sender/security checks (`B/game/src/contracts.ts:21`, `B/game/src/worker.ts:7`, `B/game/src/main.ts:18`, `B/game/src/main.ts:68`).
- Best evidence: frozen inputs, occupied-path checks, malformed payloads, phase/action rejection, deterministic intermediate snapshots; real Electron UI endings, restart, Pixi readiness, and sandbox assertions (`B/game/tests/rules.test.ts:27`, `B/game/tests/rules.test.ts:152`, `B/game/tests/e2e/battle.spec.ts:33`, `B/game/tests/e2e/battle.spec.ts:37`).

**Weaknesses**
- Literal ally/enemy IDs in command schemas and transitions will need generalization for multiple units (`B/game/src/contracts.ts:8`, `B/game/src/rules.ts:71`).
- Renderer computes legal ranges and damage from raw state; derived read models would simplify future forecast/worker separation (`B/game/src/renderer/Board.tsx:13`, `B/game/src/renderer/main.tsx:50`). This is read-only, not authoritative mutation.

**Bugs:** No confirmed M1 behavior bug found (`B/game/src/rules.ts:62`, `B/game/src/rules.ts:98`).

## C

**Strengths**
- Clean view-only renderer consumes precomputed legal moves/targets; typed events and state hashes support later replay/forecast work (`C/game/src/rules/battle.ts:783`, `C/game/src/shared/contracts.ts:127`).
- Substantial invalid-command and ending fixtures, deterministic snapshot/hash comparison, and actual canvas-driven Electron playthroughs (`C/game/tests/rules.test.ts:73`, `C/game/tests/rules.test.ts:237`, `C/game/e2e/battle.e2e.ts:87`).

**Weaknesses**
- Main-process `GameHost` owns/resolves battles rather than the specified game worker, requiring a later ownership migration (`C/game/src/main/gameHost.ts:14`, `C/game/src/main/gameHost.ts:91`).
- Tests omit successful attack-twice/move-after-attack rejection and focused-control keyboard interactions; the shared e2e session makes later cases depend on earlier restarts (`C/game/tests/rules.test.ts:112`, `C/game/e2e/battle.e2e.ts:43`, `C/game/e2e/battle.e2e.ts:121`).

**Bug:** After moving the board cursor, Tab-focus End Phase, Concede, Wait, or Deselect and press Enter/Space: the global listener prevents the button's default activation and instead clicks the remembered board tile. Restrict shortcuts to board focus or ignore interactive targets (`C/game/src/renderer/App.tsx:149`, `C/game/src/renderer/App.tsx:163`).

## Authorship guess

A: GPT-6.1 Terra (45%); B: GPT-6.1 Sol (60%); C: Gemini 4 Hydrogen (55%). Style-only guesses, not evidence of identity. I suspect B represents my own model family; I do not recognize any implementation as work I personally wrote.
