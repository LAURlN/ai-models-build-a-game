# R01 — The Chronicle Engine

## Vision and play

The player writes a setting premise: “a flooded empire where debts are inherited by ghosts.” The game turns it into a compact campaign bible, three starting companions and an opening battle. Between battles the player talks in their own words, chooses a destination, equips units and sees a short account of consequences. Each chapter is a tactical problem with a beginning, an objective and an aftermath; a campaign can continue until the player chooses an ending, retires the company, or loses under the selected defeat rules. A typical session is one battle and its surrounding conversations, with a save possible at every committed decision and between turns.

The fixed part is the contract: grid movement, turns, visibility, arithmetic, action economy, victory and defeat, content budgets, and the vocabulary in which mechanics are described. The generated part is the fiction and a bounded assembly of rules: geography, factions, people, classes, abilities, items, encounters, objectives and dialogue. Generated does not mean arbitrary executable code. New combinations can be surprising, but the player can inspect exactly what an ability will do before using it. The game never asks a model to adjudicate a combat action.

A readable 2D tabletop presentation is practical for a small team: orthographic square tiles, procedural terrain patterns, colored silhouettes with class glyphs, and text portraits composed from geometric shapes. Seeded palettes and icon combinations distinguish people and factions; high-contrast shapes, labels and tooltips prevent color being the only cue. No generated image or bespoke art is required. Story text stays short and skippable; combat information takes precedence over decoration.

## Rules as a safe language

The game host owns a deterministic simulation in TypeScript. A battle is a state machine: chapter start, alternating player and enemy phases, per-unit activation, resolution, phase end, and terminal outcome. A unit normally moves once and takes one action per activation. Attacks use integer stats, range and a deterministic hit/damage formula; weapons and effects declare exceptions in the same rule language. No combat randomness is needed for the first release: hidden information comes from fog or future spawns, not invisible dice. The enemy uses deterministic, bounded scoring over legal moves and resolves ties by stable entity ID. A replay is initial state plus ordered player commands and the fixed engine/content versions; animation and generation never mutate simulation state.

Content is data in a typed, versioned AST, not JavaScript or model-authored code. Nodes include selectors (self, target, allies in radius, tiles, tagged objects), integer expressions with capped arithmetic, predicates, and effects (damage/heal, add/remove status, modify a bounded stat, move, create/remove a declared terrain token, spend/gain resource, set a counter). Triggers observe named events such as `on_move`, `before_attack`, `after_damage`, `phase_start`, and `unit_defeated`; each trigger has an explicit scope, priority, duration, and per-event or per-phase firing limit. Effects execute in a stable queue ordered by event sequence, priority, source ID and definition ID. An attack resolves legality, payment, pre-attack modifiers, damage, post-damage events, deaths and objective checks in that order. A modifier cannot retroactively change an already committed event. Definitions are immutable during a battle.

Example DSL fragments below are illustrative; compiler-checked fields, not prose, determine behavior:

```yaml
# A ferryman leaves a wake; the next ally to cross it gains movement.
on: after_move
when: {actor: self}
do: {create_tile_token: wake, at: traversed_tiles, duration: 1_phase, max: 4}
---
on: enter_tile
when: {actor_relation: ally, tile_has: wake}
limit: once_per_activation
do: [{remove_tile_token: wake}, {grant_move: 1, cap: 1}]
```

```yaml
# Debt collector: damage now, collateral later; defeat clears the contract.
on: after_attack
when: {actor: self, target: enemy, hit: true}
do: {apply_status: debt, target: target, duration: 2_enemy_phases, stacks_max: 1}
---
on: phase_start
when: {status: debt, actor: status_holder, source_alive: true}
do: {damage: 2, target: status_holder, tags: [debt_tick]}
```

```yaml
# A guardian can intercept one adjacent ally's attack per phase.
on: before_damage
when: {target_relation: ally, distance_to_target_lte: 1, source_alive: true,
       damage_tag_excludes: intercepted}
limit: once_per_phase
do: {redirect_damage: {to: self, add_tag: intercepted}}
```

```yaml
# A lantern trades safety for information: reveal a region and create costly light.
action: {range: 0, cost: {charges: 1}, cooldown: 2_phases}
do:
  - {reveal: {radius: 3, duration: 2_phases}}
  - {create_tile_token: lit, at: tiles_in_radius_2, duration: 2_phases, max: 13}
# lit: units on it take +1 damage from attacks; token does not stack.
```

