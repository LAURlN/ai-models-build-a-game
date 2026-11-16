# Chronicle Tactics — merged game specification

Authority: `USER_VERDICT.md` overrides proposal and review recommendations. H = Hydrogen, S = Sol, T = Terra. This specification defines the product; milestones deliver narrow increments toward it.

## 1. Vision & core loop

**A Fire Emblem–style campaign in a world the player describes, with battles adjudicated locally and a chronicle that remembers the player's words.** A genesis prompt such as “a sunken brass empire whose inquisitors tax memories” establishes the setting. Tone sliders control gravity, political intrigue, supernatural strangeness and descriptive intensity. A challenge preference guides generation without promising balanced encounters.

Opening generation establishes world laws, factions, a protagonist and three retainers. The player chooses two generation slots from the embedded server's discovered providers/models: **Architect** for worlds, chapters and mechanics; **Chronicler** for conversation, intent and repair. Both slots can use one model.

A session lasts approximately 20–35 minutes:

1. **Camp:** inspect companions, equipment, progression, promises and world clocks; converse through suggested choices or free text.
2. **Briefing:** examine objectives, stakes, deployment, enemy rules and new mechanics. A miniature engine-driven demonstration explains an unfamiliar rule on demand.
3. **Battle:** Player → Enemy → Ally/Hazard phases, normally 10–20 minutes. Target maps are 12×10 through 22×18, starting with four deployed allies. Objectives include rout, seize, boss defeat, survive, escort, escape, sabotage and hybrids.
4. **Aftermath:** commit casualties, resources, commitments and territorial changes; present their account and the next situation. Pre-staged material accelerates continuation.

Campaigns unfold in renewable short arcs with opportunities to conclude or retire the company. Earlier choices can remove recruits, destroy bridges, surrender supplies or empower enemies. Burning a bridge before evacuating a family can make a later rescue impossible; betraying a faction can lead to an overwhelming siege. Neither outcome is repaired toward a win. Retreat, capture and lost opportunities continue a campaign only when the published outcome table provides them. Other defeats end it.

**Game over** freezes the final state, shows the decisive events and their links to earlier choices, and presents a locally available epitaph even if generation is offline. The journal remains readable. The player can close the campaign, begin another, or explicitly branch from a saved checkpoint; branching preserves the failed history. No automatic rescue, replacement key, revived companion or softened enemy is inserted.

Fixed contracts are the grid, phases, nine stats (`HP, Str, Mag, Skl, Spd, Lck, Def, Res, Mov`), combat formulas, Rule IR vocabulary, objective operators, interpretation semantics, presentation grammar and technical limits. Generated content includes geography, cast, classes, progression, weapons, items, statuses, abilities, terrain, enemy plans, objectives, dialogue and consequences. Unique mechanics have **no chapter or campaign count cap**. New primitives arrive through versioned engine releases; unsupported inventions receive an explicit supported interpretation before publication.

## 2. Rules engine architecture

### Combat contract and forecast

Use an orthogonal square grid and Manhattan range. Movement spends terrain costs; weapons declare range and line-of-sight requirements. Each unit receives one move and one action per own phase; acting ends remaining ordinary movement. Legal counters occur when the defender survives, has an equipped weapon covering the attacker and is not prevented from countering. Attack speed is `AS = Spd - max(0, weaponWeight - Str)`; an AS advantage of at least four grants one follow-up. Exchange order is initiator, defender counter, then the eligible faster unit's follow-up. Every strike rechecks life, range and counter permission.

Base physical damage is `max(0, Str + weaponMight - Def - terrainDefense)`; magical uses `Mag/Res`. Hit basis points are `clamp(100×weaponHit + 200×Skl + 100×Lck - 200×targetAS - 100×targetLck - terrainAvoidBP, 0, 10000)`. Crit is `clamp(100×weaponCrit + 100×floor(Skl/2) - 100×targetLck, 0, 10000)`. Roll hit first, then crit on a hit; a critical multiplies the base packet by three before rule modifiers. Weapon tags select a fixed advantage table: advantage adds 1 might and 1500 hit basis points; disadvantage subtracts those amounts. Generated weapons choose tags, not new arithmetic.

The **Tactical Forecast Card** shows HP change per connected strike, hit/crit chances, counter/follow-up order, costs, delayed liabilities and named trigger predicates. Unconditional triggers appear directly; conditional ones sit under exact branches such as “on hit” or “if target dies.” Random outcomes remain undisclosed until resolution. The forecast uses the same interpreter on cloned state; tests compare each forced random branch with its corresponding actual resolution. It never promises a single HP result for a probabilistic exchange. Hovering consumes no live randomness.

