# Chronicle Tactics — Technical & Game Design Proposal

**Document status:** Round R01 Design Blueprint  
**Target platform:** Windows Desktop (x64 / arm64)  
**Core premise:** A Fire Emblem–inspired turn-based tactical RPG whose world, cast, maps, classes, items, and custom mechanics are generated on the fly by user-selected LLM agents running through a headless fork of [T3 Code](https://github.com/pingdotgg/t3code).

---

## 1. Vision & Core Loop

### 1.1 Aesthetic & Experience Without Hand-Made Art
Hand-drawn character portraits and pixel sprite sheets break down when every chapter invents new classes, factions, and monsters on the fly—and AI raster generation introduces style drift and multi-second asset stalls. **Chronicle Tactics** adopts a **Tactical Cartography & Heraldic Codex** aesthetic that is 100% procedurally rendered from structured metadata:

- **Battlefield:** An architectural parchment-and-slate war table rendered in PixiJS. Procedural noise and contour lines generate elevation, forest canopies, chasms, bridges, and ruins; dynamic tile overlays show Fire Emblem–style blue move range, red threat zones, and pulsing amber hazard/aura tiles.
- **Units:** Crisp vector **Heraldic Tokens** built parametrically from `ClassArchetypeShape` (shield, diamond, crescent, hex, crown) + faction palette + deterministic procedural SVG crest (`sigilSeed`) + weapon glyph + compact HP/status pips.
- **Combat & Story Presentation:** Clicking an attack opens a zero-latency **Tactical Forecast Card** (`HP 24→11 | Hit 88% | Crit 12% | +Triggers`) showing exact Rule IR hooks that will fire. Confirming runs a crisp 0.7s board-native lunge, spark/particle burst, floating damage numbers, and procedural WebAudio synth SFX. Story scenes render as an illuminated **Chronicle Split-Pane**: faction crests, speaker mood tags, atmospheric backdrop tint, typographic dialogue, and an inline **Player Authorship** input bar.

### 1.2 Session & Campaign Flow
A campaign begins with a **Genesis Prompt** (e.g., *"Sunken brass-and-salt empire where clockwork inquisitors tax memories instead of coin"*), tone/difficulty sliders, and **Provider & Model Selection** (picking any agent/model discovered by the embedded T3 server).

1. **Opening Chronicle (1–2 min):** The generator establishes 3–5 world laws, initial factions, the protagonist + 3 starting retainers, and Chapter 1's opening scene.
2. **Camp / War-Council Phase (2–5 min):** Between battles, the player inspects the roster, equips/forges items, reads optional camp banter, and responds to story events via choices or **free-text dialogue**.
3. **Tactical Chapter (10–20 min):** Classic Player Phase → Enemy Phase → Ally/Hazard Phase grid combat on 12×10 to 22×18 maps with diverse objectives (`Rout`, `Seize`, `Defeat Boss`, `Survive`, `Escort`, `Sabotage`, or generated hybrid objectives). Mid-battle, a **Turnwheel** (limited rewinds per map) lets players recover from misclicks or surprising enemy mechanics, while an optional **Parley / Field Order** action lets players inject free-text diplomacy or taunts mid-fight.
4. **Aftermath & Speculative Advance (30–60 sec):** Victory commits casualties, vows, loot, and player choices into the **Canon Ledger**, levels units, and seamlessly hands off to Chapter $N+1$ (already pre-staged in the background during the battle's final turns).

### 1.3 What Is Fixed vs. Generated

| Fixed (Engine & Guardrails) | Generated (Per Campaign & Chapter) |
| :--- | :--- |
| Turn phases (Player / Enemy / Other), grid topology, movement cost rules, terrain avoidance/defense caps | World premise, factions, political tensions, magic/tech laws, chapter arcs |
| Core 9 stats (`HP, Str, Mag, Skl, Spd, Lck, Def, Res, Mov`), hit/crit/follow-up (`AS >= DefAS + 4`) formulas, weapon-triangle structure | Cast (names, personalities, backstories, personal skills, growth profiles, sigils) |
| **Rule IR** primitive vocabulary, trigger hooks, max cascade depth (`6`), numeric balance envelopes | Classes, weapons, relics, status effects, terrain hazards, and custom **Rule IR** ability ASTs |
| Deterministic combat forecast, AI tactical utility scorer, Turnwheel state log | Map geometry, terrain placement, deployment/reinforcements, victory/defeat conditions |
| Validation pipeline & Tactical Winnability Solver | Dialogue scenes, branching consequences, reactions to player free-text |

---

## 2. Rules Engine Architecture

### 2.1 Why a Declarative Rule IR (Instead of Arbitrary Script `eval`)
Allowing an LLM to emit arbitrary JavaScript/Lua for abilities creates three fatal problems for a Fire Emblem–style tactics game:
1. **Broken Combat Forecasts:** Fire Emblem combat relies on showing an exact preview (`Damage`, `Hit%`, `Crit%`, `Doubles`, `Lethal`) *before* committing. Arbitrary imperative scripts cannot be cleanly inspected or side-effect-isolated during preview.
2. **AI Blindness:** Enemy AI cannot evaluate whether moving onto a tile or attacking triggers a deadly custom trap if ability logic is an opaque script.
3. **Runtime Instability:** Infinite loops, mutated shared references, and non-deterministic `Math.random()` calls break Turnwheel rewind and replay.

Therefore, all generated classes, weapons, statuses, tile effects, and skills express their mechanics in a **Typed, Pure, Deterministic Effect & Trigger IR (`RuleIR`)** interpreted by a sandboxed TypeScript simulation kernel:

```ts
simulate(state: BattleState, action: PlayerAction, rngSeed: number): {
  nextState: BattleState;
  events: BattleEvent[];      // Drives PixiJS animations & combat log
  forecast?: CombatForecast;  // When run in { dryRun: true }
}
```

### 2.2 The Rule IR Model

```ts
export type TriggerHook =
  | "onBattleStart" | "onTurnStart" | "onPhaseStart" | "onPhaseEnd"
  | "onMove" | "onEnterTile" | "onLeaveTile"
  | "onForecast"       // Pure combat stat/preview modifiers (Mt, Hit, Crit, AS, Dr)
  | "onBeforeAttack" | "onHit" | "onMiss" | "onDamaged" | "onHeal"
  | "onKill" | "onUnitDeath" | "onEndWait" | "onUseActive";

export interface AbilityRule {
  id: string;
  name: string;
  kind: "passive" | "active" | "weapon_trait" | "status_rule" | "tile_rule";
  triggers: TriggerRule[];
  activeSpec?: {
    costType: "action" | "free_once_per_turn" | "hp" | "charge";
    costAmount: number;
    range: { min: number; max: number };
    targetFilter: TargetFilter; // self | ally | enemy | empty_tile | line | radius
    cooldownTurns: number;
  };
}

export interface TriggerRule {
  hook: TriggerHook;
  priority: number;            // Deterministic tie-breaker (lower runs first)
  oncePerTurn?: boolean;
  oncePerChain?: boolean;      // Prevents A -> B -> A ping-pong within one cascade
  condition?: Expr<boolean>;   // Bounded AST (max depth 8)
  effects: EffectOp[];         // Ordered atomic mutations
}
```

**Expression & Effect Vocabulary (~24 primitives):**
- **Selectors / Queries:** `self`, `other` (combat opponent), `unitAt(pos)`, `unitsInRadius(origin, r, filter)`, `unitsInLine(origin, dir, len)`, `tileAt(pos)`, `distance(a, b)`, `isAdjacent(a, b)`, `isFlanked(u)`, `hasTag(u, tag)`, `counter(scope, key)`.
- **Numeric Expressions:** Arithmetic (`+ - * / min max clamp`), `stat(u, key)`, `hpMissing(u)`, `hpRatioPct(u)`, `movedTiles(u)`, `turnNumber()`, `stackCount(u, statusId)`.
- **Atomic `EffectOp`s:**
  - `ModifyForecast` (`mt`, `hit`, `crit`, `avoid`, `attackSpeed`, `damagePct`, `flatDr`, `pierceDefPct`, `forceFollowUp`, `preventCounter`)
  - `DealDamage` (`physical | magical | true`, `amountExpr`, `nonLethal?: boolean`)
  - `Heal` (`amountExpr`)
  - `ApplyStatus` / `RemoveStatus` (`statusId`, `stacks`, `durationTurns`, `payloadExpr?`)
  - `AdjustCounter` (`scope: "unit" | "battle"`, `key`, `deltaExpr`)
  - `PushOrPull` (`target`, `direction`, `cells`, `collisionDamageExpr`)
  - `SwapPositions` (`unitA`, `unitB`)
  - `SpawnTileEffect` (`pos`, `tileEffectId`, `durationTurns`)
  - `GrantExtraAction` (`oncePerTurnKey`, `restrictTo?: "move_only" | "attack_only"`)
  - `RedirectDamage` (`toUnit`, `pct`)
  - `SummonUnit` (`templateId`, `pos`, `maxActiveTokens: 2`)
  - `ShiftAllegiance` / `SetTag` (`tag`, `value`)

### 2.3 Four Unusual Mechanics Expressed in Rule IR

#### Mechanic 1: *Borrowed Second* (Chronomancer Active — Extra Action Now, Escalating Debt Later)
- **Player feel:** Spend your action to immediately grant yourself a bonus action this turn (`GrantExtraAction`), but incur `Temporal Debt` stacks. If you fail to score a kill before your next turn starts, the debt detonates as true damage.
- **Rule IR:**
  - `onUseActive`: `GrantExtraAction({ key: "borrowed_second", restrictTo: "any" })` + `ApplyStatus(self, "temporal_debt", stacks: 1, duration: 2)`.
  - `status_rule("temporal_debt")`:
    - `onKill` (`oncePerChain: true`): `RemoveStatus(self, "temporal_debt", all: true)` + `Heal(6)`.
    - `onTurnStart`: `DealDamage(self, kind: "true", amount: 10 + 5 * stackCount(self, "temporal_debt"), nonLethal: true)` + `RemoveStatus(self, "temporal_debt", all: true)`.

#### Mechanic 2: *Tectonic Resonance* (Geomancer Active — Line Knockback + Collision + Terrain Mutation)
- **Player feel:** Shatter a 3-tile line, turning flat ground into jagged `cracked_stone` for 3 turns, shoving enemies backward, and slamming them into walls or each other for bonus collision damage and stun.
- **Rule IR:**
  - `activeSpec`: `range: 1..2`, `targetFilter: line(length: 3)`.
  - `onUseActive`:
    1. `ForEachTileInTargetLine`: `SpawnTileEffect(tile, "cracked_stone", duration: 3)` (`cracked_stone` rule: `movCost +1`, `onEnterTile` applies `brittle_earth` `-15 Avoid`).
    2. `ForEachUnitInTargetLine(enemy)`: `DealDamage(target, "magical", 0.8 * stat(self, "Mag"))` → `PushOrPull(target, awayFrom(self), cells: 2, collisionDamage: 8)` → `If(collided, ApplyStatus(target, "stunned", duration: 1))`.

#### Mechanic 3: *Sympathetic Ledger* (Blood-Pact Tactician — Damage Redirection & Inverted Healing)
- **Player feel:** Link yourself to an ally within 2 tiles (`bound_ledger`). Half the damage they take bleeds onto you instead, while any healing *you* receive mirrors onto them—turning positioning and frail frontline protection into a puzzle.
- **Rule IR:**
  - `onUseActive`: `ApplyStatus(targetAlly, "bound_ledger", duration: 3, linkedUnitId: self.id)`.
  - `status_rule("bound_ledger")`:
    - `onDamaged` (`condition: distance(self, linkedUnit) <= 4`): `RedirectDamage(to: linkedUnit, pct: 50)`.
  - Passive on Tactician:
    - `onHeal` (`oncePerChain: true`): `ForEachUnitWithStatus("bound_ledger", linkedTo: self)` → `Heal(other, 0.75 * event.healAmount)`.

#### Mechanic 4: *Oathbreaker's Gambit* (Cursed Relic Weapon — Moral Counter & Faction Rule Shift)
- **Player feel:** Striking an unacted or flanked foe grants lethal bonuses (`+30 Crit, +6 Mt`), but increments your `broken_oaths` counter. At 3 broken oaths, you become a `Pariah`: allied support auras stop working on you, enemies prioritize you, and kills drop rare contraband.
- **Rule IR:**
  - `weapon_trait("oathbreaker")`:
    - `onForecast` (`condition: !hasActed(other) || isFlanked(other)`): `ModifyForecast(mt: +6, crit: +30)`.
    - `onBeforeAttack` (`condition: !hasActed(other) || isFlanked(other)`, `oncePerChain: true`): `AdjustCounter("unit", "broken_oaths", +1)`.
    - `onEndWait` (`condition: counter("unit", "broken_oaths") >= 3 && !hasTag(self, "pariah")`): `SetTag(self, "pariah", true)` + `ApplyStatus(self, "pariah_bounty", permanent)`.
    - `status_rule("pariah_bounty")`: `onKill`: `SpawnDrop("contraband_pouch")`; `onForecast` (`condition: adjacentAllyCount > 0`): `ModifyForecast(suppressSupportBonuses: true)`.

### 2.4 Validation, Balance & Anti-Breakage Guarantees
Every generated entity passes a **4-stage deterministic gate** before reaching the player:

1. **Schema & Structural Bounds:** Effect Schema validation; AST max depth $\le 8$; max `effects` per trigger $\le 6$; strings/names length-capped.
2. **Cascade & Infinite-Loop Safety:**
   - Static check rejects self-recursing unconditional `onUseActive` → `GrantExtraAction` without `oncePerTurn`.
   - Runtime enforces `MAX_TRIGGER_DEPTH = 6` and a `visitedHooks` set keyed by `(chainId, ruleId, sourceUnitId, targetUnitId, hook)`. Any repeated key is skipped with a diagnostic trace—making infinite loops impossible.
3. **Power-Budget & Stat Clamping:**
   - Each chapter tier $T \in [1..20]$ defines strict stat/weapon envelopes (e.g., Chapter 1 weapon Mt $\in [2, 11]$, Hit $\in [65, 100]$, Crit $\in [0, 25]$, non-boss HP $\in [14, 30]$).
   - **Rule Complexity & Power Scorer** assigns points to `ModifyForecast`, `DealDamage`, `GrantExtraAction`, and `SummonUnit`. Items/skills exceeding the chapter budget are automatically scaled down (`Mt`/`duration`/`cooldown` clamped) or kicked back to the repair pass.
4. **Map Winnability & Softlock Proof (Headless Solver):**
   - **Reachability Graph:** BFS/A* from every player deployment tile across movement types (`Foot`, `Armored`, `Mounted`, `Flier`) verifies all required `Seize` tiles, chests, bosses, and `Rout` enemies are reachable (accounting for keys/levers if doors exist).
   - **Objective Sanity:** `Survive N` clamped to `4 <= N <= 10`; `Escape` verifies `shortestPath / minPartyMov <= turnLimit * 0.7`.
   - **Fast Monte Carlo Auto-Battler (20 headless games, <40ms total):** Runs a greedy tactical AI for both sides. Rejects maps where Player Win Rate is `<15%` (unfair/unwinnable spike) or `>95%` in $\le 2$ turns (trivial wipe). Failed maps emit structured failure diagnostics (e.g., `"Boss at (14,2) unreachable: chasm blocks path; Player 2-turn wipe rate 90%"`) for the LLM repair pass.

---

## 3. Content Data Model & Canon Storage

All content types live in a shared TypeScript package (`packages/game-contracts`) validated with `effect/Schema`.

### 3.1 Core Entity Schemas (Condensed)

```ts
export interface CampaignState {
  id: string;
  premise: string;
  toneTags: string[];              // e.g. ["grim_political", "clockwork_arcane"]
  worldLaws: string[];             // 3-5 immutable metaphysical/social rules
  chapterIndex: number;
  masterSeed: number;
  canon: CanonLedger;
  roster: UnitDefinition[];
  convoy: ItemInstance[];
  factions: FactionState[];
  difficulty: "tactician" | "classic" | "story";
}

export interface ChapterPackage {
  id: string;
  chapterNumber: number;
  title: string;
  preBattleScene: DialogueEvent;
  map: TacticalMap;
  objective: ObjectiveSpec;        // rout | seize | defeat_boss | survive | escape | custom_flag
  secondaryObjectives: SecondaryObjective[];
  enemySquads: UnitSpawn[];
  reinforcements: ReinforcementWave[];
  midBattleEvents: ConditionalBattleEvent[]; // e.g., Turn 4 dialogue, boss parley
  postBattleHooks: PostBattleHook[];
}

export interface TacticalMap {
  width: number;                   // 12..24
  height: number;                  // 10..20
  biome: string;                   // Drives procedural palette & contour style
  tiles: TileCell[];               // terrainId, elevation (0..3), passableMask, avoidBonus, defBonus
  deploymentSlots: Coord[];
  interactables: MapInteractable[];// chests, levers, bridges, healing shrines, escape zones
}

export interface UnitDefinition {
  id: string;
  name: string;
  title: string;
  allegiance: "player" | "enemy" | "ally" | "neutral";
  classId: string;
  level: number;
  stats: Record<"hp"|"str"|"mag"|"skl"|"spd"|"lck"|"def"|"res"|"mov", number>;
  growths: Record<"hp"|"str"|"mag"|"skl"|"spd"|"lck"|"def"|"res", number>;
  abilityIds: string[];
  inventory: ItemInstance[];
  aiProfile: "aggressive" | "guard_zone" | "hunter" | "support" | "flee" | "boss_stationary";
  visual: { sigilSeed: number; primaryHex: string; accentHex: string; shape: string };
  alive: boolean;
}
```

### 3.2 Canon, Continuity & Memory Architecture (`CanonLedger`)
Feeding raw dialogue transcripts to an LLM degrades quality and blows token budgets by Chapter 5. Instead, continuity is stored in a **structured, bounded `CanonLedger`** (<4,500 tokens even at Chapter 20):

1. **`facts: CanonFact[]`** — Atomic statements (`id`, `chapter`, `text`, `entities: string[]`, `status: "active" | "superseded"`, `importance: "core" | "flavor"`). Dead units are tagged `status: "deceased"` deterministically by the battle engine; the validator blocks spawning deceased units unless a `resurrected` fact exists.
2. **`characterMemories: Record<UnitId, CharacterMemory>`** — Per-unit trust/respect/fear axes (`-100..100`), up to 5 active `vowsOrGrudges`, and up to 3 verbatim `memorablePlayerQuotes` so companions recall *exact* promises the player typed chapters ago.
3. **`worldClocks: WorldClock[]`** — Named progress bars (`"Clockwork Inquisition Suspicion": 3 / 6`, `"Bridge Integrity": 2 / 4`) that unlock consequences when filled.
4. **`chapterDigests: ChapterDigest[]`** — One 120-word structured summary per finished chapter (older digests compress to 1-sentence milestones after 4 chapters, while full details stay queryable via our read-only Lore MCP tool).

---

## 4. Generation Pipeline & Headless T3 Code Integration

### 4.1 How T3 Code Works & What We Fork
Based on [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (`AGENTS.md`, `docs/internals/overview.md`, `apps/server/src/bin.ts`, `apps/server/src/cli/server.ts`, `docs/internals/adding-a-provider.md`):
- T3 Code is a TypeScript monorepo (`apps/server`, `apps/desktop`, `packages/contracts`, `packages/provider-core`, `packages/provider-*`) running an event-sourced `OrchestrationV2` engine backed by SQLite (`statev2.sqlite`) and WebSocket JSON-RPC.
- Provider CLIs (Codex, Claude Code, Cursor, OpenCode, Antigravity, Grok, Kiro, Pi, Muse, and ACP Registry agents) run as subprocesses behind `ProviderAdapterV2` or `packages/provider-acp`, exposing normalized `OrchestrationV2ProviderCapabilities` and model catalogs.
- `t3 serve` runs headless (`--mode desktop`, `--port`, `--host 127.0.0.1`, `--base-dir`, `--bootstrap-fd` for passing `DesktopBackendBootstrap` secrets cleanly).

**Process Model:**
The game's Electron main process spawns the bundled headless T3 server as a supervised child process on loopback (`127.0.0.1:<ephemeralPort>`), passing an isolated `--base-dir %APPDATA%\ChronicleTactics\t3-home` (never touching the user's personal `~/.t3/userdata`) and a one-time bootstrap token via `--bootstrap-fd` so `awaitLauncherLoss()` guarantees clean shutdown when the game exits.

**What Is Used As-Is vs. Forked:**

| Used As-Is (~90% of T3 Code) | Surgical Fork Additions (~10%, isolated in `apps/server`) |
| :--- | :--- |
| All `packages/provider-*` & `packages/provider-acp` adapters | **1. `structured_generation` Runtime Policy:** Disables shell, git, edit, and web-fetch tools on game threads so coding agents act purely as structured generators and cannot execute commands on the player's PC. |
| Provider discovery, auth status, `usage_limit` detection & model manifest | **2. Game-Lore Read-Only MCP Server:** Exposes `get_canon_facts`, `get_roster_summary`, `get_rule_ir_spec`, and `validate_draft` over T3's local `/mcp` bridge so agents can verify Rule IR or recall old chapters on demand. |
| `OrchestrationV2`, SQLite `statev2.sqlite`, WebSocket RPC (`packages/contracts`) | **3. JSON Output Extractor:** Normalizes streaming text deltas and extracts schema-typed JSON objects (handling markdown code fences cleanly). |

### 4.2 Provider & Model Selection
On launch (and in Settings), the game queries T3's provider status cache and presents every authenticated provider/model in plain player terms with two assignable slots:
- **Architect Model (High Reasoning):** Used for Campaign Genesis, Chapter Map/Encounter Forge, and novel Rule IR mechanics (e.g., Claude Sonnet/Opus, Codex/GPT-5, Gemini Pro).
- **Chronicler Model (Fast / Low Cost):** Optional faster slot for mid-dialogue NPC replies, free-text intent evaluation, and quick schema repair passes (e.g., Claude Haiku, Gemini Flash, or a local OpenCode model). Defaults to the Architect model if only one provider is configured.

### 4.3 Generation Flow: Decomposed Pipeline → Validate → Repair

```
[Campaign/Canon Context]
        │
        ▼
 (1) Beat & Cast Planner ──► JSON Schema check ──► [Repair turn if invalid]
        │
        ▼
 (2) Map & Encounter Forge (selects Map Archetype + places terrain/units/objectives)
        │
        ▼
 (3) Mechanics & Item Forge (emits Rule IR ASTs for new classes/weapons/skills)
        │
        ▼
 (4) Deterministic Gate (Schema + Rule IR depth/budget + 20-game Winnability Solver)
        │
   ┌────┴────┐
 Pass       Fail (max 2 retries on same T3 thread with exact solver/AST errors)
   │         │
   ▼         ▼ (if still failing after 2 retries)
[Stage]   [Deterministic Auto-Clamp / Safe Template Fallback]
```

**Why multi-step over one giant prompt?** Asking an LLM for dialogue, a 16×14 tile grid, 12 unit stat blocks, and 4 novel Rule IR abilities in one shot spikes failure rates and latency. Splitting into 3 focused turns (using T3 thread context reuse / prompt caching) raises first-pass validity dramatically and lets the UI stream story beats while the tactical map finishes generating.

### 4.4 Latency, Cost & Resilience Strategy
- **Speculative Pre-Generation:** Once a battle crosses ~70% completion (e.g., $\le 3$ enemies left or boss below 40% HP), a background T3 thread pre-generates **Chapter $N+1$'s map archetype, enemy templates, and opening hook** using current `CanonLedger`. At victory, only a small delta pass reconciles final casualties/vows (<3s!).
- **Natural Latency Absorbers:** Opening story beats, level-up summaries, and Camp/Convoy management run concurrently while final map validation finishes.
- **Cost & Token Discipline:** Compact `CanonLedger` (<4.5k tokens), enum-indexed terrain/tile encoding (`RLE` or compact string rows like `"..FF..MM.."` instead of 250 verbose JSON tile objects, cutting map tokens by ~80%), and prompt-cached static Rule IR specs.
- **Provider Failure & Slowness Playbook:**
  - *Slow (>12s):* Non-blocking diegetic status (*"Scouts charting the valley…"*); player can browse Codex, reorder inventory, or cancel/switch provider.
  - *Rate/Usage Limit (`usage_limit` from T3):* Surface reset time, offer 1-click provider failover to any other configured provider, or enter **Offline/Fallback Contract Mode** (generates an immediate playable tactical skirmish from cached campaign templates + deterministic Rule IR mutations so gameplay never stalls).
  - *Refusal:* Automatic 1-shot neutral reframe preserving tactical stakes; if refused again, prompt the player to adjust their free-text input.

---

## 5. Player Authorship

Player-written dialogue and story decisions must genuinely reshape the campaign without letting adversarial or whimsical text (`"I pull out an orbital laser with 9999 damage"`) shatter game balance.

### 5.1 Two-Stage Authorship Pipeline
1. **Consequence Interpreter (Chronicler Model):**
   - Player utterance is wrapped in strict data delimiters (`<player_utterance>...</player_utterance>`) inside a tool-less `structured_generation` T3 turn.
   - Alongside the NPC's in-character response, the model outputs a constrained **`NarrativeDelta`**:
     ```ts
     interface NarrativeDelta {
       npcReply: { speakerId: string; mood: string; line: string };
       relationshipDeltas: Array<{ unitId: string; trust: number; fear: number; respect: number }>; // clamped -20..+20
       newFacts: Array<{ text: string; tags: string[]; importance: "core" | "flavor" }>;
       worldClockDeltas: Array<{ clockId: string; delta: number }>;
       memorableQuote?: string; // Stored verbatim if pivotal
       proposedTrigger?: {      // Optional mechanical consequence
         kind: "grant_boon" | "impose_curse" | "recruit_ally" | "enemy_defect" | "unlock_sub_objective";
         targetUnitId: string;
         thematicPrompt: string;
       };
     }
     ```
2. **Mechanical Mediation:**
   - If the player writes something absurd (*"Give my sword 999 attack"*), the NPC treats it as empty boasting or hubris (`respect -5`), and any `proposedTrigger` still goes through the **Rule IR Power-Budget Validator**. A creative bargain (*"I pledge half our gold to the Ferryman's Guild if they sabotage the western bridge"*) legitimately triggers a `worldClockDelta`, deducts gold via the engine, and instructs the next chapter's Map Forge to spawn the western bridge already rigged or collapsed.

### 5.2 Mid-Battle Authorship ("Field Parley")
Once per battle (or when adjacent to a named enemy/boss), a unit can spend a free **Parley / Taunt** command to type a short line. The Fast Chronicler model evaluates the unit's `CanonLedger` history (e.g., referencing a spared relative from Chapter 2) and can return an in-battle dialogue burst plus a valid Rule IR effect (`aiProfile` shift, duel challenge, morale debuff, or `recruitable` flag unlock).

---

## 6. Tech Stack & App Architecture

| Layer | Choice | Justification |
| :--- | :--- | :--- |
| **Language** | **TypeScript** (strict mode) end-to-end | Shares `packages/game-contracts` & `effect/Schema` across Electron, PixiJS UI, Rules Engine, and T3 Code fork; maximizes velocity for an agent-driven team. |
| **Desktop Shell** | **Electron** (following T3 Code's `apps/desktop`, Electron 44+) | Bundles Node + T3 server natively without cross-language IPC/FFI; proven Windows signing/packaging via `electron-builder`. |
| **UI & HUD** | **React 19 + Tailwind CSS + Radix primitives** | Fast iteration for combat forecasts, codex, inventory, dialogue split-pane, and provider setup wizard. |
| **Tactical Renderer** | **PixiJS 8** (WebGL2 + Canvas fallback) | 60–144 FPS tile maps, procedural SVG-to-texture heraldic tokens, shaders/lighting, smooth camera zoom/pan, zero hand-made art pipeline. |
| **Agent Harness** | **Forked `pingdotgg/t3code` (`apps/server`)** | Reuses battle-tested multi-provider adapters, auth flows, SQLite orchestration, and MCP bridge. |
| **Persistence** | **SQLite (`campaign.sqlite`)** per campaign + `.chronicle.zip` export | ACID saves, append-only battle turn events for Turnwheel rewind & deterministic replay debugging; zero save corruption on crash. |
| **Testing** | **Vitest** (`simulate()` unit tests, Rule IR fuzzing, Winnability Solver tests, headless T3 mock replay fixtures) | Sub-second deterministic feedback loops for coding agents. |

### 6.1 Windows Packaging, Bundling & Updates
- **Installer:** `electron-builder` NSIS installer (`.exe`, x64 and arm64), matching T3 Code's `dist:desktop:win` pipeline.
- **Bundling the T3 Fork:** Built into `resources/t3-server/` (compiled server bundle / Node SEA + native deps) inside the Electron package. The game spawns it directly as a child process—players never install Node, `pnpm`, or T3 Code separately; they only sign into whichever agent CLI(s) they already use (detected automatically via T3's provider status probes, with guided setup buttons if missing).
- **Keeping Upstream Fresh:** Maintain `vendor/t3code` (or a sibling fork package) tracking `upstream/main` with our additive patchset (`structured_generation` policy + lore MCP server) kept in isolated modules so merging upstream provider updates requires minimal conflict resolution.

---

## 7. Risks & Open Questions

1. **Rule IR Expressiveness vs. LLM Accuracy:** Complex mechanics could lead to invalid ASTs.
   - *De-risk:* Keep Rule IR under ~25 primitives; include 12 canonical "Gold Archetype" examples in system prompts; validate with Effect Schema + 2-turn self-repair + fallback clamping.
2. **Generated Maps Being Reachable Yet Tactically Dull:** Passing BFS reachability doesn't guarantee fun Fire Emblem pacing (e.g., empty plains or 1-tile chokepoint stalemates).
   - *De-risk:* Author 8 parameterized **Map Archetype Scaffolds** (*Bridge Assault*, *Fortress Siege*, *Forest Ambush*, *Twin-Path Escort*, etc.) and add tactical density/chokepoint/turn-to-contact heuristics to the Winnability Solver.
3. **Coding-Agent Defaults Fighting Pure JSON Output:** Codex/Claude Code are tuned to inspect repos and run commands.
   - *De-risk:* Enforce `structured_generation` mode (empty/virtual sandbox + zero shell/edit tools) and test prompt compliance across all major providers in CI replay fixtures early (Milestone 3).
4. **Latency Spikes on Slow Providers:** A 40-second wait between battle and camp feels sluggish.
   - *De-risk:* Speculative pre-generation during late battle turns, compact string-grid map encoding, and instant Skirmish Board fallback on timeout/rate-limit.
5. **Multi-Chapter Canon Drift:** Subtle contradictions over 10+ chapters.
   - *De-risk:* Deterministic post-chapter ledger updates (deaths, items, clocks enforced by code, not LLM memory) + read-only Lore MCP lookup.
6. **Turnwheel Undo With Stateful Mechanics:** Custom counters and spawned tokens could desync on rewind.
   - *De-risk:* Keep `BattleState` 100% pure JSON-serializable; every Turnwheel step restores an immutable snapshot + RNG cursor with zero side-channel state.
7. **Open Question — Voice/Audio & Dynamic Music:** Procedural WebAudio chimes and tension-reactive synth pads ship cheaply; whether to add optional local TTS or keep silent codex typography can be decided post-vertical-slice without architectural impact.

---

## 8. Milestone Plan

Each milestone is scoped for a single focused engineering session with verifiable acceptance criteria.

1. **M1 — Project Scaffold, Electron Shell & PixiJS Tactical Grid**
   - *Scope:* Monorepo setup, Electron + React + PixiJS 8 window, procedural terrain tiles, camera pan/zoom, heraldic unit token rendering, player/enemy phase loop with basic movement & standard attack.
   - *Acceptance:* App launches on Windows; hardcoded 12×10 test battle runs to victory/defeat at 60 FPS with zero external art files (`vp/vitest` grid pathfinding tests pass).

2. **M2 — Deterministic Rule IR Engine, Forecast & 4 Gold Mechanics**
   - *Scope:* Implement pure `simulate()`, `RuleIR` AST interpreter, `MAX_TRIGGER_DEPTH = 6` loop guard, exact `CombatForecast` dry-run, and the 4 benchmark mechanics from §2.3 (*Borrowed Second*, *Tectonic Resonance*, *Sympathetic Ledger*, *Oathbreaker's Gambit*).
   - *Acceptance:* Unit tests prove forecast == actual combat outcome across all 4 mechanics, infinite-loop test terminates cleanly, and Turnwheel snapshot restore matches state hash byte-for-byte.

3. **M3 — Headless T3 Code Fork Integration & Provider Picker**
   - *Scope:* Vendor/fork `t3code` `apps/server`, add `structured_generation` tool-less policy, wire Electron main lifecycle (`--base-dir`, `--bootstrap-fd`), build Provider & Model Selection UI.
   - *Acceptance:* Game spawns headless T3 server on Windows, discovers available providers/models, completes a schema-validated JSON turn with shell/fs tools disabled, and cleanly terminates child processes on window close.

4. **M4 — Content Schemas, Balance Clamper & Winnability Solver**
   - *Scope:* `packages/game-contracts` schemas for all entities, power-budget clamper, BFS/A* reachability checker, and 20-game fast headless auto-battler.
   - *Acceptance:* Validator catches planted broken inputs (unreachable boss, 999 Mt weapon, cyclic Rule IR) in `<50ms` and emits structured repair diagnostics.

5. **M5 — Chapter Generation Pipeline, Map Archetypes & Repair Loop**
   - *Scope:* 3-stage generation pipeline (Beat/Cast → Archetype Map Forge → Rule IR Forge), compact grid encoding, 2-retry repair loop, and deterministic fallback templates.
   - *Acceptance:* Given any free-text campaign premise, pipeline produces a playable, solver-verified Chapter 1 package end-to-end (tested with live provider + deterministic replay fixture).

6. **M6 — Campaign Persistence (`campaign.sqlite`), Camp Phase & Turnwheel**
   - *Scope:* SQLite save/load, Turnwheel rewind UI, Camp convoy/equip/level-up screen, Chapter $N \to N+1$ progression.
   - *Acceptance:* Mid-battle save, process restart, and reload preserves exact unit positions, custom counters, and Turnwheel history; `.chronicle.zip` export/import round-trips cleanly.

7. **M7 — Player Authorship, `CanonLedger` & Lore MCP**
   - *Scope:* Free-text dialogue input UI, `NarrativeDelta` interpreter, `CanonLedger` deterministic death/clock enforcement, mid-battle Parley action, and read-only Lore MCP server in T3 fork.
   - *Acceptance:* Typing a story vow or parley updates `CanonLedger`, rejects/deflects stat-cheat prompts without breaking balance, and influences Chapter 2's generated dialogue/map state.

8. **M8 — Speculative Pre-Generation, Failover & Windows NSIS Installer**
   - *Scope:* Background Chapter $N+1$ pre-generation at 70% battle progress, `usage_limit` provider failover, Skirmish Board fallback, and `electron-builder` NSIS `.exe` packaging.
   - *Acceptance:* Clean Windows NSIS install runs on a fresh machine with zero Node/dev tooling installed; simulated provider rate-limit seamlessly offers failover or fallback skirmish without losing campaign progress.
