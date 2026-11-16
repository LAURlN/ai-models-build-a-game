# R03 blind engineering review (M2 + M3 + M6)

Method: I read every rules, host, save-store, renderer-entry, unit-test and e2e file in all four builds against BRIEF.md and SPEC §2, §3, §6 and §8 (M2/M3/M6). I did not install or run anything, so a scripted-check failure would not show up here. Every defect below comes from reading the code.

## Scores

| Impl | correctness | completeness | evidence_rigor | instruction_following | usefulness | total |
|---|---|---|---|---|---|---|
| A | 2 | 3 | 2 | 1 | 1 | 9 |
| B | 4 | 5 | 5 | 4 | 4 | 22 |
| C | 4 | 5 | 5 | 5 | 4 | 23 |
| D | 3 | 4 | 4 | 3 | 4 | 18 |

**Ranking: C > B > D > A**

## Per-implementation assessment

**A** — A has the minimum gameplay surface: a 10×10 map, 4 units against 5, an exchange with counters and follow-ups, forecast branches made by replaying `resolveExchange` with rolls forced to 0 or 9999, `node:sqlite` saves and a 3-charge rewind. It does not engineer what the round asks for. The "Rule IR" is a five-opcode private effect list. It has no listeners runtime, hooks, scopes, queue or root transaction. The `kill` and `statusExpiry` handlers are hard-wired into `combat.ts` and `battle.ts`, and the ability is gated on the literal ID `player_vanguard`. Terrain is not data. Cover and rock coordinates are hard-coded in four places: rules, battle, Pixi and the React forecast. The renderer imports the rules module and computes the forecast itself, so it is not a snapshot-only view. The saves are one JSON blob per write. Rewinding an enemy-phase boundary replays that phase identically and wastes a charge. The tests are thin: there is no rollback fixture, and the kill fixture searches seeds instead of forcing a branch. The e2e pixel check counts distinct byte values rather than painted pixels. It is a poor base.

**B** — B is a compact and spec-faithful kernel. `ir.ts` compiles typed JSON definitions with exact-key validation, scope and limit checks, node and depth bounds, a hook-emission cycle graph and status reference checks. It generates the rules text, and it interprets listeners with priority ordering, `maxPerRoot` and `maxPerPhase`, fuel, ancestry depth, and FIFO draining after each sequence step, which is what the spec describes. Every command runs on a `structuredClone`, so any throw rolls back HP costs, grants, counters, events and `rngPosition`. Forecasts run the same `exchange()` with a forced roller on clones and are served over IPC from the worker. The SQLite store uses WAL and `synchronous=FULL`. It keeps a separate `rewind_ledger` with MAX semantics, so charges cannot be refunded by loading or restarting. It records faults, quarantines definitions and offers a Technical abort, which goes beyond the brief. The tests are the strongest of the four. They cover every forced branch, compared against the events and trigger list, with variants for a fast defender, range 2 and a lethal strike. They also cover an injected arithmetic fault after the cost is reserved, and a child process that dies inside an open transaction. The weaknesses are dense one-line code, a fault quarantine that can permanently block a whole profile, and a renderer that imports `rules/ir` for tooltips.

**C** — C has the same architecture as B, a clone-per-root kernel with a compiled IR slice, with slightly better boundaries and hardening. The renderer imports only types. Forecasts for every legal target and the compiled tooltips are part of the snapshot read model. Every committed state goes through `validateNumbers` to enforce the ±1,000,000 bound. Disk-write failures pause commands. The Turnwheel offers any earlier player-phase boundary, with a charge ledger kept outside the restored state. The SQLite tests are the most thorough. They cover an interrupted commit, and an abrupt child-process exit both before and after COMMIT, followed by `PRAGMA integrity_check`. The e2e suite covers (a)–(g) through real Electron, including scaled canvas clicks, hover without RNG use, bump confirmation, Borrowed Second, a save→quit→relaunch→load that also proves charges are not refunded, a legal victory and a combat defeat. The weaknesses are small. The event queue drains recursively (depth-first) rather than FIFO after the atomic operation. `contentHash` is hand-written rather than computed. Paying a 3 HP cost at exactly 3 HP kills the unit.