The vocabulary grows through reviewed engine releases, not through generated native extensions. This supports elaborate combinations but cannot express literally every imagined mechanic; unsupported requests are translated into the nearest supported effect and shown to the player as such. Definitions carry player-facing descriptions generated from the AST and an expanded event trace in the battle log, so text cannot promise a rule the engine does not implement.

### Safety, balance and solvability

A compiler rejects unknown schema versions, operators and references; invalid types, targets, durations, ranges and budgets; contradictory objectives; and descriptions that do not match mechanically generated text. IDs are unique, references resolve, effects are total, and numeric ranges are enforced independently of the model. A static trigger graph flags zero-cost cycles and rejects unbounded self-triggering. At runtime each root action has bounded queue depth, total effects, affected entities and spawned tokens; triggers have explicit firing caps. Resolution is transactional: a budget violation rolls the whole action back, reports an error and disables the offending generated definition for that encounter using a prevalidated replacement. Never silently truncate a partly applied chain.

A point budget estimates value from damage, range, area, uptime, restrictions and resource costs. Chapter difficulty also budgets enemy stats, counts, terrain, reinforcements and objective pressure relative to the actual available roster; clamps and conservative defaults apply even when an estimate is wrong. Run fixed-seed simulations with several simple policies and a search with a fixed node/time budget; flag outliers for repair. Simulations are evidence, not proof of balance or a win. Ship telemetry only with consent; local battle outcomes can inform optional difficulty suggestions without changing rules mid-battle.

A map validator checks dimensions, spawn capacity, terrain passability, reachable exits/objectives for the eligible roster, sufficient turn limits, and coherent event dependencies. A bounded solver finds a legal plan for simplified objective and movement constraints including doors, switches and mandatory spawns; then actual-engine playthroughs test the encounter. A timeout is inconclusive, never proof of solvability. Maps without a found witness are repaired or replaced with a curated template and a known safe objective; templates have valid paths for the current movement profiles and are checked again at runtime. Because tactical adversaries can still defeat the player, offer restart, difficulty adjustment before retry and a campaign-safe retreat with stated consequences; do not claim a guaranteed combat win. Never delete the only available required unit or item without a replacement route. Generated irreversible events require an explicit player choice and a pre-event checkpoint.

## Content and memory

Every document has `schemaVersion`, stable IDs, provenance (generator/model identifier if available, prompt/template version, input-state hash), and content hash. References are IDs, not names; names may change without breaking references. A compact conceptual schema:

```text
Campaign {id, seed, rulesVersion, premise, bible, facts[], relationships[],
          rosterIds[], inventory[], chapterHistory[], flags{}, currentChapterId,
          worldClock, difficulty, branchId, revision}
Fact {id, claim, subjects[], kind: established|rumor|intention,
      sourceEventId, confidence, validFrom, supersedes?, visibility}
Chapter {id, title, setup, mapId, objectiveIds[], encounterUnitIds[],
         eventIds[], rewards[], exits[], requiredStateHash, status}
Map {id, width, height, tiles[], terrainDefs[], playerSpawns[], enemySpawns[],
     objects[], fog, movementWitness, templateId?}
Unit {id, name, factionId, classId, stats{}, growth{}, abilityIds[],
      inventoryIds[], position?, resources{}, statuses[], alive, tags[]}
Class {id, name, baseStats{}, movementProfile, weaponTags[], abilityIds[], tags[]}
Ability {id, name, ast, costs{}, limits{}, tags[], generatedRulesText}
Item {id, name, slot, uses?, statModifiers{}, abilityIds[], tags[]}
Event {id, trigger, guards, choices[], effects[], dialogueIds[], once, fallback}
Dialogue {id, speakerId?, lines[], audience, contextFactIds[], choices[]}
Objective {id, type, parameters, successPredicate, failurePredicate?, turnLimit?}
```

World facts are append-only records with source and visibility. A correction supersedes a prior fact rather than erasing history; rumors and character intentions are not promoted to truth without an in-world event. Relationships are typed, bounded values plus evidence events, not free-form claims alone. Character knowledge is separately scoped from omniscient canon, allowing lies and secrets. Chapter events, battle results and player statements form an ordered event journal; a materialized state is rebuilt or checked against that journal. Summaries are disposable indexes with links back to facts, never the sole source of canon. Retrieval for a generation request includes the immutable premise and rules, current state, relevant entities and relationship facts, unresolved commitments, recent events, and a bounded summary. A continuity validator checks IDs, dead/alive status, chronology, inventory and exclusive facts; ambiguous prose is flagged for review or softened, not automatically treated as a contradiction.