**Turnwheel** supplies three rewinds per map to committed command boundaries. It restores units, queues, schedules, counters, drops and PRNG position. Its spent-charge ledger sits outside the restored state, preventing charge refunds. Identical commands after rewind produce identical rolls. It cannot undo published campaign scenes; older campaign checkpoints create explicit branches.

### Typed Rule IR

`rules-core` is a pure TypeScript kernel used by play, forecast, enemy planning and replay. It imports no provider, filesystem, clock or renderer. Generated rules are versioned typed JSON ASTs, never executable scripts or expression strings. A definition contains activation, target, costs, declared variables, listeners, presentation and compiled operational text. Each listener declares hook, event scope (`ownerActor`, `ownerTarget`, `ownedStatus` or `global`), priority, guard, `maxPerRoot` and `maxPerPhase`; missing limits are invalid. Active costs include action credits, HP, item charges and named resources; cooldowns use absolute phase ordinals.

The following is the closed initial vocabulary. Names in the examples refer to these operations; omitted arguments below are supplied by their typed schemas.

| Construct | Complete supported vocabulary |
| --- | --- |
| Values and context | Integer, boolean, enum, ID and coordinate literals; `self` (listener owner), `target`, `event`, `iterator`, `statusInstance`, `linkedUnit`; missing optional references yield `none`, tested with `exists`. |
| Selectors | `unitAt`, `tileAt`, `unitsInRadius`, `tilesInRadius`, `unitsInLine`, `tilesInLine`, `unitsWithStatus`, `unitsOnTiles`. Queries specify origin, range, relation/tag/status filters and maximum results. `unitsWithStatus` can filter a payload link. Results sort by distance then ID; tiles by row then column. |
| Reads | `stat`, `hp`, `missingHP`, `stackCount`, `statusPayload`, `counter`, `resource`, `position`, `distance`, `movedTiles`, `phaseOrdinal`, `turnNumber`, `hasActed`, `alive`, `hasTag`, `hasStatus`, `hasOverlay`, `relation`, `isFlanked`, `exists`, `awayFrom`. `isFlanked` means two hostile units on opposite adjacent sides. `awayFrom` returns a cardinal direction, breaking equal axes horizontally. |
| Expressions | `add`, `subtract`, `multiply`, `floorDivide`, `min`, `max`, `clamp`; `equal`, `less`, `lessEqual`, `greater`, `greaterEqual`, `and`, `or`, `not`. Division by zero is rejected when provable, otherwise faults transactionally. |
| Control | Ordered `sequence`, `if`, `forEach` over a snapshot query; `schedule` one nonrecursive effect sequence at a named absolute phase boundary with captured IDs/coordinates; `cancelSchedule`. No while loops, recursion or dynamic definition creation. |
| Hooks | `battleStart`, `turnStart`, `phaseStart`, `phaseEnd`, `leaveTile`, `enterTile`, `moveComplete`, `beforeAttack`, `hit`, `miss`, `beforeDamage`, `afterDamage`, `afterHeal`, `kill`, `unitDeath`, `endWait`, `useActive`, `statusExpiry`, `objectiveMilestone`. Events expose typed actor/target/source/status IDs, target position, phase, voluntary flag, path, packet, actual damage or actual heal only where applicable. |
| Numeric changes | `modifyStat`, `modifyCombat` (might, hitBP, critBP, avoidBP, AS, flatReduction, damageFactorBP, pierceDefenseBP, forceFollowUp, preventCounter, suppressSupport); `dealDamage` (physical/magical/true), `heal`, `redirectDamage`, `adjustCounter`, `adjustResource`. Modifier definitions declare additive/multiplicative stage, duration and support tag. |
| State and space | `applyStatus`, `removeStatus`, `setTag`, `setAIProfile`, `shiftAllegiance`, `pushOrPull`, `swapPositions`, `spawnOverlay`, `removeOverlay`, `translateOverlay`, `summonUnit`, `spawnDrop`, `grantAction`, `reveal`, `setObjectiveFlag`. All created entities reference pinned templates; `reveal` affects declared fog cells only; objective flags must already be declared. |

Statuses declare payload fields, stack/replace policy, expiry ordinals and activation policy (`normal` or `blockOrdinaryAction`). Dead links are inert; ordinary healing cannot revive. Counters are typed unit/battle fields. `grantAction` adds an explicit number of credits with a shared per-phase key, valid for `any`, `move_only` or `attack_only`. Summons enter exhausted. Overlays declare movement, defense and visibility properties. `translateOverlay` clips cells at map bounds without moving base terrain. Ordinary support modifiers require an allied source and a target without the `pariah` tag; combat suppression removes only support-tagged contributions. AI profiles are fixed scoring strategies with inspectable weights, including tag-based target priorities.

### Exact resolution