**D** — D is the most ambitious build. Its Rule IR uses Effect Schema with recursive expression and statement ASTs, guards, typed unit references, move-only and attack-only credit types, and a decreasing-counter cycle analysis. Its probability-weighted forecast branches run through `resolveCombatExchange` in forced mode. Its e2e drives a victory through real canvas and UI clicks. It also has the most serious correctness defects among the stronger builds. During an enemy phase, every enemy's rolls are perfectly correlated. Loading a manual save refunds Turnwheel charges, which breaks an M6 requirement. A failed kill or expiry root transaction is skipped silently, which the spec forbids. In-memory state advances before the save is committed. The forecast's debt liability text is hard-coded rather than taken from compiled data. Every launch overwrites the autosave with a fresh battle. `battle.ts` is a 2,055-line monolith. The IR design is worth porting, but the build should not be the base without fixes.

## Concrete defects

### A
- `src/rules/combat.ts:56` — cover terrain is hard-coded coordinates inside the combat formula. It is duplicated at `src/renderer/App.tsx:344` and `src/renderer/components/PixiBoard.tsx:39-40`, and impassable tiles are hard-coded at `src/rules/battle.ts:108`. The map has no terrain data.
- `src/rules/ruleIR.ts:1-7` — the "Rule IR" is a private effect list rather than the spec vocabulary. It has no hook dispatch, scopes, event queue or root transaction. `ruleIR.ts:19` treats "cyclic" as "contains `applyStatus` in a listener".
- `src/rules/combat.ts:60-63` and `src/rules/battle.ts:438` — the kill and expiry listeners are hard-wired calls rather than interpreted listeners. `maxPerRoot` and `maxPerPhase` are declared but never enforced.
- `src/rules/battle.ts:522` — the ability is gated on `unit.id !== 'player_vanguard'` rather than unit ability data.
- `src/rules/effects.ts:6` — `grantAction` clears `hasActed` but leaves `hasMoved`, so the granted "any" credit can never be used to move.
- `src/renderer/App.tsx:1-2,200,344-345` — the renderer imports the rules modules and runs `forecastExchange` and `strikeStats` locally. The debt liability text is hard-coded in the renderer.
- `src/main/battleHost.ts:71-77` — the Turnwheel pops one history entry. Rewinding a `RUN_ENEMY_PHASE` boundary restores the enemy phase, which is immediately rescheduled (`:76`) and replays identically, so the charge is wasted.
- `src/main/battleHost.ts:31,141-146` — the whole state and history are a single JSON blob. There is no autosave resume on relaunch and no pinned definitions.
- Tests: there is no root rollback or RNG rollback fixture, which the brief requires. `tests/rules.test.ts:139` finds a kill by scanning seeds rather than by forcing a branch. `e2e/battle.e2e.ts:15` checks `new Set(bitmap bytes).size > 10`, which is a very weak test that the board rendered.

### B
- `src/main/battleHost.ts:212-216` and `src/main/saveStore.ts:176-179` — quarantined faults are global and never cleared, not even by Play Again. After one root fault, every command except Concede and Technical abort is refused for that profile forever. `src/rules/battle.ts:265` quarantines the entire pack when the faulting definition is unknown.
- `src/rules/battle.ts:236-237` — the check `u.hp < d.costs.hp` allows paying 3 HP at exactly 3 HP. The unit dies from its own cost, and the grant listener is then skipped because the owner is dead.
- `src/rules/ir.ts:174` — reusing a shared grant key throws inside a listener and is wrapped as a `RootFault` at `ir.ts:230`. That would quarantine the definition for a legal-state condition.
- `src/renderer/App.tsx:3,91` — the renderer imports `rules/ir` for tooltips. The button label "Borrowed Second", the `hp < 3` check and `phaseUses[id]` (which assumes `useKey === id`) are hard-coded.
- `src/main/saveStore.ts:167-171` — the full session, including every historical state, is re-serialized on every command, so storage grows quadratically.

