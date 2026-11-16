# R02 engineering review

| Implementation | correctness | completeness | evidence_rigor | instruction_following | usefulness |
|---|---:|---:|---:|---:|---:|
| A | 5 | 5 | 4 | 4 | 4 |
| B | 5 | 5 | 5 | 4 | 5 |
| C | 5 | 5 | 5 | 4 | 4 |

Ranking: **B > C > A**.

## A

Strengths:
- Pure, immutable transitions, bounded pathfinding, terminal checks and deterministic enemy behavior are compact and readable (A/game/src/rules.ts:11, A/game/src/rules.ts:26).
- Actual Electron UI tests cover all four distinct endings and restart (A/game/tests/battle.e2e.ts:4, A/game/tests/battle.e2e.ts:8).

Weaknesses:
- Hand-written IPC validation and contracts do not use the shared Effect Schema contracts specified in §6 (A/game/electron/main.ts:10, A/game/src/rules.ts:4).
- The renderer calls rules code to derive reachability rather than receiving a complete read model; tests cover fewer malformed inputs and movement edge cases than the other submissions (A/game/src/main.tsx:4, A/game/tests/rules.test.ts:6).

Bugs: none confirmed in the M1 flow inspected.

## B

Strengths:
- Validated, narrowly scoped IPC, isolated worker, error handling and deterministic state transitions make a strong host boundary (B/game/src/main.ts:14, B/game/src/main.ts:67, B/game/src/worker.ts:11).
- Rules tests exercise immutability, invalid actions and deterministic replay, while the Electron suite verifies all four endings through normal play (B/game/tests/rules.test.ts:13, B/game/tests/rules.test.ts:152, B/game/tests/e2e/battle.spec.ts:55).

Weaknesses:
- Selection is renderer-local and range is recomputed in the renderer; these are not snapshot-driven typed selection commands, making replay and future read models less consistent (B/game/src/renderer/main.tsx:17, B/game/src/renderer/Board.tsx:13).
- The kernel hardcodes the two unit identities, limiting reuse for later encounters (B/game/src/rules.ts:51, B/game/src/rules.ts:71).

Bugs: none confirmed in the M1 flow inspected.

## C

Strengths:
- Typed Effect Schema commands and an explicit snapshot with reachable tiles and attack targets keep rules out of the renderer (C/game/src/shared/contracts.ts:31, C/game/src/rules/battle.ts:783).
- Electron tests use the board and real phase progression for all endings; unit tests explicitly check enemy-phase rejections and replay (C/game/e2e/battle.e2e.ts:87, C/game/e2e/battle.e2e.ts:156, C/game/tests/rules.test.ts:124, C/game/tests/rules.test.ts:237).

Weaknesses:
- The authoritative host runs in Electron main rather than the game worker called for by §6, coupling the lifecycle to simulation (C/game/src/main/index.ts:15, C/game/src/main/gameHost.ts:47).
- Snapshots from subscriptions and request responses are applied without ordering or an in-flight guard, leaving a potential stale-display race if delivery is delayed or commands overlap (C/game/src/renderer/App.tsx:45, C/game/src/renderer/App.tsx:56).

Bugs: no additional confirmed M1 rules bug found; the snapshot ordering issue above is a potential UI defect.

## Authorship guess

- A: GPT-6.1 Sol, 35%.
- B: GPT-6.1 Terra, 35%.
- C: Gemini 4 Hydrogen, 35%.

These are low-confidence guesses from code alone. I am GPT-6.1 Terra, so B is my guess for my own work; I have no evidence of actual authorship.