1. Validate the command and reserve costs in a transaction. Invalid commands change nothing. Move one tile at a time in fixed neighbor order north/east/south/west, resolving leave/enter hooks before proceeding. Forced movement stops at the first occupied or impassable cell. `pushOrPull` returns `collided`, applies its declared collision packet to the pushed unit once and never implicitly damages the obstacle.
2. Recompute combat modifiers from current state. Declarative stat/combat modifiers cannot mutate state while calculating or forecasting. Run `beforeAttack` once per exchange, then the ordered strikes. Each hit emits its hook before proposing its damage packet.
3. A packet resolves base/defense, critical factor, additive modifiers, multiplicative factors, flat reduction, redirection, then HP application. Multipliers use integer basis points and floor after each stage. True damage skips defense. `redirectDamage` is legal only at the interception stage of `beforeDamage`; it transfers a portion of the already calculated packet with `resolvedAmount` and `noRedirect`. The receiver does not recalculate defense or numeric modifiers. Post-damage listeners observe actual HP lost. Healing listeners observe actual HP restored.
4. Within each stage, sort by priority, source ID, definition hash and listener index. Process emitted events FIFO after the current atomic operation, before the next sequence operation. Mark zero-HP units downed immediately: they stop blocking, acting and running ordinary listeners. Resolve `unitDeath`/`kill` once, then remove the unit. Expiry hooks retain a read-only snapshot of the expiring status payload.
5. Drain the root queue, apply objective milestones, and evaluate terminal predicates at the command boundary. Simultaneous precedence is fixed: technical abort, concede, total-party defeat, mandatory-protection failure, success, phase-horizon expiry. Already extracted units retain their recorded extraction. Once terminal, no further commands alter the battle.

All numeric state is signed integer data within ±1,000,000; HP and counts use their nonnegative subsets. Checked intermediates must remain exact safe integers; out-of-range input is rejected, never power-clamped. These representation limits apply equally to all factions. PRNG streams are pinned and keyed by battle seed, command ordinal, effect ID and draw index. Enemy AI uses bounded legal-action scoring and stable ID tie breaks; it never calls a model.

### Four executable design recipes

The following specify AST compositions, not new opcodes. Active/attack/kill listeners use `ownerActor`; damage/heal listeners use `ownerTarget`; expiry listeners use `ownedStatus`. No recipe observes unrelated units' events.

**Borrowed Second:** a free active costs 3 HP and has one shared use per own phase. `useActive → grantAction(self, +1, any, key=borrowed_second); applyStatus(self, temporal_debt, +1 stack, expiry=nextOwnPhaseStart)`. This adds an action without consuming one. The debt's `kill` listener removes that status and heals 6. Its `statusExpiry` listener deals true damage `10 + 5×stackCount` from the expiry snapshot. Unpaid debt can kill. The extra credit cannot reset the activation's per-phase use.

**Tectonic Resonance:** spend an action, select a cardinal line of three cells whose first cell is within two tiles. `forEach(tilesInLine) → spawnOverlay(cracked_stone, expiry=thirdFutureOwnPhaseStart)`. This overlay adds one movement cost and subtracts 1500 avoid basis points while occupied. Then `forEach(unitsInLine, enemy)` deals magical damage with pre-defense base `floorDivide(4×Mag,5)`, pushes the survivor two cells using `awayFrom`, and `if(collided)` applies stun until its next own phase ends. Stun removes ordinary action credits for that phase. Processing targets uses the initial query snapshot; each target's current position controls its push.

**Sympathetic Ledger:** spend an action to `applyStatus` on an ally within two cells, payload `{linkedUnit: self}`, expiring at the third future caster-phase start. At `beforeDamage`, if the linked caster is alive and within four cells, `redirectDamage` transfers 5000 basis points to it. A transferred packet is never redirected again. The caster's `afterHeal` listener uses `forEach(unitsWithStatus(bound_ledger, payload.linkedUnit=self))` and heals each living linked ally `floorDivide(3×event.actualHeal,4)`. Mirrored heals carry `mirrored`; the listener's guard excludes that flag. Thus two linked casters cannot bounce healing forever.

**Oathbreaker's Gambit:** a weapon's declarative modifier tests `not(hasActed(target)) or isFlanked(target)` and adds 6 might and 3000 crit basis points. The matching `beforeAttack` listener increments unit counter `broken_oaths` once per exchange. At three, `if(not(hasTag(self, pariah)))` sets the tag and applies permanent `pariah_bounty`. Support selectors now exclude the bearer; enemy hunter profiles score that tag first. The bounty's `kill` listener calls `spawnDrop(contraband_pouch, event.targetPosition)`, once per victim event. Drops enter the map/loot ledger once and collection is a standard interaction.