### C
- `src/rules/battle.ts:796` — the check `u.hp < d.costHP` lets the unit pay a lethal cost and die.
- `src/rules/ir.ts:422-425` — `emit` drains the queue recursively, so events are processed depth-first rather than FIFO after the current atomic operation as SPEC §2 step 4 requires.
- `src/rules/ir.ts:315,350` — `contentHash` is hand-written (`'bs-v1'`, `'td-v1'`) rather than derived from the content. `src/main/battleHost.ts:29` pins definitions under a fixed key.
- `src/rules/ir.ts:514-521` — `grantAction` with an already-used shared key is silently a no-op rather than an explicit rejection.
- `src/main/battleHost.ts:125-165` — `save`, `load`, `rewind` and `restart` call `store.commit` with no try/catch. A disk error there throws to the worker instead of entering the paused state that `execute` uses.
- `src/main/saveStore.ts:51-52` — every commit re-inserts the full command list (with OR IGNORE) and the full history JSON, so cost grows quadratically.

### D
- `src/rules/battle.ts:958,979-991` with `:1480` — the random draws are keyed only by `(seed, commandOrdinal, "combat_<role>_hit", drawIndex)`. `drawIndex` resets for each exchange, and `commandOrdinal` stays the same for the whole `RUN_ENEMY_PHASE`. As a result, every enemy's initiator hit roll and counter rolls are identical within one enemy phase. The rolls are deterministic but correlated, contrary to SPEC's keying "by effect ID and draw index".
- `src/main/battleHost.ts:253` and `src/main/saveStore.ts:81` — Turnwheel charges are stored in the save slot and restored by `loadGame`. Save, rewind three times, then load, and the charges are refunded. This violates M6 and SPEC's rule that the ledger sits outside restored state.
- `src/rules/battle.ts:1060-1064` and `:1372-1375` — when a kill or `statusExpiry` root transaction fails (`!tx.ok`), it is skipped silently. For an expiry, the status is not even removed. SPEC says "Never silently skip listeners".
- `src/main/battleHost.ts:166` and `:342-348` — the in-memory state is replaced before `persistSlot`. A failed autosave returns an error with the state already advanced, and on the enemy path the error is swallowed. The renderer acknowledgement is not tied to a commit, and new commands are not paused.
- `src/main/battleHost.ts:70-75` — the constructor always creates a new battle and overwrites the autosave slot. A relaunch never resumes, and the previous autosave is destroyed.
- `src/rules/battle.ts:1277-1285` — the forecast liability text for `temporal_debt` is hard-coded (`10 + 5 * st.stacks`) rather than generated from compiled rule data.
- `src/rules/battle.ts` (2,055 lines) — combat, AI, forecast, phases and commands all live in one monolithic module.
- `e2e/battle.e2e.ts:288` — the Borrowed Second e2e accepts `HP (22|26)`, which is a loose assertion.

## Recommendation for the next base

**Use C as the next base.** It has the cleanest boundaries: a pure clone-per-root kernel, a snapshot-only renderer with forecasts in the read model, and a typed host and worker with a single SQLite writer. It has the most rigorous persistence evidence, with crash tests before and after COMMIT plus an integrity check. Its e2e coverage of (a)–(g) is complete. Its known defects are small and local.

Port these into C:
- **From B:**
  - B's drain semantics: a non-reentrant queue that drains after each `sequence` step, which is true FIFO.
  - The `RootFault` path that records the fault, quarantines the offending definition and offers Technical abort. Scope it per battle and clear it on restart.
  - Content hashes computed from the definition.
  - The forced-branch tests that also assert each branch's trigger list against the resolution's rule events.
- **From D:**
  - The Effect-Schema-validated recursive Rule IR (`ExprAst`/`StmtAst`, typed unit refs, listener `guard`).
  - `move_only` and `attack_only` credit types.
  - The decreasing-counter cycle analysis.
  - Probability-weighted forecast branches.
  - The fully UI-click-driven victory e2e.

  Port these designs without D's RNG keying, the in-slot charge ledger or the silent `tx.ok` skips.
- **From A:** nothing structural.

Fix in C before building on it:
1. Reject a cost that would reduce HP to 0 or below.
2. Make draining FIFO.
3. Wrap the `save`, `load`, `rewind` and `restart` commits in the paused-on-error path.
4. Store history incrementally rather than as a full JSON blob on every commit.
