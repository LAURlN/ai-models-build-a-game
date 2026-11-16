# Round R02 — Milestone M1: empty repo → Windows micro-battle

You are one of several independent implementers. Work alone; do not look for other implementations.

Read `docs/SPEC.md` first (especially §1, §2, §6 and the M1 row of §8). It is the authoritative design. This round implements **M1 only**:

> Scaffold Electron/React/PixiJS and typed commands. Launch a 6×6 board with one ally/enemy; select, move, attack and end phases to victory/defeat. Concede and a finite expiry work. No external art or provider needed.

## Requirements

- New app in `game/` (create it). TypeScript, Electron, React, PixiJS, as the spec says. Windows 11, Node 24 / npm 11 are installed (no pnpm/bun). Pin dependency versions.
- Architecture must already follow the spec's direction so later milestones can build on it: game state changes only through **typed commands** handled by a pure, deterministic rules module (no DOM/Electron/wall-clock/global random in it); the renderer only displays state snapshots and sends commands; Electron security defaults (context isolation, sandbox, no node integration in the renderer, narrow IPC).
- Gameplay: 6×6 board, one player unit and one enemy unit with simple stats; select a unit, see its movement range, move, attack an adjacent enemy, end the player phase; the enemy acts in its phase (simple deterministic AI); victory when the enemy is defeated, defeat when the ally is defeated; **Concede** ends the battle in defeat; a **finite expiry** (turn limit) ends the battle when reached with a defined outcome. Clear victory/defeat screen with a way to restart. Readable procedural visuals (no external art files).
- Invalid commands (moving out of range, acting twice, acting during enemy phase, …) must be rejected without changing state.

## Required npm scripts (run from `game/`) — these are the acceptance contract

| Script | Must do |
|---|---|
| `npm ci` | install from the committed lockfile |
| `npm run typecheck` | type-check everything, exit 0 |
| `npm test` | unit tests of the rules module (commands, invalid commands rejected, victory, defeat, concede, expiry, determinism), exit 0 |
| `npm run build` | production build, exit 0 |
| `npm start` | launch the built Electron app on Windows |
| `npm run e2e` | launch the **real Electron app** headlessly-driven (e.g. Playwright `_electron`) and play through: one battle to victory, one to defeat, one concede, one expiry — asserting the end screens. Exit 0. |

Also add `game/README.md`: how to install, run, test, and a short architecture overview (≤1 page).

## Rules

- Only create/modify files inside `game/` (plus root `.gitignore` if needed). Do not touch `docs/`, `rounds/`, `tools/`, `evidence/`, `video/`.
- Do not read anything under `%USERPROFILE%\.t3\userdata\secrets\`, any `acp_token.json`, `.env` files or credentials.
- Before finishing, run every script in the table above yourself from a clean `npm ci` and fix failures.
- **Commit** your finished work on your current branch (one or a few commits).
- When done, reply with ≤10 lines: what you built, the result of each required script, and known limitations.
