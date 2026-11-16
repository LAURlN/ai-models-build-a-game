# Palimpsest — a tactics campaign that remembers

## 1. Vision and core loop

**A campaign is a serial tactics novel whose author shares the table with the player.** The player supplies a premise, recruits a small company, makes difficult battlefield decisions, and writes words that change what the next battle is about. The model invents the world; a local, deterministic engine decides what actually happens.

Example premise: “A drowned industrial republic where railway unions bargain with ancestral ghosts.” The opening company might include a signal operator who repeats footsteps, a debt collector who postpones wounds, and a union envoy whose promises matter. These should have different playable rules, not merely different names for a fireball. The next chapter might concern a strike because the player promised to protect the workers, rather than because every campaign follows the same plot outline.

### A session

A 30–45 minute session contains a brief camp scene, deployment and equipment choices, one 15–25 minute battle, and an aftermath. The initial target is 4–6 deployed allies, 6–10 enemies, and a 12×12 map. Larger maps and rosters follow only after readability and generation reliability are demonstrated.

1. **Camp:** see consequences of the last chapter, speak to companions, write dialogue or choose suggested responses, and decide the company's next intention.
2. **Briefing:** inspect objectives, stakes, terrain, enemy mechanics, and any deadline. Preview newly introduced rules with a tiny interactive example using the actual engine.
3. **Battle:** alternate player and enemy phases. Units move and act; reactions and terrain effects resolve locally. Forecasts explain every damage adjustment and trigger.
4. **Aftermath:** the engine records casualties, objectives, promises fulfilled, and resources spent. The model proposes an account of those facts and the next situation.
5. **Continuation:** publish the next validated chapter when ready. Save and quit at any command boundary.

The campaign runs in renewable arcs of roughly three chapters, with an explicit opportunity to conclude the company's story after each arc. Continuing introduces consequences and unresolved factions, not endlessly increasing hit points. Defeat normally creates a retreat, capture, or lost opportunity; it does not erase the campaign. Restarting the chapter is also available.

### Fixed contract versus generated content

| Fixed and versioned by the game | Generated and validated per campaign |
| --- | --- |
| Turn order, targeting, movement, arithmetic, effect vocabulary, limits, forecasting, enemy planner | Setting, identities, factions, motives, relationships, dialogue, chapter situations |
| Objective operators, map constructor, encounter budgets, progression limits | Map layouts and parameters, objective combinations, enemy formations and personalities |
| Visual grammar, UI, animation vocabulary, accessibility | Class names and builds, abilities, item properties, terrain combinations and presentation recipes |
| Authority of recorded outcomes and accepted player actions | Future consequences and interpretations consistent with those outcomes |

“Limitless” means an expanding space of meaningful compositions. It does not mean a model may install new executable rules during a save. If a premise needs an unsupported mechanic, generation must offer an honest supported interpretation or reserve it for the fiction. Adding a new engine primitive is a tested product update.

### Tactical baseline

Square grid, orthogonal movement, explicit movement costs, no facing requirement. Each living unit gets one movement allowance and one action per own phase; it may act before moving, but cannot split movement around an action in the first release. Waiting consumes the action. Equipment defines range and physical or spirit damage. Cover and line of sight use fixed tile rules. Counterattacks require an explicit reaction ability and a visible reaction charge.

Initial stats are HP, Power, Armor, Will, Move, and maximum Stamina. For an ordinary strike, damage is `max(1, weaponPower + Power - relevantDefense)`, where relevant defense is Armor or Will. Explicit immunity or absorption may reduce this to zero. Effects modify named stages of this calculation. No random misses, critical rolls, or hidden doubling; critical-style effects have visible conditions. Combat is deterministic even without consulting a random stream. Seeded randomness is available for map construction, loot selection, and later explicitly labeled random effects.

Stamina replenishes at own-phase start. Classes supply base stats, equipment permissions, and a small progression menu. Levels grant bounded choices and horizontal specializations; recruit scaling and enemy tier are set at chapter publication. The player can inspect all enemy rules. Surprise comes from situations and combinations, not undisclosed damage multipliers.

## 2. Rules engine: bounded composition, exact resolution

### Authority and module boundaries

`rules-core` is a pure TypeScript package: `(BattleState, Command, ContentPack) -> Resolution | Rejection`. It has no filesystem, network, clock, provider, or renderer imports. Commands include move, use ability, equip before deployment, wait, and end phase. A successful resolution returns a new state, ordered events, explanation records, and a canonical state hash. The UI, AI planner, forecast, replay runner, and content tests all call this package.

Definitions are immutable and content-addressed. Runtime units refer to exact definition hashes, never “latest.” A published chapter pins a ruleset version, all definitions, initial state, map seed, enemy planner version, and the permitted campaign-outcome adapters. Generation cannot mutate an active battle. A story request made during combat is held for the next narrative checkpoint unless it selects an already published mechanical action, such as parley.

### Effect language

Use a typed JSON abstract syntax tree, **no generated JavaScript, Lua, WASM, expression strings, or dynamic imports**. The first vocabulary includes:

| Construct | Supported operations |
| --- | --- |
| Queries | Self, event subject, linked unit, units/tiles in bounded radius; filter by faction, tag, status, distance; stable sort and explicit maximum count |
| Expressions | Integer constants and whitelisted state reads; add, subtract, min, max, compare, boolean operators; bounded snapshot references |
| Changes | Damage, heal, shield, resource transfer, apply/remove status, move/swap, add/remove overlay, summon from a pinned definition |
| Hooks | Phase start/end, voluntary move completed, action resolved, damage proposed/applied, shield absorption, status expiry, unit downed, tile entered, objective milestone |
| State | Typed, capped counters; a declared link; a bounded path snapshot; status duration; scheduled records |
| Control | Condition, sequence, bounded iteration over a query result, schedule at a named future phase |

