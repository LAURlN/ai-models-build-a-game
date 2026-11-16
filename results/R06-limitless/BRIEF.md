# Round R06: limitless campaigns (sound, endless campaigns, unrestricted generation)

You are one of several independent implementers. Work alone, and don't look for other implementations.

`game/` contains the accepted build: an Electron/React/PixiJS tactics game. It has:
- a deterministic Fire Emblem-style combat kernel, a Rule IR, SQLite saves and a Turnwheel;
- a headless T3 Code sidecar for content generation, with a Providers & Models screen;
- generated chapters, and a polished procedural art direction (`game/ART_DIRECTION.md`).

Read `docs/SPEC.md` (the original vision), `game/README.md`, `game/ART_DIRECTION.md` and the code first.

**This is the biggest round so far: three goals in one.** Plan it, keep the build green as you go, and finish all of it.

## The player's vision (read this carefully; it overrides older, more cautious parts of the spec)

> It should truly feel limitless. Right now it's always one guy with a bow, one with a sword, one with a tome and one with a lance, sometimes one with an axe, and the skills are always some variation of "pay some HP to get an extra turn".
>
> There should be no restrictions on the number of units, map size, kinds of weapons, kinds of skills, spells, passive abilities, active triggerable abilities, the number of abilities on one unit, etc.
>
> There needs to be far more trust in the AI building the custom content and less worry about something breaking and about safety. It's meant for me to play. I have AI agents with admin rights doing things on my PC all the time; there is no problem with giving the AI in the game the tools it needs to make cool custom content.
>
> Everything should be possible: a Pokémon-style adventure where the AI has to build a catching and storage system on the fly, a system-apocalypse battle net, a cozy farm roleplay where wolves attack from time to time.

## Goal 1: the gameplay loop is a narrated, open-ended campaign
1. The player describes a setting, then **chats/roleplays with a Narrator AI**. Both the Narrator's provider and model and the helpers' are configurable on the Providers & Models screen.
2. The campaign has **open length**: it continues for as long as the player wants, across any number of scenes and battles. The world state persists:
   - roster, inventory, relationships, factions, places, story memory and generated content;
   - all of it saved in the save system and resumable after restart.
   Long campaigns need memory: summaries, retrieval or whatever works, so the Narrator stays consistent after dozens of scenes.
3. The Narrator can **start a battle at any time**. The battle is generated to fit the story; it is then played, and its outcome flows back into the story: deaths, captures, loot, consequences.
4. During roleplay, the Narrator can freely **create or edit any content**: units, classes, skills, items, rules, systems, maps, visuals, sounds. It does this by **spawning helper agents** (subagents) through the sidecar, in parallel when useful, in the background while the chat continues.
   - Helpers can **read the full Narrator↔player chat history** and the campaign state for reference.
   - The player sees what is being built, unobtrusively (e.g. an activity feed). Nothing blocks the chat unless a battle needs content that isn't finished yet.

## Goal 2: generation without limits
- **Content is code, not just data.**
  - Give generated content a real extension API: generated TypeScript/JavaScript modules (or an equivalent) that the game loads at runtime.
  - Modules hook into everything: turn flow, movement, targeting, damage and combat resolution, status effects, triggers and reactions, AI behaviour, win/lose conditions, the map, the UI (new panels, screens, menus, inventories, e.g. a creature storage box), and new resources and meta-systems (catching, crafting, farming, levelling schemes, shops, relationships…).
  - The Rule IR may stay for simple cases, but it must not be a ceiling.
- **Battles are not limited to the current format.** Grid tactics is the default, but generated systems may add new mechanics and new encounter modes, including non-grid ones if the story calls for it.
- **No fixed caps**:
  - not on units per side, map size, weapon kinds, ability count or kind, or factions;
  - no hard-coded weapon triangle or class list that generation must pick from.
  - Make sure the engine, renderer and AI scale to large battles (e.g. 40+ units on big maps).
- **Trust the AI. Remove restrictive validation and allow-lists.**
  - The game's agents get **full native tools**: shell, file read/write and code execution in the campaign's workspace.
  - Validation exists only to keep the game running, not to restrict what content may do. If a generated module throws or fails to load, the game catches it, shows it, keeps playing, and **automatically sends a helper to repair it** using the error.