### Technical integrity and ending guarantees

Admission checks strict schemas, unique IDs, references, typed hook fields, total arithmetic, legal coordinates, template references, objective evaluation and truthful compiled descriptions. Reject generated operational prose that differs from the compiler's rules text. Validate deployment capacity and occupancy, but **do not require paths to objectives, reachable enemies, adequate supplies, survivable deadlines or any winning strategy**. An unreachable seize objective is valid.

Termination uses expression depth 8, 64 nodes per rule, query bounds derived from board/entity limits, 96 live units, 256 schedules, 4096 AST evaluations per root and event ancestry depth 8. Static analysis rejects trigger cycles without a proven decreasing nonrenewable counter. `maxPerRoot` covers all descendants; schedules cannot recursively schedule. Static cost analysis includes spawned listeners and retained canceled records. Published packs have byte/memory limits, never a quota of distinct mechanics; campaigns page archived definitions from storage.

Runtime fuel/depth/memory exhaustion rolls back the **whole root**, including payment, events, schedules and RNG. Persist the reproducible fault, quarantine the offending definition and offer an explicit technical-abort ending or restart from the last checkpoint with a disclosed repaired pack. Never silently skip listeners or partially apply a chain. A worker watchdog handles kernel crashes; technical abort is host-owned and independent of generated rules.

Every battle publishes a finite phase horizon, at most 512 phases for runtime safety, and a concrete terminal outcome at expiry. No effect can extend it. `End Phase`, `Wait` and `Concede` remain host-owned commands. At most 512 commands commit per phase; exhaustion automatically ends the phase after the current root, preventing infinite free-action phases. AI planning exhaustion also yields an end-phase command. Empty factions auto-pass. A wall-clock timeout does not penalize a thinking player. Objective predicates are total; impossible success conditions still terminate through defeat, expiry or concession. Campaign continuation always permits ending/retirement. This proves an ending is available without proving victory.

**There are no fairness, power-budget, Monte Carlo, win-rate or solution-witness admission gates.** Testing covers interpreter correctness and termination. A hopeless but technically sound battle passes unchanged. Technical fallback and Turnwheel do not guarantee escape from consequences.

## 3. Content data model

Every definition has `schemaVersion, id, contentHash, rulesVersion, provenanceJobId`. Instances pin definition hashes. Proposed content is separate from published artifacts.

| Record | Required data |
| --- | --- |
| Campaign/world | Campaign/branch IDs, original and accepted premise, seed, tone, rules version, canon revision, world-law records, factions/locations, relationships, roster/inventory IDs, clocks, arc state, chapter history and pending intentions. |
| Chapter | Parent outcome IDs, prerequisite facts/read set, introduced definitions, map, deployments, reinforcement schedule, objective graph, phase horizon, scenes, enemy profiles, aftermath outcome table, seed and immutable pack hash. |
| Map | Width/height, row-encoded terrain, elevation, movement links, deployment cells, objects, exits, overlays, fog and presentation recipe. Product map targets are in §1; technical maximum is 64×64. |
| Unit | Identity/character ID, faction/class hash, nine base stats, current HP, growths, level, movement profile, equipment, abilities, position, statuses, action credits, cooldowns, counters, alive/downed state and visual recipe. |
| Class | Name, base stats/growths, movement type, weapon tags, ability hashes and progression choices. Levels apply pinned seeded growth rules; generated class text does not redefine leveling. |
| Ability/effect/status | Typed activation, target/costs, modifier nodes, trigger AST, variable/link declarations, duration/stack policy, firing limits, computed execution bound, compiled rules text and motion recipe. |
| Item | Slot, weapon category, might/weight/hit/crit/range/damage type, charges, modifiers, ability hashes and tags; instance owner, remaining uses and acquisition source. |
| Dialogue/event | Cast/location, prerequisite facts, speaker/audience, text, suggested choices, intent options, typed consequence proposals, cause IDs and checkpoint/publication status. |
| Objective/outcome | Acyclic `all/any` composition of rout, reach, interact, defeat-tagged, protect, extract, survive and flag predicates; explicit terminal outcomes and precedence. Flags change only through declared interactions/milestones. |
| Job/artifact | Job/attempt IDs, launch epoch, provider/model/options, input hash, canon revision/read set, prompt/schema versions, status, usage/reservation, result hash and validation report. |

Canon is an append-only journal plus sourced temporal facts:

```ts
type Fact = {
  id: string; subjects: string[]; predicate: string; value: TypedValue;
  kind: "established" | "rumor" | "intention";
  visibility: string[]; holder?: string;
  sourceEventIds: string[]; validFrom: number; supersedes?: string;
};
```