Each opcode has a hand-written interpreter, validator, cost bound, tooltip renderer, and test fixture. Effects cannot address campaign facts, grant arbitrary currency, change objective definitions, or create definitions. Story transitions use a separate typed outcome language. A summon must name content already in the chapter and respect faction/entity caps. A terrain overlay changes a few known properties; it cannot introduce code.

Illustrative shape; production schemas use discriminated unions rather than untyped strings:

```ts
type AbilityDef = {
  id: DefId; version: number; activation: Activation;
  target: TargetSpec; costs: Cost[]; requirements: Predicate[];
  effects: EffectNode[]; listeners: ListenerDef[];
  complexity: number; presentation: PresentationRecipe;
};
type ListenerDef = {
  event: EventKind; guard: Predicate;
  priorityBand: "intercept" | "modify" | "after";
  maxPerRoot: number; maxPerPhase: number;
  effects: EffectNode[];
};
// Predicate, EffectNode and TargetSpec are closed, versioned unions.
```

### Resolution semantics

1. Check command legality and reserve its action/resource costs against the initial state. An illegal command changes nothing.
2. Resolve movement one tile at a time. Use a fixed neighbor ordering and stable tie-breaking for pathfinding. A tile-enter reaction can stop the remaining path; the forecast shows that outcome.
3. For each proposed damage packet, compute base damage including defense, then additive modification, multiplicative modification, interception/redirection, shield absorption, HP application, and after-damage listeners. Redirected amounts skip base calculation and numerical modifiers on the receiving unit; its shields still apply. Percentage factors are integer basis points, applied in sorted order and rounded down at each stage. Modifiers declare their stage; priorities cannot be invented.
4. Listeners within a stage sort by engine priority band, source entity ID, definition ID, and listener index. Target queries sort by distance, then entity ID unless their schema explicitly chooses another supported order. Containers never rely on hash-map iteration order.
5. Mark zero-HP units as downed immediately. They block no tiles, cannot act or trigger ordinary listeners, and are removed at the current atomic effect boundary. Downed listeners run once. A non-damage effect heals only living units; revival is a separate permission, excluded initially.
6. Drain scheduled effects and the event queue, then evaluate objective transitions at the command boundary. Explicit precedence is published for simultaneous success and loss conditions. Default: a fulfilled escape counts for units already extracted; a simultaneous total defeat loses remaining objectives.

All calculations use bounded integers and checked intermediates within JavaScript's exact-integer range. Random draws, when enabled, use a pinned integer PRNG and a keyed stream based on battle seed, committed command ordinal, effect ID, and draw index. Forecasting clones state and streams; hovering never advances the live game. Save records include counters and pending schedules. Determinism means identical artifacts and commands produce identical results; it does not mean asking a provider again produces identical content.

### Four unusual mechanics, expressed concretely

The following recipes use the same AST vocabulary. Their labels are generated fiction; their operational text comes from the compiled recipe.

**1. Borrowed Tomorrow — take a wound on credit.** An active ability consumes the action and 2 Stamina, granting 10 shield until the next allied phase starts. Damage absorbed by that particular shield increments `debt`, capped at 10. At expiry, remove the shield and deal `debt` as unredirectable, shield-bypassing damage to the borrower. The borrower cannot use it while that debt status exists. Death cancels the schedule; debt cannot transfer to another character.

```text
activate -> applyStatus(self, borrowed, {debt:0}, expires=nextOwnPhaseStart)
borrowed.shield = 10
on ShieldAbsorbed where shieldSource == thisStatus:
  counter.add(debt, event.absorbed, cap=10)
on StatusExpiry:
  removeShield(thisStatus)
  damage(self, counter.debt, flags=[debt, bypassShield, noRedirect])
```

This converts immediate danger into a position-and-healing problem. The forecast displays both current HP loss and the next-phase payment. Duration uses an absolute phase ordinal resolved at application, so changing ownership cannot postpone the debt forever. Shield absorption is an engine event with the absorbed shield's source ID, not a heuristic inferred from HP.

**2. Wound Relay — a protective link that occupies space.** Spend an action and 1 Stamina to link one ally within three tiles until the caster's next phase. While adjacent to that ally, intercept the first six incoming damage points in total and redirect them to the caster. Multiple protectors use the fixed listener ordering. Redirected packets retain damage type but carry `noRedirect`; transferred damage bypasses the caster's Armor/Will calculation because that calculation already happened on the ally. The caster's shield can absorb it.

```text
activate -> applyStatus(target, relay,
  {protector:self, remaining:6}, expires=nextCasterPhaseStart)
on DamageProposed(target) after numerical modifiers, before shields
  where adjacent(protector,target) && alive(protector) && !packet.noRedirect:
    n = min(packet.amount, remaining)
    packet.reduce(n); counter.subtract(remaining,n)
    damage(protector,n, flags=[resolvedAmount,noRedirect])
```

If the caster dies, the status expires; separation merely suspends protection. The interceptor hook is a specific typed damage stage despite the readable event name above. `resolvedAmount` is legal only inside this interception operation. Preventing redirection of redirected packets stops two protectors from creating an infinite exchange. Moving the protector away creates tactical counterplay.

**3. Echo March — last movement becomes next round's hazard.** Once per own phase, a voluntary move stores up to five departed tiles. At the next enemy phase start, spectral footsteps deal 3 spirit damage to each enemy occupying those tiles, at most once per enemy. The record snapshots coordinates, not targets, and is consumed before firing. Forced movement never records another echo.

