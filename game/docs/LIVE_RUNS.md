# Live runs (R06)

All runs went through the game's own sidecar (`scripts/live-story.mjs`, fresh temp
`--base-dir`; `%USERPROFILE%\.t3` untouched, no credentials read by the game). Provider:
Codex, model **gpt-6.1-terra**, effort **low**, Narrator and helpers in agent mode (native
tools in the campaign workspace). Budget: 10 model calls in total — **10 used**.

| # | Calls | Purpose | Result |
| --- | --- | --- | --- |
| 0 | 0 | `--check-only`: is a provider authenticated inside the isolated sidecar? | `codex=authenticated`, `claudeAgent=authenticated`, antigravity not installed. Nothing sent. |
| 1 | 4 | Creature-catching setting (tide-pool archipelago): opening, then ask for capture + storage. | Opening Narrator turn (23.6 s) established Odile and partner Kelpip with setting-specific stats (`nerve/shell/current/skl`) and **spawned 3 helpers in parallel** (52–81 s each). All three modules loaded first time: a 6-species bestiary (6 weapons, 12 abilities, 4 statuses, custom AI, panel), a tide-wrangling capture + creature-storage system (5 abilities, 5 commands, panel) and an exploration/tides system. The budget ran out before the player message was answered. Offline check afterwards (no model calls): a 38-unit battle built from the 9 generated species played 6 rounds with no module faults; weapon kinds `net/kelp/tide/creature`. |
| 2 | 4 | Cozy farm with wolves: opening, then "the wolves are coming — defend the flock". | Opening spawned 2 helpers (farm/market: 7 commands + panel; flock/ridge: sheep and wolf templates, herding abilities, wolf AI, 7 commands, panel, a sound). The Narrator then staged **"Wolves at Greywillow"** as an inline spec using the generated `gw-ridge-wolf` template, three factions (party, flock, wolves) and a rout-or-survive-6-rounds objective; the flock module's own `battle:build` hook added the sheep (11 units). Battle started 129 s after the campaign began. **Findings:** helpers left starting coins/seeds "unknown"; a world log line contained meta text ("the story must decide…"); the battle announcement doubled a period. |
| 3 | 2 | System apocalypse, after prompt tuning: opening only, checking the tuned helper guide. | Narrator opened in Lisbon at 9:14 and queued 3 helpers (progression, Battle Net, monsters). The progression helper now **seeded a playable state** (level 1, XP, `first-contact` quest active, rank) and logged in-world ("[System] PROFILE ONLINE…"). The other two helpers were stopped by the harness budget cap (shown as failed tasks, story unaffected). |

**Tuning applied from these runs** (`src/main/world/prompts.ts`, `worldHost.ts`):
- Helpers must seed a sensible starting state in `module:installed` instead of leaving values unknown.
- `ctx.log` / float / panel text must be in the world's voice, never notes to the Narrator.
- The Narrator is told that battle scale should follow the fiction (hordes and stampedes may be dozens of units on big maps; duels may be tiny or non-grid).
- Battle announcement no longer doubles the objective's final period.

Observed latency (gpt-6.1-terra, low): Narrator turns 16–24 s; helper agents 51–88 s,
running in parallel while the chat stayed usable. Every run produced setting-specific stat
names, weapon kinds and systems; none fell back to sword/lance/axe/bow/tome.
