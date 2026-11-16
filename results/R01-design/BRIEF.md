# Round R01 — Game design proposal

You are one of several independent designers. Work alone; do not look for or read other proposals.

## The product

A **Windows desktop** tactics RPG in the spirit of Fire Emblem (grid maps, turn-based phases, units with classes/stats/weapons, story chapters), but **open-ended and generated while playing**:

- At campaign start the player describes a setting in free text. Story, characters, maps, stats, abilities, classes, items, enemies and objectives are all generated on the fly by an LLM agent as the campaign unfolds.
- The player can write their own dialogue and story choices; the world, characters and later chapters should respond to them so the campaign develops naturally.
- The rule system must be built to support **many different, unique and complex mechanics** (the game should feel limitless in possibilities), while combat stays consistent, fair and fast.
- Generation runs through **the game's own fork of T3 Code running headless in the background** (T3 Code: open-source desktop GUI for coding agents, github.com/pingdotgg/t3code, TypeScript/Electron, orchestrates providers such as Codex, Claude, Gemini/Antigravity, OpenCode). The player picks **which providers/models** the game uses for generation, depending on what they have available.
- Exact mechanics are up to you. Visual style is up to you, but propose something that a small agent-driven team can actually ship and that does not depend on hand-made art.

## Your deliverable

Write **one file: `rounds/R01-design/out/DESIGN.md`** (create the folder). Markdown, as long as it needs to be but no padding (aim for something a senior engineer can read in ~20 minutes). Do not write application code in this round; short schema/interface snippets are fine. Cover:

1. **Vision & core loop** — what a session and a campaign feel like; what is fixed vs generated.
2. **Rules engine architecture** — how a deterministic engine can host open-ended, generated mechanics (e.g. effect/trigger systems, a constrained DSL, scripted abilities in a sandbox, …). Show how 3–4 concretely described unusual mechanics would be expressed. How generated content is validated, balanced and kept from breaking the game (bad numbers, infinite loops, softlocks, unwinnable maps).
3. **Content data model** — schemas for the generated entities (campaign/world state, chapter, map, unit, class, ability/effect, item, dialogue/event) and how canon/continuity/memory is stored.
4. **Generation pipeline** — how the game talks to the headless T3 Code fork (process model, API/protocol, what is forked vs used as-is, how provider/model selection works, prompts → structured output → validation → repair/retry). Latency strategy so the player rarely waits (pre-generation, staging, fallbacks), cost awareness, and behaviour when a provider is slow, refuses, or is unavailable.
5. **Player authorship** — how player-written dialogue/choices flow into canon and influence generation.
6. **Tech stack & app architecture** — language(s), desktop shell, renderer, packaging on Windows, persistence/save format, how the T3 fork is bundled and updated. Justify choices.
7. **Risks & open questions** — the hardest problems and how you'd de-risk them.
8. **Milestone plan** — 6–10 milestones from an empty repo to a playable vertical slice and beyond, each small enough for one agent session, each with concrete acceptance criteria (testable where possible).

## Rules

- You may research (web, the t3code repo, documentation). Cite sources for factual claims about external tools.
- Do not read anything under `%USERPROFILE%\.t3\userdata\secrets\`, any `acp_token.json`, `.env` files or credentials.
- Only create/modify files inside `rounds/R01-design/out/`. Do not commit.
- When done, reply with a ≤10-line summary of your key decisions.