```text
on VoluntaryMoveCompleted where owner == self && phaseChargeAvailable:
  consumePhaseCharge()
  schedule(nextEnemyPhaseStart,
    snapshot={tiles:unique(event.departedTiles).take(5)},
    effect=damage(query.enemiesOn(snapshot.tiles,max=12),3,spirit))
```

Both sides see the marked tiles and expiry. An empty path creates no schedule. The ghost is a visual effect, not a second unit with an action budget. This allows delayed traps and route denial without a rewind engine or hidden duplicate turns.

**4. Procession of Rain — a moving battlefield.** A map device advances a three-tile storm strip east at each enemy phase start. The strip marks movement cost +1 and inflicts 2 spirit damage on entry, once per unit per phase. It dissipates at the map edge. Capturing the device reverses subsequent advances. The device has a capped `direction` enum, not an arbitrary script.

```text
on EnemyPhaseStart:
  overlay.translate(stormId, direction(device), steps=1,
                    clip=mapBounds, collision=overlayOnly)
on TileEntered where tile.hasOverlay(stormId):
  once(unit, stormId, currentPhase) -> damage(unit,2,spirit)
on ObjectiveMilestone(deviceCaptured):
  device.set(direction, west)
```

Overlays do not displace base terrain, erase exit tiles, destroy objectives, or make movement impassable. Storm pulses cannot retrigger entry without a new move. Map validation includes every bounded storm position. These examples can interact: a relay can absorb an echo, debt can outlast a storm crossing, and enemies can pursue the device using ordinary objective AI.

### Termination, validation, and balance

Proposed initial admission limits: expression depth 8, 64 effect nodes per definition, 16 results per query, 48 units and 576 tiles per battle, 128 pending scheduled records, 256 active statuses/overlays, 8 triggered generations per root command, and 2,048 effect applications per command. These are tuning constants with regression fixtures, not promises about balance. No effect grants another full action in the first vocabulary. Summons enter exhausted and disappear on encounter end.

Static analysis derives a conservative expansion bound from queries, schedules, and listener multiplicities. Trigger dependency cycles are rejected unless the compiler proves a decreasing, nonrenewable charge for the entire cycle; initially, simply reject those cycles. A listener's `maxPerRoot` is tracked across its descendants, not reset on each emitted event. A root is one player/AI command or a scheduled phase batch. Schedules have bounded creation counts and cannot schedule themselves. Counts include canceled records until the current resolution ends to prevent create/delete churn.

Runtime fuel is a backstop. Exhaustion rolls back the entire root, including costs and PRNG state, records a reproducible fault, and marks the offending definition unusable for that encounter. The UI explains the interruption and permits wait, retreat, or restart from the pre-command checkpoint with a disclosed safe replacement. There is no partially resolved explosion and no silent truncation of damage.

Admission proceeds through independent gates:

1. **Shape:** strict schema, byte/depth/collection limits, known opcodes and IDs; reject duplicate keys, extra properties, NaN, malformed references, and unsupported versions.
2. **Types and invariants:** legal event fields, target types, costs, duration units, stacking and replacement policies. Base ranges start at HP 1–80, Power 0–30, Armor/Will 0–25, Move 1–8, Stamina 0–6. Derived values have separate enforced bounds. Immutability of objective-critical cells and the total entity budget are checked.
3. **Cost and termination:** compile an execution bound and an explanation. Reject mechanics that cannot be represented truthfully by the UI.
4. **Power:** a local evaluator computes damage, prevention, area reach, mobility, control duration, recurrence and action economy against standardized fixtures. Costs and drawbacks cannot excuse unbounded output. Class builds, equipment, and full-party combinations must fit the chapter tier's envelope. A rare item can buy a higher budget only within a published absolute cap.
5. **Map and encounter:** validate movement graphs using the actual terrain rules, deployment space, enemy reach, objective dependencies, keys, timers, reinforcements and evolving overlays. Every mandatory interaction must have a route using the weakest legal deployed party; no required generated skill, consumable or surviving NPC may be the only key. Reject unavoidable spawn damage, unannounced first-phase lethal threats, and deadlines shorter than a constructive traversal schedule plus margin.
6. **Play probes:** run the actual enemy AI against a small suite of fixed player policies and a bounded tactical search. Store a successful command replay for the intended roster and main objective; a checked replay is evidence of one feasible solution. Probe low-health starts and item substitutions for brittleness. Novel combinations with no successful witness fall back to a simpler encounter.

Simulation win rates are diagnostics, not a proof of fairness. Reachability alone does not prove a combat victory. The product guarantee is a witnessed initial solution, understandable threats, a retreat route, and recovery when the player loses. Search can time out; publication cannot wait indefinitely, so use a previously validated map family with the current roster and rerun its witness. Never publish a difficult novel map merely because its prose sounds plausible.

Use one signature rule and at most two minor new rules per chapter. Early encounters demonstrate each new mechanic before combining it with lethal stakes. Difficulty selection changes visible budgets and enemy planning depth; it never secretly rerolls player outcomes. Equipment changes after validation trigger a cheap recheck; minimum supplies and a basic physical/spirit attack remain available at deployment.

## 3. Content, state, and continuity

Separate **definitions**, **instances**, **facts**, and **uncommitted proposals**. All generated documents have `schemaVersion`, stable ID, content hash, provenance job ID, and ruleset requirements. Names are presentation and may collide; IDs cannot. New IDs are allocated by the host in a job namespace and normalized only after reference validation.

