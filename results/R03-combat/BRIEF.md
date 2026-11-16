# Round R03 — Fire Emblem combat kernel, first Rule IR mechanic, saves and Turnwheel (M2 + M3 + M6)

You are one of several independent implementers. Work alone; do not look for other implementations.

`game/` contains the accepted M1 build: an Electron/React/PixiJS micro-battle with a pure rules module, typed commands, bump-attack and auto end turn. Read `docs/SPEC.md` first. It is authoritative, especially §2 (rules engine, resolution semantics, combat formulas, Rule IR, the "Borrowed Second" recipe), §3 (data model), §6 (stack, saves) and the M2, M3 and M6 rows of §8. Read `game/README.md` and the code before changing anything. This round is large. Plan your work, keep the build green as you go, and finish all of it.

## 1. Battle content (needed to exercise the kernel)
- One hand-authored battle on a **10×10 map** with terrain that matters: at least impassable tiles and one cover/avoid terrain. **4 player units vs 5–6 enemies.**
- At least **3 classes with different weapons/ranges**, including one ranged (2-range) unit.
- A simple deterministic enemy AI that chooses targets sensibly. Keep the victory, defeat, concede and expiry endings.

## 2. M2 — FE combat kernel and forecast (SPEC §2)
- Implement the spec's combat formulas with **seeded, deterministic hit/crit rolls**, **counterattacks** (range-aware), and **follow-up attacks**, using integer math only.
- The **forecast** (HP before→after, hit %, crit %, number of strikes and the triggers that will fire) must use exactly the same code path as the resolution, so the forecast never lies.
- **Attack UX:** select a unit → move → choose **Attack** → valid targets are highlighted → hovering or selecting a target shows the forecast card → confirm. **Bump-attack** (moving into an enemy) must keep working and must also show the forecast before resolving, for example as a confirm step.
- Forced-branch fixtures (forced hit, miss, crit, counter and follow-up cases) must match the forecast explanations. Identical 20-command logs must produce identical state hashes. Invalid commands must change nothing, including the RNG position.

## 3. M3 — first Rule IR slice: "Borrowed Second" (SPEC §2 recipe)
- Implement the statuses, counters, expiry, action grants and **root transactions** this recipe needs, as data compiled from the spec's Rule IR, not as hard-coded special cases.
- Give one player unit the ability. The debt must clear on a kill or apply at the exact expiry.
- Cyclic or oversized rule fixtures must be rejected, or must roll back costs and RNG completely.
- Ability tooltips must be generated from the compiled rule data.

## 4. M6 — saves and Turnwheel (SPEC §6)
- Persist the full command log and state in **SQLite**. Use any approach that works in Electron on Windows, and document it.
- Save, quit the app, relaunch, and load must restore the **identical state hash**.
- **Turnwheel:** rewind up to 3 times per battle. Rewinding does not refund spent charges and does not reroll identical actions.
- An interrupted save commit must leave either the old save or the new one intact, never a broken one.

## Acceptance contract (run from `game/`)
| Script | Must do |
|---|---|
| `npm ci`, `npm run typecheck`, `npm run build` | exit 0 |
| `npm test` | Unit tests covering: combat formulas, forecast and outcome equivalence on the forced-branch fixtures, determinism (state hash over a 20-command log), invalid commands, Borrowed Second (clear on kill, apply on expiry, rejection and rollback fixtures), save/load round trip, and the Turnwheel. Exit 0. |
| `npm start` | launches the built app |
| `npm run e2e` | Drives the **real Electron app** and checks each item below. Exit 0. |

Items `npm run e2e` must check:
- (a) The board canvas really renders, with non-background pixels, and clicking drawn tiles hits the right cells.
- (b) An attack via Attack → target → forecast → confirm, and the HP shown afterwards matches the forecast branch.
- (c) A bump-attack.
- (d) Using Borrowed Second.
- (e) Save → quit → relaunch → load gives the same state.
- (f) A Turnwheel rewind.
- (g) At least one battle played to victory and one to defeat.

Update `game/README.md` (how to run and test, plus an architecture overview of no more than one page).

## Rules
- Only modify files inside `game/` (plus the root `.gitignore` if needed). Do not touch `docs/`, `rounds/`, `tools/`, `evidence/`, `video/` or `playtest/`.
- Do not read anything under `%USERPROFILE%\.t3\userdata\secrets\`, any `acp_token.json`, `.env` files or credentials.
- Before finishing, run every script above from a clean `npm ci` and fix any failures.
- **Commit** your finished work on your current branch.
- When done, reply with ≤12 lines: what you built, the result of each script, and any known limitations or spec deviations.