- **Variety by design.** Prompts, tools and examples must push the AI toward content specific to the setting, not generic fantasy archetypes.
  - Concretely, the three example settings above must produce structurally different games, not reskins of sword/lance/axe/bow/tome.
  - Write the system prompts and tool docs so that a capable model knows the whole extension API and is encouraged to use it.
- **Graphics stay procedural/code-drawn**: no image-generation APIs. Generated content can ship its own visual code (Pixi/SVG/shader drawing for units, tiles, effects, UI) that fits `ART_DIRECTION.md`, with good defaults when it ships none.
- **Determinism and the Turnwheel must keep working with generated code.**
  - Give modules a seeded RNG and the APIs they need, and use state snapshots where pure replay isn't possible.
  - The Turnwheel still rewinds battle turns, and saves still round-trip.

## Goal 3: sound design
- Good, coherent **procedural audio**: WebAudio synthesis or similar, with no downloaded or recorded files and nothing from the network.
  - Sound effects for UI, movement, attacks, hits/misses/crits, defeats, abilities and statuses, and phase changes, plus victory/defeat stingers.
  - **Adaptive music** that fits the scene (calm roleplay vs. battle tension).
- Generated content can define its own sounds or music through the extension API, with sensible defaults otherwise.
- Settings: master, music and effects volume, plus mute. They are persisted. Respect reduced-motion-style preferences where relevant.
- Add a short sound section to `ART_DIRECTION.md`.

## Keep
- The existing look and polish, the immediate attack with no confirm, bump-attack, the Turnwheel, the visible enemy-phase animation and its controls, saves, Providers & Models, and the native tools for generation.
- The orphan-free sidecar cleanup on Windows (Job Object).
- The game must not touch the user's own T3 installation (`%USERPROFILE%\.t3`).
- The player's design taste:
  - no winnability or fairness checks; game over is allowed;
  - the map dominates and panels are compact;
  - ranges, stats and mechanics are clearly communicated, and new mechanics give visible feedback.

## Live generation while developing
- You **may** run up to **10 real generations** in total to tune the Narrator, helpers and prompts. Use a cheap setting only: `gpt-6.1-terra` or `gpt-6.1-sol` at **low** effort, via the game's own sidecar.
- If provider auth isn't available to the game's sidecar, document that and continue with fakes. Do not read the user's credentials.
- Log every live run, with its purpose and result, in `game/docs/LIVE_RUNS.md`.

## Acceptance contract (run from `game/`)
| Script | Must do |
|---|---|
| `npm ci`, `npm run typecheck`, `npm run build` | exit 0 from a fresh clone |
| `npm test` | all existing tests pass, plus tests for: the extension API (loading, hooks, error isolation and repair flow), large battles (scale), the campaign state round-trip across multiple battles, the Turnwheel with generated code, and the sound settings/cue mapping |
| `npm start` | launches the built app |
| `npm run e2e` | everything that passed before still passes. Also: with a scripted fake provider, a full loop runs: setting → Narrator chat → a helper builds a novel system mid-chat (e.g. creature catching with a storage UI) → the Narrator starts a battle using it, with many units, a big map, and a non-standard weapon and ability → the result feeds back → a second battle in the same campaign → save, restart, resume. Save screenshots of the new screens to `game/docs/screenshots/` |

Update `game/README.md`: the gameplay loop, the extension API (with a short example module), the helper agents, and how to configure the Narrator and helper models.

## Rules
- Only create or modify files inside `game/`. Do not touch `docs/`, `rounds/`, `tools/`, `evidence/`, `video/` or `playtest/`.
- Never read anything under `%USERPROFILE%\.t3\`, any `acp_token.json`, `.env` files, or credential/token files.
- **Do not leave game windows or processes running.** Kill exactly what you start once each check is done.
- Keep large caches and build outputs on drive D:; drive C: is nearly full.
- Before finishing, run every script above from a clean `npm ci` and fix failures. Then **commit** on your current branch.
- When done, reply in ≤15 lines covering:
  - the architecture of the extension API, in two sentences;
  - the Narrator/helper loop;
  - the sound approach;
  - each script's result;
  - your live runs;
  - known limitations.