Predicates and values come from a versioned registry. Engine outcomes own deaths, inventory and battle results. Rumor remains a claim with a source; an intention records a plan, not its accomplishment. NPC knowledge has its own scope. Corrections append superseding records; they never erase events. Relationships track trust/respect/fear with source events. Promises track exact wording, parties, requirements, due/revisit window, state and consequence IDs.

Retrieval supplies relevant sourced facts, current roster, unresolved promises, clocks and recent events, targeting approximately 4500 tokens. Rolling chapter digests and up to three highlighted quotes per character aid retrieval; full dialogue, additional quotes and all promises remain stored and searchable. Summaries are disposable indexes. A read-only lore tool retrieves older evidence; the model cannot rewrite it.

Publication uses compare-and-swap on canon revision plus read-set verification. Unrelated changes permit deterministic revalidation; changed dependencies invalidate the affected draft. Death, chronology, ownership and exclusive-fact checks protect continuity. Published scenes/briefings are commitments, preserved across subsequent repairs.

## 4. Generation pipeline

### Verified upstream surface and fork boundary

Research baseline: `pingdotgg/t3code` revision **e72dd5055eb437c93c0b3ddf710246ecbfe1f16e**, inspected for this merge. `t3 serve` already starts without a browser. Its CLI includes `--mode`, `--host`, `--port`, `--base-dir` and one-time `--bootstrap-fd` input. Reuse these entry points. Sources: [server CLI][t3-cli], [flags][t3-flags].

The existing authenticated RPC contract and HTTP/WebSocket server, plus authenticated `/mcp`, are the integration surfaces; do not invent stdio or named-pipe application transports. Sources: [architecture][t3-overview], [RPC contract][t3-rpc], [server][t3-server], [MCP server][t3-mcp].

Claude, Codex and Antigravity implementations live under `apps/server/src/provider`; other drivers also use `packages/provider-*`. Runtime policy and model catalog interfaces are reusable seams, not evidence that every provider can disable native tools. Sources: [Claude][t3-claude], [Codex][t3-codex], [Antigravity][t3-antigravity], [adapter policy][t3-adapter], [catalog][t3-catalog], [provider packages][t3-packages].

Reuse orchestration, discovery, supported authentication, streaming, cancellation and usage normalization. Add a **game-generation profile**, narrow game RPC methods, output extraction and read-only lore tools through the existing contracts/MCP surface. Restrict the exposed RPC methods and MCP toolkit; remove terminal/git/worktree/browser/remote/delegation capabilities from this profile. Provider-native tool denial requires adapter-specific enforcement and tests. These are fork additions; no percentage-of-upstream reuse claim is made. Retain the upstream [MIT notice][t3-license].

### Windows lifecycle and model selection

Electron main launches one hidden bundled sidecar in a dedicated scratch directory with `--base-dir %LOCALAPPDATA%\ChronicleTactics\t3-home`, loopback binding and per-launch authenticated bootstrap channel. The profile never opens personal T3 threads. Handshake reports fork SHA, protocol/schema versions, launch epoch and discovered capabilities. Main permits only the expected authenticated origin and bounded messages.

Upstream `awaitLauncherLoss` explicitly skips Windows; it is not cleanup. A small native module loaded in Electron main creates a **Windows Job Object**, sets kill-on-last-handle-close, forbids breakaway, creates the server suspended, assigns it, then resumes it. Main owns the sole non-inheritable job handle. Assignment failure blocks generation startup. Provider descendants must remain inside the job; normal shutdown cancels work then closes it, and forced main-process death closes it automatically. Test the real process tree, including provider helpers. Sources: [launcher code][t3-launcher], [Windows Job Objects][windows-jobs].

The two-slot picker displays every discovered provider/model and its auth, availability and generation-conformance status; incompatible entries are visible but disabled with a reason. Refresh outside combat. Record exact resolved provider/model/options per attempt. Player-configured ordered fallback policies govern all substitutions. Provider credentials stay in supported provider storage or Windows credential storage, outside prompts, saves and diagnostics. The fork remains the sole provider gateway.

### Job transaction, latency and failures

Game-owned RPC contracts carry `jobId, attemptId, epoch, kind, inputHash, canonRevision, readSet, modelSelection, deadline, tokenCaps, schemaId, promptVersion`; progress/result/error/cancel messages echo identity. Persist the ledger before dispatch. Duplicate submission of an existing attempt returns its state; retry/failover gets a new attempt. At most one accepted artifact publishes per job. Orphan/late results cannot commit. A crash leaves unresolved remote billing **uncertain**, without automatic duplicate submission beyond reserved policy.

