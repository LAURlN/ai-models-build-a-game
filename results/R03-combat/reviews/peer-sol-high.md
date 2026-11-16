# Blind engineering review

| Implementation | correctness | completeness | evidence_rigor | instruction_following | usefulness |
|---|---:|---:|---:|---:|---:|
| A | 3 | 3 | 2 | 2 | 2 |
| B | 4 | 4 | 5 | 4 | 5 |
| C | 3 | 4 | 4 | 4 | 4 |
| D | 2 | 4 | 3 | 3 | 3 |

Ranking: **B > C > D > A**.

Method: source inspection of rules, hosts, renderer wiring, security, tests and documentation against the authorized specification. No authorship/provenance sources were inspected. All supplied copies omit lockfiles. An isolated copy of C returned npm EUSAGE for `npm ci`; consequently no build, unit-test or Electron execution is claimed. Original modification scope and commits cannot be verified from these copies. Visual quality and fun were excluded.

**A.** Combat arithmetic, seeded exchanges and branch enumeration are reasonably separated, and the basic battle/save flows are wired. However, the mechanic is substantially special-cased: status IDs and listener dispatch are interpreted as one debt field, not general compiled statuses. Tests cover familiar outcomes but lack whole-command fault rollback and an attack/rewind reroll fixture. The victory policy reads future seeded outcomes, weakening evidence that ordinary tactical play was exercised.

**B.** Best foundation: compact pure command transactions, shared exchange forecasting, real random-draw rollback, generated operational text, pinned status hashes, fault quarantine and a durable per-battle rewind ledger. Unit fixtures compare branch explanations and exercise actual crash recovery; Electron tests cover all seven requested paths, including painted pixels, scaled clicks, full victory and combat defeat. Its admitted IR still has an expiry-timing defect, and installation evidence is incomplete in the supplied artifact.

**C.** Strong separation of snapshots from adjudication, useful obstacle-aware AI, detailed compositor/token checks, and substantial rollback/save/charge-ledger coverage. The final-phase expiry condition contradicts its own test, extra credits cannot fund movement, and the interpreter silently ignores some listeners its compiler admits. Its scope is honestly documented, but these issues need fixing before taking it as the base.

**D.** Broad UI coverage and the richest typed AST, including guards and explicit target references. Arithmetic and ordinary forecast branches are implemented, but persistence and transaction boundaries contain material correctness failures. Tests validate a standalone transaction helper rather than rollback of an actual failed combat root, and omit loading a checkpoint saved before a rewind. These gaps explain why extensive tests miss serious defects.

## Concrete defects

Paths below are relative to this folder.

**A**
- `A/game/README.md:6`: prescribed `npm ci` cannot run without the missing lockfile.
- `A/game/src/rules/effects.ts:8`: apply/remove status ignore the supplied status ID and mutate only `debtStacks`; `combat.ts:65` and `battle.ts:438` hard-code kill/expiry dispatch. No general root limits or transactional fault path backs the claimed Rule IR slice.
- `A/game/src/rules/battle.ts:119`: `hasMoved` blocks another move even after an `any` action grant; `effects.ts:7` never restores movement eligibility.
- `A/game/src/renderer/App.tsx:200`: renderer executes the combat interpreter for forecasts, violating snapshot-only adjudication.
- `A/game/tests/strategy.ts:8`: victory policy previews the exact future seeded roll; `e2e/battle.e2e.ts:53` checks independent HP sets rather than one coherent strike branch.

**B**
- `B/game/README.md:8`: missing lockfile breaks the required clean-install command.
- `B/game/src/rules/ir.ts:180`: next-own-phase expiry is always current ordinal +2. A supported kill listener applying a status during an enemy-phase counter should use +1; instead the status survives the next own-phase start.
- `B/game/src/rules/battle.ts:51`: movement highlighting ignores `blockOrdinaryAction`, although command execution rejects that movement at line 241; admitted blocking statuses produce misleading reachable tiles.

**C**
- `C/game/README.md:8`: missing lockfile breaks `npm ci`.
- `C/game/src/rules/battle.ts:555`: expiry at ordinal `2*maxTurns` ends the battle when its last enemy phase opens. With `maxTurns=1`, END_PHASE already terminates; the subsequent RUN_ENEMY_PHASE asserted in `tests/rules.test.ts:312` must fail.
- `C/game/src/rules/battle.ts:228`: extra `any` credits cannot buy another move after movement is spent.
- `C/game/src/rules/ir.ts:437`: non-activation/non-expiry events inspect statuses only, silently excluding compiled ability kill/damage/heal listeners.
- `C/game/src/rules/ir.ts:527`: next-own-phase expiry also assumes +2 during opposing phases.

**D**
- `D/game/README.md:10`: missing lockfile breaks `npm ci`.
- `D/game/src/main/battleHost.ts:253`: loading an older manual save restores spent charges, enabling unlimited rewinds. Line 75 also overwrites the autosave with initial deployment on every launch.
- `D/game/src/main/battleHost.ts:166`: state/history advance before durable commit; save failures leave changed memory and permit further commands. Line 346 silently acknowledges failed enemy saves.
- `D/game/src/rules/battle.ts:1060`: failed kill-hook transactions are ignored after damage/RNG/action spending; expiry failures are likewise swallowed at line 1372.
- `D/game/src/rules/ruleIr.ts:1037`: emitted hooks wait until the whole listener finishes, contrary to draining between sequence operations. Line 1050 ignores the shared grant key.
- `D/game/src/main/battleHost.ts:296`: rewinds delete command history instead of retaining branch records.

## Recommendation

Use **B**, fixing expiry timing and restoring the lockfile first. Port C's obstacle-aware approach scoring and token-location pixel assertions. Consider D's typed guards and faction-aware expiry helper after auditing transaction integration. A's small separate combat module is readable, but its mechanic interpreter should not replace B's.

## Authorship guesses — speculation only

A: Gemini 4 Hydrogen, 45%. B: GPT-6.1 Sol (high effort), 30%. C: GPT-6.1 Sol (xhigh effort), 35%. D: GPT-6.1 Terra, 30%. Tentative own-work guess: B, low confidence; I recognize no implementation and have no provenance evidence.