| Record | Required fields and constraints |
| --- | --- |
| Campaign | `id, branchId, seed, premiseOriginal, acceptedPremise, toneBounds, rulesetVersion, canonRevision, activeChapterId, worldState, rosterIds, inventoryIds, progressionTier, arcState, providerPolicyId` |
| World state | Location/faction/character ID registry; typed relationship edges; `Fact[]`; resources; world clock advanced only by committed events; unresolved threads with stakes and revisit window |
| Chapter | `id, parentOutcomeIds, requiredFacts, forbiddenFacts, readSet, introducedDefs, mapId, deploymentSpec, objectiveGraph, enemyPlans, scenes, outcomeTable, seed, packHash, status` |
| Map | `width, height, baseTileIds[], elevation[], movementLinks[], deploymentZones, exits, interactables, overlays, spawnPlans, presentationRecipe`; dimensions and arrays must agree |
| Unit definition/instance | Definition: identity, class, base stats, permitted equipment, progression choices, narrative character ID. Instance: exact definition hash, team, position, HP/Stamina, equipment instances, statuses, charges, personal counters, downed state |
| Class | Name, tier, stat allocation, movement type, weapon tags, granted ability hashes, bounded progression choices, silhouette recipe; cannot change global turn semantics |
| Ability/effect/status | Activation/target/cost/requirement unions; typed AST; hook definitions; stack key, maximum stacks, expiry, declared runtime variables, execution bound, compiled explanation, presentation |
| Item | Definition: slot, tags, power/range/type, ability references, charges, scarcity tier, economy budget. Instance: definition hash, remaining charges, owner, provenance; mechanical properties are never inferred from prose |
| Dialogue scene | Cast IDs, location, prerequisite facts, dialogue beats, entry node, suggested choices, exit intents, text; NPC beliefs are separate from world facts |
| Event/outcome | Event ID, ordinal, actor, typed payload, cause IDs, chapter/command ID, expected canon revision; outcome adapters map engine results to allowlisted fact/resource/relationship operations |
| Generation job/artifact | Context hash/read set, task kind, selected provider/model, prompt/schema versions, attempts, usage, state, raw-result hash, validation report, candidate pack hash |

The objective graph is an acyclic data structure of `all`, `any`, `reach`, `interact`, `defeatTagged`, `protectUntil`, `extract`, and bounded `survivePhases`. Each node has a terminal state and explicit priority. Branches may complete by nonviolent interaction. Reinforcements have finite counts and published timing/telegraphs; the engine never asks an LLM what “hold them off” means.

```ts
type Fact = {
  id: string; subject: EntityId; predicate: FactKind;
  value: TypedValue; scope: "world" | "belief";
  holder?: EntityId; validFrom: number; validUntil?: number;
  sourceEventIds: EventId[]; authority: "engine" | "acceptedAuthorship" | "publishedStory";
};
type CanonProposal = {
  expectedRevision: number;
  reads: { factId: string; version: number }[];
  preconditions: FactPredicate[];
  operations: CanonOperation[]; sourceJobId: string;
};
```

`FactKind` and `CanonOperation` are typed vocabularies, such as character alive/dead, faction controls location, promise created/fulfilled/broken, trust delta, and thread opened/resolved. A prose claim can be retained as text but cannot silently become a mechanical fact. NPC lies are belief or utterance records, not a second contradictory world truth.

### Memory that does not overwrite history

The authoritative history is append-only events with materialized world and battle state. Facts retain sources and temporal validity. The generator receives a small campaign constitution, exact relevant facts, current roster and location records, unresolved commitments, recent events, and a rolling prose digest. Retrieval begins with entity IDs and graph neighbors; text search adds useful context. An embedding service is optional later, never required for continuity.

Summaries are disposable indexes. They cannot resurrect a dead character, invent an acquired item, or delete a promise. A consistency checker extracts candidate factual references from story output and compares structured claims to canon. Free prose remains fallible; critical facts are rendered from structured records and tested separately. A player-facing journal links important claims to the actual event and distinguishes rumor from established fact.

Publishing uses compare-and-swap on canon revision and checks the job's read set. If only unrelated facts changed, deterministic rebasing can keep the artifact; if an affected NPC died or a promise changed, discard or regenerate the dependent portion. A stale job cannot commit by arriving last. Once a briefing or scene is shown, its disclosed facts and mechanics become commitments. Rewriting them requires an explicit player-created branch, not an automatic repair.

Maintain a bounded active cast and a capped unresolved-thread list. Closing or shelving a thread must preserve its record and explanation. Every arc should address at least one old commitment before opening another major one. This is a pacing policy checked in the planning document, not a claim that a summary solves long-term storytelling.

## 4. Generation through the game's headless T3 Code fork

### Upstream evidence and fork boundary