1. **Plan:** Architect receives genesis/current state and proposes stakes, cast, objectives and any number of mechanics within technical resources.
2. **Build:** generate classes/items/rules, scenes and map constraints. A seeded local constructor handles compact terrain rows and archetypes such as Bridge Assault, Fortress Siege, Forest Ambush and Twin-Path Escort. Full generated layouts use the same admission checks.
3. **Validate:** parse one bounded JSON document; compile rules, descriptions, references, continuity, technical resources and ending policy. Streaming text is staging/progress only. Tactical difficulty is not an acceptance criterion.
4. **Repair:** normalize formatting locally; make at most one model repair with path-specific errors and the same snapshot. Repair cannot rewrite locked canon. A second invalid result uses an explicitly labeled technical fallback or remains pending.
5. **Publish:** save immutable artifacts/reports, recheck dependencies, then atomically commit the pack and canon operations before showing them.

Begin with one concurrent generation job. During battle, stage one next-chapter skeleton and short outcome deltas; finalize only after the real result. Cache by input/rules/prompt hash, reuse static prompt prefixes where supported, and encode maps as rows/RLE. There is no speculative branching tree. Output can be chunked across jobs to support rich mechanics without a uniqueness quota.

Initial job budgets: 45-second soft deadline, 120-second total hard deadline including repair, 12k input/6k output tokens per request, configurable by model capability. At the soft deadline offer wait, cancel or a technically valid local construction. Hard expiry cancels and reaps the job's execution scope. These are generation-performance budgets. Record p50/p95 genesis, dialogue and transition latency; target first deployment within 60 seconds on the measured reference model and 90% staged chapter transitions, without claiming universal speed.

Reserve token/cost estimates before attempts, include canceled/uncertain usage, and pause speculation near player caps. Show price source/date when known; otherwise show tokens and “price unavailable.” Reconcile actual usage when provided. Cancellation does not promise a billing refund.

| Failure | Required behavior |
| --- | --- |
| Rate/usage limit | Recognize upstream `usage_limit`, show supplied reset data, and retry once within the job deadline or use an authorized fallback. [Failure contract][t3-failure] |
| Auth failure/unavailable provider | Preserve pending input and current play; show setup/reconnect outside battle. |
| Refusal | Keep exact player text; offer editing or permitted model choice. Do not automatically reframe to evade refusal. |
| Crash/invalid result | Recover ledger, retain uncertain billing, reject stale results; use a technically valid local pack only when consistent with current consequences. |
| No generated continuation | Continue published play, inspect camp/journal, save and return, or explicitly choose a labeled local encounter. An unresolved conversation stays pending. |

Fallbacks never erase losses, supply a guaranteed recovery route or postpone an already triggered campaign end. Published battles and local endings require no live model.

## 5. Player authorship

Input modes are **Speak**, **Attempt**, and **Propose lore**. Preserve exact submitted text immediately as a pending record. The Chronicler proposes intent, NPC reply, sourced facts, relationship changes, promises, resource operations and future consequences. Local validation checks authority, references, available resources and continuity. An utterance establishes what was said, not the truth of its claims.

Show a concise interpretation chip for material commitments/actions so the player can correct targets or intent. Once the exchange's consequences validate, commit utterance, response and effects together as canon. Ordinary dialogue uses submission as acceptance of speaking and needs no repeated modal. Failed generation leaves the whole exchange pending. “Give my sword 999 attack” grants no authority to change its definition; NPCs may interpret it as boasting. A legitimate bargain can still create a devastating advantage or disastrous obligation through validated story operations.

Example: “I pledge half our gold if your guild collapses the western bridge.” The interpreter identifies the guild, amount and promise. After acceptance, one transaction records the words, deducts available gold, creates the obligation and links a consequence plan. A later chapter may contain the collapsed bridge, including the loss of an escape route. Generation must address due major promises or record a sourced reason and revisit window for deferral. It cannot quietly discard a costly choice.

**Field Parley** is a published battle action, normally one action credit, with explicit eligibility and outcome table. Free text selects/flavors a supported interpretation; mechanics resolve through that table, including possible refusal or capture. A new negotiated outcome stages at a command-boundary checkpoint and publishes a validated replacement branch only after the player accepts its changed stakes. Pending conversation never blocks End Phase or Concede.

Lore proposals at camp can add consistent facts. Revising established history creates a named branch with a visible change record. Journal corrections supersede facts and retain evidence. Player text is data, never provider/tool instructions or permission to execute code.

## 6. Tech stack & app architecture

Use strict TypeScript, Electron, React, PixiJS, shared Effect Schema contracts and SQLite. This shares schemas with the T3 integration and keeps the simulator portable. Electron main owns typed IPC, the native lifecycle module and sidecar supervision. A game worker owns authoritative command resolution and the single save writer; a separate bounded worker compiles generated content. The renderer receives read models and sends commands. Node integration is disabled; context isolation, sandboxing, restrictive CSP and sender/payload checks are mandatory. Generated text is rendered as text; presentation recipes cannot inject HTML/SVG/URLs.

