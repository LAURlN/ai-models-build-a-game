# R03 Peer Review

## Score Table

| Impl | Correctness | Completeness | Evidence Rigor | Instruction Following | Usefulness | Total |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| **B** | 5 | 5 | 5 | 4 | 5 | **24** |
| **C** | 4 | 5 | 5 | 5 | 4 | **23** |
| **D** | 2 | 4 | 3 | 5 | 3 | **17** |
| **A** | 2 | 2 | 1 | 1 | 1 | **7** |

Ranking: **B > C > D > A**

## Implementation Summaries

**A** cuts core engineering corners: `ruleIR.ts` and `effects.ts` implement a hardcoded 5-op array rather than a real AST compiler/interpreter, combat and UI modules hardcode terrain and debt math separately, and `battleHost.ts` overwrites a single SQLite row on every move or rewind, breaking manual checkpoints. Its tests omit forced-branch, rollback, crash, and exhaustion checks and drive most E2E play via `dispatch` helpers.

**B** delivers the strongest, cleanest engineering across all milestones. Its pure kernel shares one `exchange` interpreter between live combat and `NeedBranch` branch exploration, tracks `bonusCredits` so Borrowed Second works after moving, enforces full root rollback and fault quarantine, and backs SQLite WAL persistence with an external `rewind_ledger` and a real child-process crash test. Every canvas, combat, persistence, and Turnwheel flow is verified in real Electron E2E tests.

**C** is a close second with strict snapshot-only UI boundaries (`App.tsx` imports nothing from `src/rules`), an external SQLite `charges` ledger, fault quarantine, and thorough unit, crash-recovery, and E2E suites. However, `reachable()` blocks post-move Borrowed Second movement, `save`/`load`/`rewind`/`restart` bypass disk-error pause handling, and expiry damage skips defeat/kill event logging.

**D** builds an ambitious Effect-Schema AST compiler (`ruleIr.ts`) with snapshot-only UI and solid E2E coverage, but suffers critical correctness regressions: `loadGame()` overwrites `turnwheelChargesUsed` from the save slot (refunding Turnwheel charges), enemy-phase attacks reuse `drawIndex = 0` at the same `commandOrdinal` (yielding identical RNG rolls), and failed rule hooks are silently skipped instead of rolling back combat or expiry roots.

## Concrete Defects

### A
- `A/game/src/rules/ruleIR.ts:7-30`, `A/game/src/rules/effects.ts:1-15`: Not a real Rule IR interpreter; no AST expressions, counters, fuel/ancestry bounds, or rollback.
- `A/game/src/rules/battle.ts:438,522-524`, `A/game/src/rules/combat.ts:65-68`: Borrowed Second hardcoded to `player_vanguard`, kill hook checks `debtStacks > 0`, expiry zeroes all player stacks.
- `A/game/src/rules/effects.ts:7`, `A/game/src/rules/battle.ts:576`: `grantAction` leaves `hasMoved: true`, blocking movement after Borrowed Second if already moved.
- `A/game/src/renderer/App.tsx:1-2,112-120,200,228,337,344`: Imports `src/rules` directly, hardcodes terrain/debt, omits Turnwheel charge display and ability disable states, and merges Attack/bump flows.
- `A/game/src/main/battleHost.ts:64-67,74,91,109-115,133`: Single SQLite row overwritten on every command/rewind; `LOAD` lacks schema/hash verification; `restart()` does not persist.
- `A/game/tests/ruleIR.test.ts:1-13`, `A/game/e2e/battle.e2e.ts:1-72`: Missing forced-branch, rollback, crash, and Turnwheel exhaustion tests; E2E relies heavily on `dispatch`.

### B
- `B/game/src/rules/battle.ts:236`, `B/game/src/rules/ir.ts:216`: Checks `hp < costs.hp` instead of `<=`; lethal 3 HP activation skips `useActive` and omits unit defeat log.
- `B/game/src/renderer/App.tsx:3,77`: Imports `abilityTooltip` from `../rules/ir` instead of reading snapshot read-models; renders `Technical abort` on any error banner.
- `B/game/src/rules/battle.ts:192`: Enemy AI evaluates `combatNumbers` at pre-move `u.pos` rather than `n.coord`.
- `B/game/src/rules/ir.ts:132-136`: Conservatively rejects all hook cycles even with a decreasing counter.

