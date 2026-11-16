# Integration pass before R03 (not a comparison round)

`game/` on master is the R02 winner (user playtest favourite). Improve it as the shared base for the next round, without changing its gameplay feel. A second, rejected implementation of the same milestone is in `game` (read-only source for porting ideas). Read `docs/SPEC.md` §2, §6 and `rounds/R02-M1/BRIEF.md`, and the reviews `rounds/R02-M1/reviews/*.md` (in them, the base is "C" and the other implementation is "B").

## Do
1. **Auto end turn:** when every player unit has acted (or can do nothing more), the player phase ends automatically and the enemy phase runs. Manual "End phase" stays available.
2. **Keep bump-attack:** moving into an enemy unit attacks it, as the build does now. It must stay a typed command handled by the rules module.
3. **Port from the other implementation** what the reviewers rated better, adapting it to this codebase rather than copying wholesale:
   - stronger unit tests (invalid commands leave state unchanged, determinism/state hash, all four endings);
   - Electron hardening (custom protocol or equivalent, permission handlers, CSP that still allows what PixiJS 8 needs, sandbox assertion in e2e);
   - fix the defects listed for "C" in the reviews where they are real.
4. **The e2e must prove the board really renders**: assert that the PixiJS canvas exists with a non-zero size and contains non-background pixels, and that clicking a visible tile on the canvas moves the unit. (In R02 one build passed e2e while its board never drew.) Also assert that the clickable cells line up with the drawn tiles.
5. Update `game/README.md`.

## Rules
Run `npm ci`, `typecheck`, `test`, `build` and `e2e` from `game/`; all must pass. Commit on master with a clear message. Only touch `game/`. Reply in ≤8 lines: what changed and the script results.