**Visual direction:** Sol's illustrated atlas board game: crisp terrain, contours, paper shading, faction pennants and stable heraldic tokens. Locally composed medallion portraits use shipped head shapes, silhouettes, garments, emblems and equipment marks, selected by seeded recipes. No image-generation service or bespoke portrait pipeline is required. Motion comes from a bounded library: sweep, beam, pulse, link, ripple, ghost trail and overlay drift. Board-native attacks last roughly 0.7 seconds and support instant resolution. Synthesized SFX communicate hits, danger and selection; animation/audio consume engine events and never change simulation.

Accessibility includes shape-plus-color factions, high contrast, scalable text, keyboard board/menu navigation, reduced motion, adjustable audio and a readable event log matching the forecast. Identity silhouettes persist across class changes.

Each campaign database stores append-only events, materialized state, immutable definitions/packs, canon, snapshots, Turnwheel branch records and the job ledger. Commit commands, ordinals, RNG and state hashes atomically before renderer acknowledgement. Save at every command boundary; snapshot at deployment and phase changes. Interrupted writes yield the previous or new committed transaction. Disk errors pause new commands while preserving the prior save.

Export `.chronicle.zip` with a consistent database snapshot, versioned manifest, hashes and referenced assets, excluding credentials/provider logs. Imports bound archive size, validate paths/hashes/schema and never execute content. Update host, compiler, interpreter and pinned T3 fork as one tested bundle; stage on restart with backup/rollback. Preserve old interpreters or migrate explicitly at chapter boundaries while retaining the original save.

Ship Windows x64 first using an NSIS installer with bundled runtime, sidecar, native module and notices; ARM64 follows. No user Node/T3 installation is required. Provider-specific external dependencies are detected and explained during onboarding; distribution rights and adapter compatibility are checked per supported provider. No sidecar self-update during play.

## 7. Risks & open questions

| Risk | De-risking evidence / release condition |
| --- | --- |
| Coding providers retain native tools | Controlled read/shell/network/delegation attempts must fail under the generation profile for each adapter. Instructions alone do not qualify it. Start with Codex, then Claude; failure blocks that adapter. |
| Rules become repetitive or unreadable | Generate 30 mechanics across three settings; classify actual timing, spatial, resource and action-economy differences. Test explanation comprehension. Improve composition/examples without limiting mechanic counts. |
| Forecast, redirection or rewind diverges | Deterministic fixtures for hit/miss/crit branches, linked damage, collisions, expiry and restore; compare traces and hashes. Fuzz bounded ASTs for transactional integrity. |
| Hopeless situations feel arbitrary | Human-play review checks whether disclosed rules and sourced consequences explain the loss. It does not reject unwinnable encounters or rebalance them. |
| Continuity loses promises | Synthetic 20-chapter history with deaths, lies, overdue vows and stale jobs: zero structured contradictions, all due commitments handled or explicitly deferred. |
| Latency/cost or fork maintenance grows | Measure both supported providers, rehearse one upstream update against recorded traces, and retain playable published content throughout outages. |
| Portraits fail attachment | Test recognition through camp, battle and casualty scenes before expanding the shipped primitive library. |
| Long campaigns outlive runtime versions | Replay/save fixtures per supported ruleset, explicit migration boundaries and preserved original exports. |

Open product experiments are portrait variety, late-campaign horizontal progression and optional ambient music. Multiplayer, arbitrary scripts, mandatory generated raster art and a full world simulator remain outside the first release.

## 8. Milestone plan

Ten competitive implementation rounds, each one focused agent session on the preceding accepted baseline. Each round must leave a runnable increment with its fixtures and reproducible checks. The alpha implements a subset of the declared vocabulary; an unimplemented opcode is rejected explicitly, never approximated silently. This limits implementation scope, not how many mechanics a chapter may compose.