## Generation and the headless fork

The desktop host owns saves, deterministic rules and all provider permissions. A supervised local child process runs a pinned build of the game's T3 Code fork headlessly. The fork exposes a narrow, versioned local transport over a Windows named pipe with a random per-launch capability; the host creates it and only accepts messages for its session. Messages have request ID, protocol version, kind, deadline, cancellation, payload and terminal status; responses are `progress`, `result`, `error` or `cancelled`. Large payloads are bounded, validated and never interpreted as shell commands. Child crash or restart cannot corrupt a save: only the host can commit validated content, via an atomic state revision check. Requests are idempotent by ID, and late results whose input state hash is stale are discarded or revalidated against the new state.

The fork's exact internal seams and licensing must be verified against a pinned upstream revision before implementation. Intended fork work is headless lifecycle, adapter and restricted local protocol, provider configuration, cancellation, packaging and disabling any agent tools that could touch arbitrary files, execute commands or access the network except the selected provider. Reuse upstream provider orchestration only where the audit confirms it can operate under those restrictions; otherwise implement a narrow adapter around the supported integration. Generated content is untrusted data, never an instruction to the host or an authorization to invoke tools. Player text is quoted as data and may influence fiction, not system rules. Do not ship upstream credentials or read unrelated agent configuration without explicit consent. The player selects available provider and model per job category, enters or authorizes credentials through a provider-appropriate flow, and sees availability, estimated cost when available and usage after a job. Secrets live in Windows credential storage, are passed only to the provider process as needed, and never enter saves, prompts, logs or crash reports. No provider is assumed present; offline play can continue from cached, already validated content and templates.

For each job the host constructs a minimal immutable snapshot and a task-specific prompt with schema, hard rules, permitted IDs and an output size limit. The provider returns structured JSON; streaming is progress only, not committed canon. The host parses, validates schema and references, compiles rules, checks continuity and map safety, evaluates budgets and runs bounded simulations. A repair request includes precise machine-readable errors and the same immutable snapshot, with a small retry and time budget. If repair fails, fall back to a locally bundled validated template populated from safe current-world entities; disclose the fallback where it affects story quality. A candidate becomes visible only after validation, and is committed atomically with the matching campaign revision. Cache by snapshot hash, rules version and job spec; do not reuse a candidate after a meaningful state change without revalidation.

While the player fights, generate several low-cost chapter skeletons and reusable encounter parts based on likely exits, then detail the chosen branch after its prerequisites are known. Use speculative content only as drafts: it cannot assert future player decisions. Prioritize next interaction over distant lore, bound concurrency and cancel obsolete jobs. Before an open-ended scene, stage a generic but coherent local response and next encounter, so a slow provider does not halt play. If a provider is slow, offer continue with fallback or wait; on refusal, preserve the player's input, explain that generation failed without inventing a reason, and offer revision, another configured model or fallback. On unavailable service, retry with backoff within a visible deadline, then use cached/template content. Never switch to a paid provider without the player's configured permission. Set per-job and campaign spending caps, estimated-token limits, and clear indicators when pricing or actual cost is unknown; estimates are not guarantees.

## Player authorship

A dialogue box accepts free text as well as suggested choices. On submission the exact text is preserved as a player utterance with speaker, audience and time; it becomes canon that the character said it, not that every claim is true or that the world obeyed it. The model proposes structured interpretations: intent, relevant facts, possible NPC reactions and proposed consequences. The host validates references, permissions and mechanical effects. The player sees the response and consequential choice before any irreversible effect is committed. NPCs can disagree, misunderstand or refuse; the interface distinguishes their speech from established world facts. A failed generation keeps the utterance as a draft until a response or fallback is accepted, avoiding a half-committed scene.

A successful exchange commits utterance, reaction, accepted effects and resulting facts together as one journal transaction. Later retrieval includes relevant dialogue and unresolved promises, and future chapters can reference them. If the player says something impossible, the world can respond to the attempt without rewriting prior history. A player-editable campaign journal can correct names or mark a summary wrong through explicit revision events; such edits do not silently alter past combat. Checkpoints and branching saves allow experimentation without rewriting a different branch.

## Application architecture and delivery

Use TypeScript throughout for shared schemas and deterministic simulation, with an Electron desktop shell, React UI and Canvas/WebGL tile renderer. The renderer consumes immutable snapshots and issues commands to the host over a narrow validated IPC interface; it cannot directly access saves, providers or Node APIs. Simulation runs in a worker with no wall-clock, filesystem, network or random global state; command execution is serialized. Rendering and audio are independent of simulation ticks. Pin dependencies, enable Electron isolation and sandboxing, restrict navigation and IPC, and sign Windows installers and updates when release infrastructure exists.

