# R03 engineering review

| Implementation | Correctness | Completeness | Evidence rigor | Instruction following | Usefulness |
|---|---:|---:|---:|---:|---:|
| A | 2 | 3 | 3 | 2 | 2 |
| B | 4 | 4 | 5 | 4 | 4 |
| C | 3 | 4 | 4 | 4 | 4 |
| D | 2 | 4 | 4 | 3 | 3 |

Ranking: **B > C > D > A**. This is a static review; no scripts were run. None of the supplied game folders contains a package lockfile, so `npm ci` cannot succeed on these copies. That may be an artifact of the blind-copy process; it prevents verifying the clean-install contract, not a confident attribution to an author. Changes outside game cannot be audited from these copies.

**A.** The small combat module enumerates forecast outcomes through the resolution function, and there are real branch and Electron tests. However, the interpreter is largely recipe-specific, the renderer invokes rules directly, and the extra action cannot be used for movement. Its canvas test measures distinct byte values rather than actual distinct pixels; its forecast assertion checks each unit's HP independently, not a corresponding branch.

**B.** This is the strongest balanced foundation: a bounded, data-driven interpreter, cloned root transactions, branch forecasts, LOS-aware targeting, and atomic SQLite state and charge ledger. The tests exercise rollback and real Electron flows, including lifecycle, canvas and endings. There are still extensibility and semantic gaps in the event vocabulary and terminal handling, and its artificial phase-command cap can alter legal play.

**C.** The compiler and rollback fixtures are substantial; the e2e suite checks rendered canvas, forecast branches and real process relaunch. The principal gameplay issue is that the `any` bonus action cannot supply another move. The engine's restricted event dispatch also leaves advertised future mechanics needing further implementation.

**D.** The broad typed IR and detailed tests provide useful material, but loading a manual save refunds Turnwheel charges, and failed saves can leave memory ahead of durable state. Combat accepts several hook types without dispatching them. The tests cover normal rewind and interrupted SQLite transactions, but not the manual-load refund or the host's handling of a write failure.

## Concrete defects

- **A:** `src/rules/effects.ts:7` grants an action without restoring movement, while `src/rules/battle.ts:119` rejects a second move. `src/rules/battle.ts:522` and `src/rules/combat.ts:65` special-case the ability and debt rather than dispatching compiled listeners; `src/rules/ruleIR.ts:19` validates limits but does not enforce them at runtime. `src/renderer/App.tsx:1` and `:200` run rules in the renderer. `e2e/battle.e2e.ts:15` counts distinct bitmap byte values, and `:53` compares separate HP sets rather than one joint outcome.
- **B:** `src/rules/battle.ts:260` forces an enemy phase after 512 commands even if legal actions remain. `src/rules/ir.ts:148` omits actual damage/heal from event data although `:187` and `:241` emit those events; listeners cannot implement the specified actual-amount semantics. `src/rules/ir.ts:242` emits kill but not unitDeath, limiting future death listeners.
- **C:** `src/rules/ir.ts:514` adds action credits but never restores movement; `src/rules/battle.ts:228` rejects movement once `hasMoved` is set, so an `any` credit cannot be spent on a second move. `src/rules/battle.ts:816` forces a phase after 512 commands. `src/rules/battle.ts:450` emits afterDamage and kill but omits hit/miss and beforeAttack, so adding such listeners requires changing combat.
- **D:** `src/main/battleHost.ts:253` replaces the spent ledger with the older manual save's value, allowing save → rewind → load to refund charges. At `:166`–`:176` state and log change before autosave succeeds; `:342`–`:349` even suppresses enemy autosave errors and emits the uncommitted state. `src/rules/battle.ts:1279` hard-codes debt liability text and damage rather than deriving it from the compiled rule. `src/rules/ruleIr.ts:24` accepts beforeAttack but `src/rules/battle.ts:905` does not emit that hook during exchange.

## Recommendation

Use **B** as the next base, after fixing the defects above and restoring a reproducible lockfile. Port C's extensive dynamic-fault fixtures and D's explicit compiler schemas and canvas-driven full victory test where compatible. A's compact standalone combat fixtures are also useful references.

## Authorship guesses

These are low-confidence stylistic guesses, not evidence of identity: A — Gemini 4 Hydrogen (30%); B — GPT-6.1 Sol xhigh (30%); C — GPT-6.1 Sol high (30%); D — GPT-6.1 Terra (30%). I am GPT-6.1 Terra; D could be my own work, but I cannot establish that from these anonymous files.