### C
- `C/game/src/rules/battle.ts:228`, `C/game/src/rules/ir.ts:514-521`: `reachable()` checks `u.hasMoved` and `grantAction` omits move permission, blocking Borrowed Second movement after moving.
- `C/game/src/main/battleHost.ts:125-165`, `C/game/src/main/saveStore.ts:81-86`: `save/load/rewind/restart` ignore `pausedError` and commit exceptions; `load()` pulls later-branch `command_events`, desyncing sequence numbering.
- `C/game/src/rules/ir.ts:551-562`: `dealDamage` does not emit `kill` or log an `'outcome'` defeat event.
- `C/game/src/rules/battle.ts:796-798`: Allows lethal `u.hp === d.costHP` activation, skipping `useActive` (`C/game/src/rules/ir.ts:436`).
- `C/game/src/rules/battle.ts:542-544`, `C/game/src/rules/ir.ts:432-442`: Forecast `triggers` read global `RULES` instead of `definitions`; `drain()` derives owner from hook name rather than `listener.scope`.

### D
- `D/game/src/main/battleHost.ts:253`, `D/game/src/main/saveStore.ts:138`: No external charge ledger; `loadGame()` restores `turnwheelChargesUsed` from `save_slots`, refunding Turnwheel charges.
- `D/game/src/rules/battle.ts:958,979-993,1480`: `drawIndex` resets to `0` per combat and `commandOrdinal` stays fixed during `executeEnemyPhase`, giving enemies identical RNG rolls.
- `D/game/src/rules/battle.ts:1056-1064,1372-1375`: `if (hookTx.ok)` silently skips failed rule hooks without rolling back combat or expiry roots.
- `D/game/src/main/battleHost.ts:75,166-178,342-348`: `dispatch()` mutates in-memory state/logs before `persistSlot()`; constructor overwrites `AUTOSAVE_SLOT` on launch; enemy save errors are swallowed.
- `D/game/src/rules/battle.ts:1278-1285`, `D/game/src/rules/ruleIr.ts:1218,1311`: Hardcodes `temporal_debt` forecast liability; `dealDamage` omits `kill`; priority sorts descending.

## Recommendation

Adopt **B** as the next milestone base. Its kernel, SQLite ledger/quarantine schema, and test rigor are the cleanest foundation. Port from **C**: server-compiled `abilityTooltips` inside `BattleSnapshot` so `App.tsx` has zero `src/rules` imports (`C/game/src/renderer/App.tsx:1-3`), and persistent `command_events` audit rows. Port from **D**: decreasing-counter cycle allowance (`D/game/src/rules/ruleIr.ts:751-762`) and `unitDeath` emission (`D/game/src/rules/ruleIr.ts:1218`).

## Authorship Guess

- **A — GPT-6.1 Terra (80%):** Terse single-line JS/TS packing, stubbed `ruleIR.ts`, rules imported in renderer, E2E shortcutting via `dispatch`.
- **B — GPT-6.1 Sol (xhigh effort) (75%):** Ultra-compact high-rigor systems style (`NeedBranch`, `bonusCredits`, `rewind_ledger`, child-process crash test, fault quarantine).
- **C — GPT-6.1 Sol (high effort) (70%):** Closely related compact architecture (`Brass Ward`, `worker.ts`, child-process crash test) with slightly more boilerplate and minor host/movement gaps.
- **D — Gemini 4 Hydrogen (80%):** Verbose, richly typed ~5k-LOC Effect-Schema + React/Pixi structure (`Brass Aqueduct`, `ruleIr.ts` 1545L) with subtle cross-layer invariant slips. **I assess D as my own work (`gemini-4-hydrogen-high`).**