| Round | Self-contained deliverable | Definition of done |
| --- | --- | --- |
| **M1** | Empty repo → Windows micro-battle | Scaffold Electron/React/PixiJS and typed commands. Launch a 6×6 board with one ally/enemy; select, move, attack and end phases to victory/defeat. Concede and a finite expiry work. No external art or provider needed. |
| **M2** | FE combat kernel and forecast | Extract pure rules; implement §2 formulas, seeded hit/crit, counters and follow-ups. Forced-branch fixtures match forecast explanations; identical 20-command logs produce identical hashes; invalid commands change nothing. |
| **M3** | Rule IR slice: Borrowed Second | Implement statuses, counters, expiry, action grants and root transactions needed for this recipe. Debt clears on kill or applies at exact expiry; cyclic/oversized fixtures reject or roll back costs/RNG completely. Tooltips derive from compiled data. |
| **M4** | Real headless fork spike: Codex | Pin the researched SHA; reuse serve/authenticated WS-RPC, discover a model, return one JSON result. Native tools are denied. Cancellation works. Force-kill game main: sidecar and provider descendants disappear. Missing auth leaves the micro-battle usable. |
| **M5** | One generated chapter through staging | From a premise, generate company identities, one supported class/item/rule pack and a constructor-based encounter. Publish only after technical checks; one failed repair yields a labeled local result. Duplicates/stale attempts cannot republish. An impossible seize fixture passes and reaches expiry defeat. |
| **M6** | Save/load and Turnwheel | Persist full command state and job ledger in SQLite; restore after process exit with identical hash. Rewind three times without refunding charges or rerolling identical actions. Interrupted commit recovers either complete transaction. |
| **M7** | Authorship campaign slice | Add one camp companion and the bridge bargain. Correct an interpretation, commit sourced promise/effects, finish the battle, and publish a short second chapter reflecting the bridge change. Provider loss preserves battle play/pending dialogue; terminal defeat presents a local epitaph with causal links. |
| **M8** | Tectonic Resonance and atlas readability | Add line queries, overlays, collision movement and stun for this recipe. Wall/unit collisions and target order match fixtures. Show medallions, hazard/forecast branches, keyboard inspection and reduced motion on a 12×10 board. |
| **M9** | Claude conformance and measured staging | Apply the M4 provider suite to Claude. Stage one skeleton with the existing job coordinator; invalidate it through a changed promise. Exercise authorized failover, refusal and uncertain billing; report p50/p95 request/transition times and token totals for both providers. |
| **M10** | Distributable Windows alpha | Package the accepted slice and fork/runtime/native module. Clean Windows install runs without developer tooling; export/import round-trips, path-traversal archive rejects, forced shutdown cleans children, and unavailable generation still permits a saved battle and ending. Include notices and explicit supported-adapter report. |

Subsequent one-session rounds implement Sympathetic Ledger interception/heal flags, then Oathbreaker's counters/drops/AI priorities, then each additional vocabulary family, map archetype or progression feature independently. Signed release/update infrastructure follows the distributable alpha. The full product is complete when the declared vocabulary and all four recipes pass conformance and generated multi-arc play preserves canon and technical endings.

## Decisions log

| Decision | Source |
| --- | --- |
| Chronicle Tactics pitch, FE phases/hit/crit/follow-up, forecast, Turnwheel, Parley, genesis and objectives | H; user area verdict |
| Rule IR is the foundation; explicit complete vocabulary repairs missing operations | H → T → S; reviews |
| Integer stages, stable ordering, root limits and whole-root rollback | S, supported by T |
| No mechanic-count quota; no fairness/winnability/solution-witness or power-clamping gates | User; overrides all candidates/judges |
| Hopeless consequences and terminal campaign defeat are legitimate; only technical endings are guaranteed | User |
| Illustrated atlas, medallions, motion library/accessibility; heraldic tokens/forecast/synth accents | S + H |
| Sourced append-only memory, tracked promises, established/rumor/intention; validated dialogue transactions | S + T |
| Existing serve/WS-RPC/MCP; corrected adapter paths, ledger/idempotency and mandatory native Windows cleanup | H + S; judges; verified upstream |
| Two discovered-model slots and player-configured fallback | H + S |
| Narrow competitive milestones replace oversized engine/solver/release sessions | S; reviews; merge brief |

[t3-cli]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/apps/server/src/cli/server.ts
[t3-flags]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/apps/server/src/cli/config.ts
[t3-overview]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/docs/internals/overview.md
[t3-rpc]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/packages/contracts/src/rpc.ts
[t3-server]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/apps/server/src/server.ts
[t3-mcp]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/apps/server/src/mcp/McpHttpServer.ts
[t3-claude]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/apps/server/src/provider/ClaudeProvider.ts
[t3-codex]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/apps/server/src/provider/CodexProvider.ts
[t3-antigravity]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/apps/server/src/provider/AntigravityProvider.ts
[t3-adapter]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/packages/provider-core/src/server/ProviderAdapter.ts
[t3-catalog]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/packages/provider-core/src/server/ModelCatalog.ts
[t3-packages]: https://github.com/pingdotgg/t3code/tree/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/packages
[t3-license]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/LICENSE
[t3-launcher]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/apps/server/src/launcherWatch.ts
[t3-failure]: https://github.com/pingdotgg/t3code/blob/e72dd5055eb437c93c0b3ddf710246ecbfe1f16e/packages/contracts/src/orchestrationV2.ts
[windows-jobs]: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
