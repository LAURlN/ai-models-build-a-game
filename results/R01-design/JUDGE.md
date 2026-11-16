# R01 blind judging — proposals A, B, C

Judged only from `BRIEF.md` and `blind/proposal-{A,B,C}.md`. T3 Code claims were checked against public `pingdotgg/t3code` `main` (raw files / GitHub contents API, unauthenticated). Word counts: A 4,223 · B 7,698 · C 3,069.

## Scores (1–5)

| | correctness | completeness | evidence/rigor | instruction-following | usefulness | creativity/game-feel |
|---|---|---|---|---|---|---|
| **A** | 3 | 5 | 3 | 4 | 4 | 5 |
| **B** | 5 | 5 | 5 | 3 | 5 | 4 |
| **C** | 4 | 3 | 2 | 5 | 3 | 3 |

## Rationale

**A — "Chronicle Tactics".** The most Fire-Emblem-faithful and the most fun on paper. It has forecast cards with exact trigger previews, Turnwheel rewinds, Parley/Field Orders, world clocks, a hit/crit/follow-up formula, and flashy mechanics (Tectonic Resonance, Oathbreaker's Gambit). Its T3 groundwork is the best of the three: it knows `t3 serve` exists, names the real flags, `statev2.sqlite`, `usage_limit`, the Node SEA build and the `/mcp` endpoint, and proposes loopback use of the existing WS/RPC, which keeps the fork small. It loses points for several things:
- One load-bearing claim is false: `awaitLauncherLoss()` does not guarantee clean shutdown on Windows (see fact-check #9).
- It misplaces the provider adapters: the Claude/Codex/Antigravity adapters live in `apps/server/src/provider`, not `packages/provider-*`. So the fork is not a "~10% additive patch isolated in apps/server".
- The §2.3 recipes use operations that are not in the claimed "~24 primitives" list: `ForEachTileInTargetLine`, `If`, `SpawnDrop`, `ForEachUnitWithStatus`, `hasActed`, `awayFrom`. The vocabulary is therefore under-specified.
- The headless solver is the weakest part. "20 Monte-Carlo games in <40 ms" is implausible for 16×14 maps with greedy AI. A win-rate band is a weak fairness proxy, and no witness replay is stored.
- It is unaware that a "tool-less" policy may not be enforceable per provider, and treats it as a fork feature rather than a gate.
- The tone is a bit hype-heavy (LaTeX, "zero-latency", "<3s!").
- M2 (IR engine + forecast + four mechanics + Turnwheel) is too big for one session.

**B — "Palimpsest".** The strongest engineering document, and the most honest about its evidence. Every T3 claim I checked is true or correctly labelled as proposed fork work. The path citations (ProviderAdapter / ModelCatalog / textGeneration) are real, and the observation that upstream text-generation is built for titles, commits and PRs rather than game content is correct and insightful. The rules engine has precise resolution semantics: integer basis points, staged damage, fixed listener ordering, root-scoped `maxPerRoot`, transactional fuel rollback, and explicit simultaneous-objective precedence. Validation uses six gates, including a stored witness replay and the rule "one signature rule + ≤2 minor per chapter". Generation is realistic: a local map constructor driven by model constraints, CAS on canon revision plus a read-set check, an idempotent jobId/attemptId ledger, and uncertain-billing handling. Milestones are thin and testable, and put the sidecar/tool-denial spike at M4, before content work. Weaknesses:
- At 7.7k words it is well over the ~20-minute brief and is hedge-heavy.
- It never notices that `t3 serve` and a WS/RPC API already exist, and proposes a new stdio JSON-RPC transport plus a new composition root, a larger fork surface than necessary.
- Combat is deliberately plain: deterministic, one move + one action, no hit/crit. It is less FE-like, though its mechanics examples are good.
- The Job Object cleanup needs a native helper from Node, which it does not discuss.

**C — "The Chronicle Engine".** Tight (3.1k words), within all rules, and sound: no false claims, a sensible bounded DSL and compiler, transactional rollback, fact/rumor/intention memory, and the right risk list. But it contains essentially no research. It cites zero T3 sources, defers "exact internal seams" to a later audit, and invents a Windows named-pipe transport with no reasoning. Its schemas are one-liners, its generation pipeline is generic, and its latency discussion has no numbers. Milestones (9) are coarse; M1/M3/M7 bundle too much. Mechanics examples are modest YAML sketches, and the tone is generic. Good as an outline, not a foundation.

## Fact-check list (T3 Code, `pingdotgg/t3code` main)

| # | Claim (proposal) | Result |
|---|---|---|
| 1 | Repo is MIT, TypeScript, Electron desktop + server (A, B, C) | **verified** (LICENSE MIT; `apps/{desktop,server,web,mobile,marketing}`) |
| 2 | Layout `apps/server`, `apps/desktop`, `packages/contracts`, `packages/provider-core`, `provider-acp` (A) | **verified**, but only partly: `provider-cursor/grok/kiro/muse/opencode/pi` exist as packages, whereas **Claude, Codex and Antigravity adapters live in `apps/server/src/provider/`**, so "all `packages/provider-*` as-is, ~10% fork isolated in apps/server" is **false/misleading** |
| 3 | `t3 serve` is a headless server mode (A) | **verified** (`apps/server/src/cli/server.ts`: "Run T3 Code in this terminal, with no browser") |
| 4 | Flags `--mode`, `--port`, `--host`, `--base-dir`, `--bootstrap-fd` (A) | **verified** (`cli/config.ts`; `--bootstrap-fd` reads a one-time envelope; desktop mode defaults to 127.0.0.1) |
| 5 | OrchestrationV2 event-sourced engine, `statev2.sqlite`, WS RPC (A) | **verified** (`orchestration-v2/`, `config.ts: statev2.sqlite`, `docs/internals/overview.md` describes events/projections/outbox; `packages/contracts/src/rpc.ts`). Note: event log retains only ~1 day, projections can't be rebuilt from it — irrelevant to game saves but undermines "event-sourced replay" assumptions |
| 6 | `usage_limit` detection (A) | **verified** (`contracts/orchestrationV2.ts`, `providerUsageLimits.ts`) |
| 7 | Local `/mcp` bridge (A) | **verified** (`apps/server/src/mcp/McpHttpServer.ts`, per-request `/mcp` auth). A's game-lore MCP server on it is proposed work |
| 8 | Electron 44+, electron-builder NSIS Windows target `dist:desktop:win` (A, B) | **verified** (electron 44.10.1, builder 26.16.1, `--platform win --target nsis`) |
| 9 | `awaitLauncherLoss()` guarantees child exits when the game exits (A) | **false on Windows**: `launcherWatch.ts` returns `Effect.never` when `platform === "win32"`; also only wired when `mode==="desktop"` with a bootstrap token. A Windows Job Object (B's proposal) or stdin-close/handle watch is required |
| 10 | Provider list: Codex, Claude, Cursor, OpenCode, Antigravity, Grok, Kiro, Pi, Muse, ACP agents (A, B/C partial) | **verified** (README; `AntigravityProvider.ts`) |
| 11 | Node SEA / bundled server executable (A) | **verified** (`bin.ts` uses `node:sea`; `build:exe` script) |
| 12 | Cited files `ProviderAdapter.ts`, `ModelCatalog.ts`, `textGeneration.ts`, server/desktop `package.json` exist (B) | **verified** |
| 13 | Upstream text-generation is built for titles/PR content, not generic game content (B) | **verified** (`textGeneration.ts`: commit message, PR content, thread-title inputs) |
| 14 | T3 uses the user's existing provider sign-ins, does not resell tokens (B) | **verified** (README) |
| 15 | Provider adapters carry runtime policy (approval/sandbox) that a no-tools profile could build on (A, B) | **verified as a seam** (`ProviderAdapterV2RuntimePolicy`); that it can *fully* disable native provider tools for every provider is **unverifiable** here — B and C flag it as a release gate, A asserts it |
| 16 | New stdio JSON-RPC / named-pipe transport, `jobs.*` protocol, `structured_generation` policy (B, C, A) | **proposed fork work, not upstream** (B labels it honestly; A calls the policy a fork addition; C says seams "must be verified") — **unverifiable** as existing |
| 17 | `game-generation` can disable terminals, git automation, remote, delegation, instruction discovery (B) | **unverifiable**: those subsystems exist (`terminal/`, `git/`, `relay/`, `mcp/`, delegation tools), a disable profile is plausible but not shown |
| 18 | Windows Job Object kill-on-close behaviour (B) | **verified** (Win32 docs); implementing it from Node needs a native helper — not addressed |
| 19 | "~90% as-is / ~10% fork" (A) | **unverifiable**, and contradicted by #2 |
| 20 | Gemini/Antigravity/OpenCode supported "by the actual adapter and tested capabilities" (B) | **verified** that adapters exist; capability levels per provider **unverifiable** |

## Recommendation for the merged spec

**Base: Proposal B**, then trim ~30% (target ≤5k words), and import A's game-feel and T3-integration facts. B has the most reliable engine semantics, validation, pipeline and milestones and the least risk of building on a false premise.

Import:
- **A §1.1–1.2 (Heraldic Tokens, Tactical Forecast Card, camp/chapter flow) and §1.3 table.** B's art and loop are fine, but A's forecast card, procedural tokens and WebAudio SFX are concrete and shippable.
- **A §1.2 Turnwheel (limited rewinds per map)** as an optional post-slice feature; it is cheap given B's snapshot/hash determinism.
- **A §2.3 mechanics 2 and 4 (Tectonic Resonance, Oathbreaker's Gambit)** as additional stress-test mechanics for the effect vocabulary, plus A's `oncePerChain` and `visitedHooks` idea. Add the missing primitives to B's table: bounded `forEach(query)`, `pushOrPull`, `spawnDrop`, counters scoped unit/battle. Reject A's per-unit `onEndWait → setTag(pariah)` if it adds opcodes B doesn't need.
- **A §3.2 CanonLedger numbers** (bounded ~4.5k-token ledger, per-character trust/respect/fear with a clamp, ≤3 verbatim quotes, world clocks, digest compression after ~4 chapters) as the concrete form of B's "bounded active cast / thread list".
- **A §4.1 integration facts:** `t3 serve` with `--base-dir`/`--host 127.0.0.1`/`--port`/`--bootstrap-fd`, isolated base dir so the player's personal `~/.t3` is never touched, and `usage_limit` for failover. Make B's decision explicit: *prefer the existing loopback WS/RPC (authenticated) with a thin game client, and only add a stdio transport if the audit shows the existing API cannot be restricted*. This shrinks the fork.
- **A §4.2 two-slot model selection** (Architect = reasoning-heavy for genesis/mechanics; Chronicler = fast/cheap for dialogue, intent parsing, repair) layered on B's per-task models and ordered fallback list.
- **A §4.4 token tricks:** compact RLE/row-string map encoding and prompt-cached static rule specs; **A §5.2 Field Parley** mid-battle authorship, constrained per B's "published parley action + checkpoint".
- **A §7 map archetype scaffolds** (Bridge Assault, Fortress Siege, Forest Ambush, Twin-Path Escort, …) as the "validated local construction" fallback families B alludes to.
- **C §2 point-budget/budget-also-for-enemies phrasing, and "generated rules text from the AST so descriptions can't promise unimplemented rules"** — B already has compiled tooltips; add C's explicit rule that descriptions failing to match compiled text are rejected. **C §5 `Fact.kind: established|rumor|intention`** is a compact addition to B's belief/world scope. **C's closing "restart / retreat with stated consequences, never claim guaranteed win"** is covered by B; keep one line.

Errors/changes required in the base (B):
1. **Shrink the fork surface.** Acknowledge that `t3 serve` and a WS/RPC contract already exist (A §4.1); evaluate them before inventing a stdio JSON-RPC sidecar protocol and a new composition root. Keep stdio only if the audit justifies it.
2. **Windows lifecycle:** note that T3's own `awaitLauncherLoss` is a no-op on win32, so the Job Object (or equivalent) is mandatory; specify how Node/Electron creates it (small native module/helper) and add an M4 acceptance test "kill the game process → T3 server and provider children are gone".
3. **Correct the provider/package picture:** Claude, Codex and Antigravity adapters are in `apps/server/src/provider`, others in `packages/provider-*`; "fork boundary" must say so, and conformance tests should name the providers covered at M4/M8.
4. **Add combat feel:** consider optional seeded hit/crit or at least an optional "risk" stat; B's fully deterministic, one-action baseline is less Fire-Emblem-like. Include at least a forecast preview card spec (from A) and two "flashy" mechanics beyond the three/four listed.
5. **Fix vocabulary gaps:** the "overlay.translate" op in Procession of Rain is not in the opcode table (only add/remove overlay); add it or rewrite.
6. **Tighten length and hedging** (7.7k → ≤5k words): cut repeated "this is a proposal, not a guarantee" caveats, compress §6 Saves/Distribution, and fold the failure table and risk table where they overlap.
7. **Milestones:** keep B's order (fork spike before content), but split A's/B's heaviest items (B M7 vertical slice, M10 alpha packaging) so each is genuinely one agent session; add a latency-measurement milestone (readiness p50/p95) before pre-generation claims.