Persist per-campaign SQLite databases in the user's application data directory: schema migrations, journal, snapshots, content definitions, generation provenance and checkpoints. Transactions commit decisions and revisions atomically; save files contain no credentials. A portable export is a versioned archive of the database and referenced assets, with checksums and size limits on import. Keep backups before migrations and allow old campaigns to run on their pinned rules version where practical; otherwise require an explicit migration and preserve the original. Test crash recovery during commit and child process termination.

Bundle the pinned headless fork as a separate versioned executable or packaged process with its dependency/license notices; the app checks protocol compatibility at launch. Update it together with the host through signed, versioned releases and roll back both if compatibility fails. Never automatically update a provider adapter in the middle of a generation job or active battle. Audit upstream licenses, dependencies, provider terms and actual headless capabilities before relying on this distribution plan.

## Risks and decisions to validate

- **Expressiveness versus predictability:** A finite DSL cannot realize all requests. Prototype the four examples plus ten disparate player ideas; measure which need new primitives and whether generated explanations remain readable.
- **Encounter fairness:** Heuristics and bounded search do not prove tactical fairness. Build a corpus of maps, roster profiles and failure cases; test with humans, expose difficulty and preserve retreat/retry.
- **Continuity and authorship:** Models can misstate facts or interpret intent badly. Test contradictory claims, lies, dead characters and promises across many chapters; keep evidence and expose correction and branching.
- **T3 integration and security:** Headless support, provider APIs, licensing and tool isolation are assumptions until audited. Build a minimal pinned proof of concept first; treat inability to disable unsafe tools as a release blocker.
- **Latency, cost and availability:** Measure p50/p95 chapter generation and repair across configured providers. Set an explicit wait budget after measurements and ensure every required transition has a tested local fallback.
- **Long-term compatibility:** Generated definitions may outlive an engine release. Version the DSL and replay fixtures; test migrations and retain compatible interpreters or offer an explicit campaign export and retirement path.

## Milestones

Each milestone is scoped as one focused agent session with fixtures and documentation included; a session may produce a deliberately narrow implementation rather than a production-ready subsystem.

1. **Contracts and safety spike.** Define versioned command, state, DSL and generation protocol schemas and a minimal fixture campaign. Acceptance: fixtures validate; malformed references and unknown versions fail with actionable errors; T3 audit records pinned revision, license and headless/tool-isolation feasibility.
2. **Battle kernel.** Implement grid movement, action economy, deterministic attacks and victory/defeat in a headless test. Acceptance: identical fixture and command log produce byte-identical final state; illegal commands leave state unchanged.
3. **Effect interpreter.** Add bounded events, statuses, selectors and transactional resolution. Acceptance: all four example mechanics execute with expected logs; a cyclic trigger is rejected or rolls back within the specified budget.
4. **Playable encounter UI.** Render a small map, inspect units, issue moves and attacks, and show rules text and event log. Acceptance: a player can complete a fixed encounter with keyboard and mouse and restart it; information is readable without relying on color.
5. **Encounter validation.** Add schema, budget, connectivity and bounded objective-witness checks with a safe template. Acceptance: disconnected and contradictory fixtures are rejected, solver timeout falls back, and a valid roster can reach the template objective.
6. **Persistence and canon.** Implement journal, snapshots, save/load, checkpoints and fact retrieval. Acceptance: reload reproduces battle and story state, a correction preserves provenance, and interruption during a transaction yields either the old or new state.
7. **Headless generation adapter.** Launch the restricted fork and perform one structured generation job with cancellation and repair. Acceptance: a configured provider returns validated content; invalid JSON, refusal, crash, timeout and stale response are handled without corrupting the campaign; unsafe agent tools are inaccessible.
8. **Authored dialogue and vertical slice.** Generate a premise, companions, one chapter and aftermath; accept free-text dialogue and commit its response. Acceptance: a player finishes the battle, sees an authored statement referenced in aftermath, saves/reloads, and completes the same flow with provider unavailable using local fallback.
9. **Campaign expansion and release hardening.** Add branching chapters, pre-generation, cost controls, migrations and Windows packaging. Acceptance: a multi-chapter campaign survives branch changes and an interrupted generation; spending limits and fallback are visible; a clean Windows install, export/import, upgrade and rollback pass documented smoke tests.
