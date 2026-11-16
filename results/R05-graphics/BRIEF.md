# Round R05: make the game look great (graphics, animation, UI polish)

You are one of several independent implementers. Work alone, and don't look for other implementations.

`game/` contains the accepted build. It is an Electron/React/PixiJS tactics game with a deterministic Fire Emblem-style combat kernel, a Rule IR, SQLite saves, a Turnwheel, a headless T3 Code sidecar for content generation, a Providers & Models screen and generated chapters. Read `docs/SPEC.md` first, especially §1 and the "Art a small team can ship" part of §6. Then read `game/README.md` and the code.

**This round is about how the game looks and feels.** Today the visuals are functional but plain. The player wants a game that is genuinely nice to look at and pleasant to play, while staying readable. This round is large. Plan it, keep the build green as you go, and finish all of it.

## Goals
1. **A coherent art direction** that suits a game whose world, classes and units are generated on the fly. Pick a direction, write it down in ≤1 page (`game/ART_DIRECTION.md`) and apply it consistently. It covers palette, shapes, typography, materials and motion. The spec suggests an illustrated-atlas or board-game look; you may refine it.
2. **The battle map:** terrain that looks good and stays instantly readable (impassable, cover, elevation, hazards), tile edges, lighting/shading, and subtle ambient motion. Move ranges, attack ranges, threat/danger zones, paths and the hovered target must be clear but must not clutter the map.
3. **Units:** distinct, attractive units built procedurally from their data. Class, weapon and faction must be recognisable at a glance, and generated classes must look different from one another. Show HP and status clearly on the unit, and visibly distinguish units that have acted from those that have not.
4. **Animation and game feel:** movement along the path; attack, hit, miss and crit feedback; damage numbers; defeat; ability and status effects (e.g. Borrowed Second); phase changes; a readable, followable enemy phase. Use easing, keep timings snappy, and respect a reduced-motion setting.
5. **UI and screens:** the map dominates. Panels are compact, styled and consistent: the unit card, the forecast, the turn/phase indicator and the log. Give every screen the same visual language: title/main menu, new campaign and generation progress, Providers & Models, briefing, battle, victory/defeat/epitaph, and settings. Good typography and hierarchy, with no redundant information.
6. **Quality:** run smoothly (target 60 fps at 1920×1080 on a mid-range GPU), work at common window sizes, have sufficient contrast, and never rely on colour alone (colour-blind safe).

## Constraints
- **No hand-made or downloaded art and no external image services.** Everything is procedural or generated in code: vector shapes, shaders, gradients, noise, particles. **Exception:** fonts with an open licence (e.g. OFL), bundled locally with their licence file. Nothing may be loaded from the network at runtime.
- **Keep everything that works today:** all rules, saves, Turnwheel, generation, providers, the immediate attack with no confirm, bump-attack and the enemy-phase controls. Gameplay and resolution stay deterministic; the visuals are presentation only.
- Generation may use native agent tools (player decision); don't remove that.
- You do not need to run real provider generations in this round. Use local or fake chapters. **Do not** run live generations.

## Acceptance contract (run from `game/`)
| Script | Must do |
|---|---|
| `npm ci`, `npm run typecheck`, `npm run build` | exit 0 |
| `npm test` | all existing tests pass, plus tests for any new presentation logic that can be tested (e.g. the mapping from unit data to visual parameters, and determinism of procedural art for a given seed) |
| `npm start` | launches the built app |
| `npm run e2e` | everything that passed before still passes. Also: the board renders and clicks hit the right cells; reduced motion works; and **screenshots** of the main screens (main menu, new campaign, providers, briefing, battle mid-turn with ranges shown, enemy phase, victory or defeat) are saved to `game/docs/screenshots/` and committed |

Update `game/README.md` with a short visual overview that links to the screenshots.

## Rules
- Only create or modify files inside `game/`. Do not touch `docs/`, `rounds/`, `tools/`, `evidence/`, `video/` or `playtest/`.
- Never read anything under `%USERPROFILE%\.t3\` (the user's T3 installation), any `acp_token.json`, `.env` files, or credential/token files.
- **Do not leave game windows or processes running.** Close or kill exactly the processes you start once each check is done.
- Keep large caches and build outputs on drive D:, because drive C: is nearly full.
- Before finishing, run every script above from a clean `npm ci` and fix any failures. Then **commit** your finished work on your current branch.
- When done, reply in ≤12 lines: the art direction in one sentence, what you changed, the result of each script, and any known limitations.