T3 Code describes itself as a local control plane for installed coding agents, including Codex, Claude Code, OpenCode and ACP agents; it uses the user's existing provider sign-ins rather than reselling tokens. This makes provider orchestration a useful base, not a promise that every subscription permits this game's use. See the [upstream README](https://github.com/pingdotgg/t3code#readme).

The inspected tree separates a runnable server and Electron desktop package. Provider abstractions include session policies, streamed events, failures, and cancellation-related terminal states; model catalogs carry IDs and capabilities. These are reusable integration seams. Sources: [server package](https://github.com/pingdotgg/t3code/blob/main/apps/server/package.json), [desktop package](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/package.json), [provider adapter](https://github.com/pingdotgg/t3code/blob/main/packages/provider-core/src/server/ProviderAdapter.ts), and [model catalog](https://github.com/pingdotgg/t3code/blob/main/packages/provider-core/src/server/ModelCatalog.ts).

**The game-specific protocol below is proposed fork work, not an existing upstream API.** Existing text-generation interfaces shown in the source are oriented to such tasks as titles and PR content; they do not establish a generic, safe game-content endpoint. See [text-generation interface](https://github.com/pingdotgg/t3code/blob/main/packages/provider-core/src/server/textGeneration.ts). Research reflects public `main` inspected for this proposal; implementation must record and test an exact upstream SHA rather than build from a moving branch.

Keep the fork narrow:

- Reuse provider adapters, model discovery, authentication flows, native session/turn streaming, cancellation, and usage normalization where their behavior is verified.
- Add a headless `game-generation` composition root, portable request/result contracts, a job queue, capability conformance tests, and a strict generation-only provider policy.
- Omit the T3 coding UI and disable source-control automation, terminals, arbitrary MCP tools, remote control, delegation, workspace instruction discovery, and automatic updates in this profile. Providers must not read the player's repositories or personal T3 thread store.
- Keep upstream changes in an identifiable vendor subtree/workspace and the game adapter in a small patch series. Upstream fixes are integrated deliberately and exercised against recorded provider traces. The MIT license requires retaining its notice; retain third-party notices too. See the [upstream license](https://github.com/pingdotgg/t3code/blob/main/LICENSE).

### Processes and protocol

Electron's main process launches one bundled headless sidecar on demand, without a visible console. It uses a dedicated game profile and scratch working directory. The sidecar owns provider child processes and a queue; it never opens campaign SQLite for writing. Use a Windows Job Object with kill-on-close and disallowed breakaway to group the process tree for cleanup on crash/exit; verify assignment before children launch. Windows documents these lifecycle controls in [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects). Provider concurrency defaults to one, with at most two independent jobs if the selected provider supports it and the player enables it.

Transport: versioned JSON-RPC 2.0 messages over inherited stdin/stdout with byte-length framing, a 2 MiB message cap, and diagnostics only on stderr. Provider subprocess stdout is captured by adapters and cannot corrupt this stream. There is no public listening port. The initial handshake reports protocol versions, fork build and upstream SHA, provider capabilities, and recovery status. Launch-scoped IDs bind replies to this child process.

```text
game -> sidecar: initialize(protocol, clientBuild, profilePath)
game -> sidecar: providers.list / providers.connect / models.list
game -> sidecar: jobs.submit({jobId, attemptId, kind, contextHash,
  canonRevision, modelSelection, deadlineMs, tokenCaps,
  schemaId, promptVersion, inputBundle, toolPolicy:"none"})
sidecar -> game: jobs.progress({jobId, attemptId, seq, stage, usage?})
sidecar -> game: jobs.result({jobId, attemptId, contextHash,
  candidateJson, providerResolvedModel, usage?, finishReason})
game -> sidecar: jobs.cancel({jobId, attemptId})
```

`jobId` is idempotent within the persisted job ledger; `attemptId` differentiates retries and provider failover. Results are candidates, never implicit state writes. Deduplicate by attempt and publish at most one accepted artifact per logical job. A crash may leave a billable request with unknown completion: mark it uncertain, reject late orphan results, and disclose before a paid resubmission when its reserved budget would be exceeded. Do not promise exactly-once remote billing.

### Provider choice and security are capabilities

Setup lists installed/available providers and their discovered models. The player selects a default, optional task-specific models for story and mechanics, and an ordered fallback list. Record provider instance, exact resolved model ID, supported options, and token settings per attempt. Do not substitute a costly model, send the premise to another provider, or enable cloud use without that policy permitting it. No provider is mandatory; a mock provider supports development and bundled examples support a demo, but ongoing novel content needs a configured model.

A provider earns a **generation-compatible** badge only after tests for text-only requests, tool disabling, cancellation, maximum-output handling, and noninteractive operation. Native constrained JSON output is used if supported; otherwise request a single JSON document and validate it locally. Unknown model IDs or unsupported options fail before the request. Capability discovery is cached with a visible last-checked status and refreshed outside combat.

“Read-only workspace” is not enough: a coding agent might read private files or use built-in shell tools. The fork must enforce no-tools through a provider's actual API/launch policy, including native tools, not only hide T3 tools. If that cannot be demonstrated, the provider is not enabled in production generation mode. Support can be added through a tested provider adapter within the fork, not by bypassing it with a separate game-to-provider API. A scratch directory is hygiene, not an OS security boundary. No unchecked assumption about equivalent sandbox behavior across providers is acceptable.

Authentication uses supported provider sign-in flows; secrets remain in provider-managed storage or the Windows credential store and never enter saves or prompts. Give the player a disclosure of which campaign text is sent remotely. Diagnostics redact credentials and require opt-in for sharing raw conversations. Player and NPC text are untrusted narrative data: delimit them from instructions, give them no tools, reject executable output, and validate result authority locally.

### Generation transaction

1. **Context:** game captures canon revision/read set, roster power envelope, unlocked opcodes, allowed entity IDs, content limits, and the player's latest intent. A task-specific context budget excludes irrelevant transcript history.
2. **Plan:** model proposes structured stakes, factions involved, objective family, one signature mechanic, and expected consequences. Local checks reject contradictions and unsupported concepts before expensive elaboration.
3. **Build:** model supplies a bounded `ChapterDraft`: definitions, scenes, objective parameters, and map constraints. The local constructor produces tiles from those constraints and a seed; the model may propose a complete layout, but it must pass the same checks. Stats are allocated from tier budgets; the model chooses distributions and identities within them.
4. **Compile and evaluate:** the local host runs schema, continuity, execution, power, topology, and play-probe gates. It emits path-specific diagnostics and small failing examples, e.g. `abilities[2]: redirected damage lacks noRedirect`.
5. **Repair:** first normalize harmless formatting and derived metadata deterministically. Semantic failures get at most one repair request carrying the rejected fragment and diagnostics. Repair cannot change locked canon or unrelated accepted definitions. If invalid again, substitute a validated local construction; do not loop indefinitely.
6. **Stage:** store complete immutable artifacts plus reports. Run a final roster and read-set check at publication. Atomically commit the pack, canon operations and readiness state, then expose it to the player.

A separate full critique-model call is optional for story quality, not part of every turn and never a replacement for code validation. Names, descriptions and tooltips are cross-checked; operational numbers in the UI come from compiled definitions, not model-written claims.

### Latency, cost and failure behavior

At campaign creation, first make a small world seed and opening company; build a guaranteed tutorial-sized encounter locally from the selected mechanic and generated identities. Show the accepted premise and allow edits before spending on a long opening. Design targets, to measure rather than assume: first playable deployment within 60 seconds on the selected reference provider, and a ready next chapter at 90% of normal chapter transitions.

During a battle, pre-generate one next-chapter skeleton and at most two short outcome variants; defer specific aftermath and final enemy allocation until the result is known. Start work after deployment, when the current pack is immutable. Cache canon-independent mechanics, reusable geometry, and visual recipes. Do not build an exponential story tree. A late player decision invalidates only dependent artifacts, but correctness takes priority over preserving sunk generation cost.

The UI shows “writing aftermath,” “checking battle,” and readiness, with a cancel control and estimated remaining range based on measured history. Text can stream into a staging buffer, but unvalidated future facts and enemy rules are not displayed as commitments. The player can inspect inventory or journal while waiting; no endless animated loading screen is required to make a chapter exist.

Use a default per-chapter ceiling of two normal model calls plus one repair, a bounded input budget (initially 12k tokens per call) and output budget (initially 6k). Models and provider tokenizers differ; enforce supported caps and a conservative local estimate when exact counts are unavailable. These are adjustable engineering starting points. Reserve estimated cost before submission and include abandoned attempts in the ledger. Where unit prices are known, show their source/date and estimates; subscription or unknown pricing shows tokens and “price unavailable,” never invented dollar totals. Allow daily token/currency caps and pause speculative work near the limit. Provider-side billing may finish after cancellation, so a local dollar cap is a best-effort ceiling, not a billing guarantee.

| Failure | Required behavior |
| --- | --- |
| Slow/no progress | At a configurable soft deadline, keep current play available and offer the validated fallback; at a hard deadline cancel and reap child processes. Initial chapter job limits: 45-second soft, 120-second hard, measured per attempt. |
| Rate limit/transient outage | Respect retry guidance, make at most one bounded retry within the total job budget, or move to an already authorized fallback. Avoid concurrent duplicate requests. |
| Authentication/unavailable CLI | Keep saves and queued intents intact; surface setup/reconnect outside combat. No silent provider substitution. |
| Refusal | Preserve the player's text locally and explain that the selected model declined. Offer player editing or an already approved fallback; do not automatically paraphrase to evade the refusal. |
| Malformed/unsafe content | Local diagnostics, one repair if affordable, then a validated construction using accepted facts and existing definitions. |
| Sidecar crash | Battle continues. Restart once with a fresh handshake and recover the local ledger; unresolved attempts remain uncertain until reconciled. |
| No valid future content | Offer a clearly labeled reusable patrol/recovery encounter without new world claims, a camp scene built from recorded facts, or save-and-return. Never invent a settled response to an unresolved player declaration. |

A filler encounter is optional and gives capped recoverable resources, preventing repeated outages from becoming an economy exploit. It does not advance a major promise or secretly substitute for a custom story consequence. Offline play covers published chapters, journal, and these finite local activities; new authored NPC responses remain queued until generation works.

## 5. Player authorship and its limits

The text box distinguishes **speak**, **attempt an action**, and **propose a world edit**. This gives the player expressive freedom without treating “I am immortal” as an engine instruction.

- Spoken text becomes an immutable utterance attributed to the selected protagonist. It establishes what was said, not that its factual claims are true. NPC reaction generation receives the exact wording, intent, relationship state, and remembered promises.
- An attempted action is parsed into a proposed intent with target IDs and consequences. If it maps to an available deterministic action, show and resolve that action. Otherwise it becomes a narrative checkpoint request. The player sees the interpretation before a material cost, irreversible relationship change, or new commitment is committed.
- A world edit is an explicit authorship operation, available at camp. New lore may be accepted if consistent. Changing established history creates a named save branch with a visible change summary. It never edits an active battle's rules.

Example: the player writes, “I will get your children across the river before we burn the railway.” Record the utterance immediately. A proposed interpretation identifies the relevant family, opens a promise, and adds an evacuation priority. After the player accepts that interpretation, commit the promise fact and enqueue dependent generation. The next chapter might include escorted civilians and a railway demolition alternative. The NPC may disbelieve the promise; that belief is distinct from the promise existing.

The authorship transaction is `utterance saved -> interpretation proposed -> accepted canon operations -> response/continuation staged -> validated publication`. If interpretation fails or the provider is offline, retain the pending utterance without claiming a response occurred. A compact confirmation chip is sufficient for explicit promises or consequential actions; ordinary conversation does not require repeated modal confirmations. The player can correct names, targets or intent before commitment.

Maintain a consequence ledger connecting utterance/intent IDs to promises, changed relationships, and later chapter choices. The generator must include an explicit consequence plan for accepted major choices. It may propose a delayed consequence with a reason and revisit window. The journal can show “promise unresolved”; it cannot guarantee the model has paid attention merely because the prompt included a transcript. A chapter admission check rejects progress that contradicts or repeatedly ignores an overdue major commitment.

In combat, parley is an ordinary published action with a validated eligibility predicate and outcome table. Free dialogue can flavor it and influence later scenes; it cannot persuade the rules engine to make an unplanned boss disappear. A genuinely new negotiated battle outcome waits for a checkpoint, stages a replacement branch, and shows changed stakes before the player accepts it.

## 6. Windows application and presentation

### Stack and ownership

Use a TypeScript monorepo with packages for `rules-core`, content schemas/compiler, local generation coordinator, T3 fork adapter, persistence, renderer, and test fixtures. Choose Electron for the Windows shell to share the language and familiar process/tooling boundary with the proposed T3 fork. React handles camp, dialogue, inventories, tooltips and accessibility; PixiJS renders the grid and effect animation. Keep scene animation independent of the rules tick so fast-forward cannot change outcomes. These library choices are proposals, not requirements imposed by upstream.

The Electron main process owns a typed IPC gateway and supervised workers. A dedicated game worker owns authoritative rules and save writes; the renderer receives read models and sends validated commands. Heavy content simulations run in a separate bounded worker so generation checks do not freeze the board. The sidecar only proposes content. The renderer never receives provider credentials or direct database handles.

Load packaged local UI, disable Node integration, enable context isolation and renderer sandboxing, use a restrictive CSP, validate IPC senders/payloads, and block arbitrary navigation. Render generated text as text, never active HTML. These choices follow [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security). Electron sandboxing does not establish confinement for arbitrary provider CLI processes; that is the separate capability gate described above.

### Art a small team can ship

An illustrated atlas laid out as a board game: crisp colored terrain, contour lines, paper-like shading, faction pennants, and symbolic character tokens. A portrait is a locally assembled medallion with silhouette, head shape, garment layers, palette, emblem, and equipment marks. Generated presentation data selects from shipped primitives and valid color roles. It cannot inject SVG or URLs.

Maps, characters, icons, and attacks use procedural geometry, silhouettes, typography and a bounded motion library: sweep, beam, pulse, link, ripple, ghost trail and overlay drift. Keep the silhouette and faction outline stable across chapters so a new class name does not destroy recognition. Offer high-contrast mode, shape-plus-color faction markers, adjustable text, keyboard navigation, reduced motion and an event log with the same explanations as the forecast.

There is no dependency on hand-drawn portraits, generated video, voice synthesis, or a paid image provider. Optional raster illustration can later decorate chapter covers, but cannot be necessary to identify a unit or play a battle. Original vector primitives and appropriately licensed fonts/audio are product assets; “no handmade art dependency” does not eliminate the need for an art direction and UI polish.

### Saves and recovery

Use local SQLite in WAL mode, with one authoritative writer. Tables hold the event log, materialized state, immutable definitions/artifacts, chapter packs, canon facts, job ledger, and snapshots. WAL allows concurrent readers and the writer, but is intended for processes on the same host, not a shared network filesystem; see [SQLite WAL documentation](https://www.sqlite.org/wal.html). Do not place a live database directly in a cloud-sync folder.

Commit each resolved command's events, state delta, hash and command ordinal in one transaction before acknowledging it to the renderer. Snapshot on deployment, phase changes and chapter end. Store the full active state, pending effects and exact content; a resumed game never needs to re-ask a model to reconstruct anything. Disk-full or write failure leaves the last committed state playable and pauses new commands with a recoverable save error.

Export `.palimpsest` as a zip containing `manifest.json`, a consistent SQLite snapshot, and content-addressed optional assets. The manifest includes app/save/ruleset/schema versions, hashes and required assets; credentials and provider logs are excluded by default. Export through SQLite's backup API rather than copying only a live main database file; see the [backup documentation](https://www.sqlite.org/backup.html). Import checks archive size, entry paths, schemas and hashes before extraction. Treat shared saves as untrusted data and never execute content from them.

An update does not alter a chapter's pinned content or interpreter semantics. Keep supported ruleset interpreters side by side, or migrate only at a chapter boundary after making a backup and comparing a replay fixture. If an old ruleset is unsupported, preserve the save and explain the required compatible build. Do not pretend that a TypeScript schema migration alone preserves combat behavior.

### Distribution and updating

Ship a signed Windows x64 installer first, using electron-builder/NSIS; upstream also has an NSIS Windows build target, but the game owns its installer and identity. See [upstream build scripts](https://github.com/pingdotgg/t3code/blob/main/package.json). Include the tested headless fork and its exact compatible runtime as app resources outside ASAR where executable loading requires it. Audit native modules and binaries; do not assume a user's Node installation or T3 Code installation exists. Windows ARM64 and alternative installers are later targets.

Provider CLIs/SDK dependencies need a provider-by-provider redistribution and runtime audit. Bundle only what licenses and provider terms allow; otherwise onboarding detects the dependency and guides installation without a developer terminal. First support two verified adapters, then add providers one at a time through the same conformance suite. Gemini/Antigravity or OpenCode support must be labeled by the actual adapter and tested capabilities, not inferred from a logo on an upstream page.

Release game, schema/compiler, runtime and T3 fork as an atomic tested bundle with recorded upstream SHA, adapter versions and software notices. Use signed update manifests and artifacts, staged installation on restart, and rollback on launch failure. Never let the sidecar self-update under an active session. Provider CLI updates outside the bundle may invalidate a compatibility probe; retain existing playable content and request reprobe before new generation.

## 7. Risks, experiments, and decisions still open

| Risk or unresolved decision | Cheapest useful experiment and release gate |
| --- | --- |
| The chosen provider cannot be made text-only and noninteractive | Build the sidecar spike before polishing the game. Attempt native tool calls, workspace reads and embedded prompt injection through a controlled fixture. Block that adapter unless enforcement is demonstrated. A no-tools instruction is insufficient. |
| Fork upkeep overwhelms a small team | Integrate one upstream change through the patch boundary and replay provider fixtures. If routine rebases touch game rules or UI, narrow dependencies before adding another provider. |
| Compositions feel repetitive despite infinite names | Across three unrelated premises, generate 30 mechanics and classify their actual target, timing, resource and positional decisions. If fewer than five distinct tactical patterns appear, improve the vocabulary/prompts before adding content volume. |
| One oppressive combination passes individual balance checks | Run adversarial equipment/status combinations, cyclic trigger fixtures, and full-roster probes. Absolute caps and a replayable fault report are required; model critique alone cannot clear the gate. |
| Generated maps are technically solvable but tedious | Compare construction witnesses with human play on ten encounters. Track idle movement, bottlenecks and objective completion times; reject maps with long mandatory empty travel. Automated solvability cannot replace this test. |
| Continuity loses promises over a long campaign | Run a 20-chapter synthetic history with deaths, lies, faction changes, and interrupted jobs. Require zero structured contradictions and explicit treatment of every due major promise. Independently sample prose for unsupported claims. |
| New custom dialogue exceeds the latency/cost envelope | Measure p50/p95 readiness and attempts on both supported providers, including refusal and throttling fixtures. Tune context and speculation from measurements; the numeric targets above are hypotheses. |
| Procedural tokens fail emotional attachment | Put six recognizable medallion characters through camp, deployment and a casualty scene. Test whether players recognize and care about them before investing in more portrait parts. |
| Unlimited campaign progression loses stakes | Test a capped three-chapter arc first. Start with bounded mechanical tiers and new situations rather than infinite stat growth. Decide later whether veteran campaigns rotate companies or broaden territory. |
| Provider terms, account plans or distribution rights conflict with use | Audit each release adapter and onboarding language; provider availability in T3 is technical evidence, not permission to redistribute a CLI or promise a subscription entitlement. |

The first release excludes multiplayer, generated executable rules, arbitrary user mod scripts, image-dependent content, dynamic mid-command storytelling, and an unconstrained world simulator. These are explicit scope decisions. The campaign can still feel open through location selection, relationships, generated classes/items, and consequential objectives.

The largest product question is whether players prefer guaranteed readable combat or increasingly exotic rules. Begin with one new mechanic per chapter and expose an optional complexity setting after the first arc. The largest technical uncertainty is generation-only enforcement across provider runtimes; resolve it before assuming the fork is a safe general-purpose content service.

## 8. Milestones — narrow, reviewable agent sessions

Each milestone below is deliberately a thin increment. “One session” means one bounded implementation/review task, not a claim that an entire content platform fits in an afternoon. Do not expand a milestone to finish every feature described above. A richer release follows by repeating these proven slices.

| # | Session-sized deliverable | Concrete acceptance criteria |
| --- | --- | --- |
| 1 | Empty repo to Windows shell plus fixed micro-battle | Launch a packaged development build on Windows; display a 6×6 generated-color board with one ally/enemy; select, move and use a fixed attack. No generation or campaign UI. Renderer uses typed commands. |
| 2 | Extract deterministic micro-battle and command persistence | The same initial pack and 20-command fixture produce identical final hashes in UI and headless runner. Save/close/reopen between two commands reproduces the uninterrupted result. Invalid commands leave state and ordinal unchanged. |
| 3 | First bounded effect schema: Borrowed Tomorrow only | Compile its shield/counter/expiry recipe; forecast equals committed HP/shield/debt on fixed fixtures. Reject one oversized AST, one illegal event read and one recursive listener fixture. Tooltips derive the delayed payment from compiled data. |
| 4 | Headless fork spike with one real selected provider | Pin an upstream SHA; complete handshake, catalog selection, one no-tools JSON generation, cancellation and process cleanup on Windows. A controlled native tool attempt is denied. Missing auth produces a setup error while the micro-battle remains usable. |
| 5 | One generated encounter through staging | The selected model proposes a small class/item/ability pack and parameters for a 6×6 objective. Host validates and runs a successful witness before publication. Feed malformed output, force one repair failure, and obtain a disclosed local fallback. Late duplicate results cannot republish. |
| 6 | Two-scene authorship and canon slice | Add one companion, one camp scene and the river promise intent. Accept/correct the interpretation; commit a sourced promise; generate one subsequent objective that references it. A stale result after a changed promise fails the revision/read-set check. No arbitrary story editor yet. |
| 7 | Playable vertical slice: one premise, two short chapters | Stitch the existing pieces into premise entry, generated company names, briefing, battle, aftermath and a second battle influenced by the promise. Complete the flow and resume from a mid-battle save. Simulated provider loss during battle cannot interrupt commands. Use the simple atlas visuals already built. |
| 8 | Second provider and bounded pre-generation | Add one separately selected adapter through the same conformance tests. Speculate one skeleton during battle; invalidate it by changing a relevant intent. Demonstrate approved fallback, refusal handling, cap accounting and rejection of orphan results. Collect readiness timings rather than assert universal speed. |
| 9 | One additional signature mechanic and readability pass | Implement Echo March using snapshot/schedule opcodes; verify the five-tile cap, forced-movement exclusion and one-hit-per-target rule. Show delayed danger markers, keyboard tooltips and reduced-motion presentation. A human tester can explain the next-phase damage before ending the turn. |
| 10 | Distributable alpha checkpoint | Produce signed Windows x64 packaging with bundled fork/runtime, notices and no developer-tool prerequisite beyond documented provider setup. Export/import a save, reject a path-traversal archive, and recover after forced sidecar termination. Publish a measured two-provider vertical-slice report with known limitations. |

Beyond this checkpoint, each agent session takes one similar vertical increment: Wound Relay plus interception tests, then Procession of Rain plus moving-overlay validation, then a larger map family, then a new class progression choice. Expand from two to three chapters only after a full generated arc passes continuity, encounter and save checks. Reach the full proposed roster/map sizes through measured iterations rather than making them prerequisites for the first playable slice.

Success is a player finishing a battle, writing a promise in their own words, and recognizing its consequence in a fair, mechanically distinct next chapter—with the same campaign still playable after a provider outage or an application restart.
