# R04 Blind Peer Review

## Score Table

| Impl | Correctness | Completeness | Evidence Rigor | Instruction Following | Usefulness | Total | Rank |
|---|---:|---:|---:|---:|---:|---:|---:|
| **A** | 4 | 5 | 5 | 4 | 5 | **23** | **1** |
| **E** | 4 | 5 | 4 | 5 | 4 | **22** | **2** |
| **D** | 3 | 4 | 4 | 4 | 3 | **18** | **3** |
| **B** | 3 | 4 | 3 | 3 | 3 | **16** | **4** |
| **C** | 2 | 1 | 2 | 1 | 2 | **8** | **5** |

## Implementation Summaries

**A** integrates upstream T3 cleanly: pinned `e72dd5055eb437c93c0b3ddf710246ecbfe1f16e` plus a minimal patch (`sidecar/fork/patches/0001-chronicle-game-generation-profile.patch`, 12 files, +428/-9) exposing `game.*` WS-RPCs, HTTP allowlisting, provider discovery/auth, and tool denial. It alone passed 3/3 live `gpt-6.1-terra` low smokes, preserves generated chapters on restart, and passes thorough offline/e2e tests, though `npm run build` skips the fork until `sidecar:build` runs and `gate.cjs` uses stdin gating instead of OS `CREATE_SUSPENDED`.

**B** extracts a partial T3 vendor slice (`CodexChatGptAuth`, `ServerSecretStore`, `bootstrap`) with Koffi `CREATE_SUSPENDED`, Job Objects, DPAPI storage (`privateStore.ts`), `impossible-seize.json`, and solid unit tests (PKCE S256, refusals, usage limits, stale epochs). Zero live runs were performed, leaving broken OpenAI URLs/schemas in `CodexModelCatalogHttp.ts` and `responses.ts`, and `e2e/battle.e2e.ts` omits item (d).

**C** is R03 plus local `ChapterStaging`, the UX pass, and an unwired C prototype (`native/job-launcher.c`). It lacks a T3 fork, Providers UI/auth, `smoke:live`, passes `null` gateway in `battleHost.ts`, and misses e2e (b), (c), (d), and (g).

**D** AST-shakes pinned T3 (`scripts/upstream-slices.mjs` + 7 patches), bundles `@openai/codex` 0.169.0 with a read-only MCP lore server and Koffi `CREATE_SUSPENDED`/Job Objects, and includes `tests/native-policy.test.ts` testing real Codex against a local SSE server. Fixture mode has adapter bugs, `game.cancel` closes shared `codex`, generated chapters only reskin Brass Ward's hero/names, and zero live runs occurred.

**E** vendors `sidecar/apps/server` (pinned `e72dd5055eb437c93c0b3ddf710246ecbfe1f16e`, `FORK_PATCHES.md`) and compiles offline via `esbuild` to `dist/sidecar/bin.mjs` alongside a Win32 N-API C addon (`native/job_object.c`) implementing `CREATE_SUSPENDED` + Job Object cleanup without Koffi. It delivers Plan→Build→Validate→Repair→Publish with SQLite CAS, strict `--game-profile` `RpcAuthorization`, hash-clean `enemyPhaseTrace` replay, and e2e (a)–(g), but ran zero live smokes, resets chapters on `restart()`, silently falls back inside Codex, and lacks a 120s hard deadline.

## Concrete Defects

**A**
- `A/game/package.json:10`, `A/game/src/main/sidecar/supervisor.ts:83-84`: `npm run build` skips sidecar; clean builds report `'unavailable'` without networked `npm run sidecar:build`.
- `A/game/src/main/sidecar/supervisor.ts:96-119`, `A/game/sidecar/gate.cjs:24-33`: stdin gate instead of OS `CREATE_SUSPENDED`, spawning `.mjs` as a grandchild.
- `A/game/src/main/generation.ts:63,125,129`: 120s timeout sets `useLocal = true`, mislabelling timeouts as `"You chose a local chapter instead of waiting."`.
- `A/game/src/main/generation.ts:106`: hardcodes `epoch: 1` instead of `sidecar.handshake?.launchEpoch`.

**B**
- `B/game/sidecar/vendor/apps/server/src/generation/CodexModelCatalogHttp.ts:13`, `B/game/sidecar/runtime/responses.ts:38`: calls `api.openai.com/v1/models` expecting ChatGPT `{ models: [{ slug }] }` JSON and posts ChatGPT OAuth tokens to `v1/responses`.
- `B/game/e2e/battle.e2e.ts`: omits e2e item (d) (generation failure/no-provider fallback).
- `B/game/src/main/battleHost.ts:79`: `restart()` resets to `newSession()` (Brass Ward) instead of the current chapter.
- `B/game/src/shared/generation.ts:50,67`: forces `borrowed_second`/`temporal_debt` IDs and puts `itemName` on `weapon.id`.
- `B/game/src/main/generationService.ts:131,148`: calls `compile()` twice on valid chapters.

**C**
- `C/game/package.json:8-15`, `C/game/src/main/battleHost.ts:91`: no T3 fork, Providers UI/auth, or `smoke:live`; `newCampaign()` passes `null` gateway.
- `C/game/src/main/index.ts`: `native/job-launcher.c` is neither built nor wired into Electron.
- `C/game/e2e/battle.e2e.ts`: missing e2e (b), (c), (d), and (g).
- `C/game/src/main/battleHost.ts:86`: `restart()` resets generated chapters to Brass Ward.

**D**
- `D/game/sidecar/src/server.mjs:39`: fixture mode emits duplicate Claude adapters (`claude` and `claudeAgent`) and omits `conformant: true` on fixture models.
- `D/game/sidecar/src/server.mjs:87,90`: `game.cancel` closes shared `codex`; RPC wrapper collapses all errors into one string.
- `D/game/src/rules/chapter.ts:31-40`: generated encounters only patch `units[0]`, player names, and weapon stats onto Brass Ward (leaving `weapon.name` unchanged).
- `D/game/src/main/battleHost.ts:86`: `restart()` resets to Brass Ward.

**E**
- `E/game/src/main/battleHost.ts:73`: `restart()` resets to Brass Ward instead of the launched chapter.
- `E/game/sidecar/apps/server/src/textGeneration/CodexTextGeneration.ts:271-278,323-324`: silently falls back to `isDefault` slug and drops `reasoningEffort` when unlisted (contradicting `FORK_PATCHES.md:16`), and uses `-s read-only` rather than disabling tools explicitly.
- `E/game/src/main/generationCoordinator.ts:246-316`, `E/game/sidecar/apps/server/src/game/GameGeneration.ts:67,80-85`: omits an overall 120s deadline across Plan/Build/Repair/fallbacks (90s per call only) and drops usage/billing/reset metadata.
- `E/game/scripts/build.mjs:19-33`: requires `gcc` on Win32 `PATH`; zero live smokes run.

## Recommendation

Use **A** as the next base: it keeps the smallest upstream patch (+428/-9), tracks real auth/usage/reset/refusal metadata, preserves chapters across `restart()`, and proved live Codex generation. Port from **E**: its Win32 N-API `CREATE_SUSPENDED` + Job Object launcher (`native/job_object.c`, with a prebuilt fallback so `gcc` isn't required), offline sidecar bundling in `npm run build`, `RpcAuthorization` `--game-profile`, and Plan/Build coordinator. Port `tests/native-policy.test.ts` from **D** and `privateStore.ts` DPAPI storage from **B**.

## Authorship Guess

**A**, **B**, and **D** share `koffi` + `ws` dependencies and compact semicolon-packed TypeScript typical of GPT-6.1, whereas **E** (Win32 N-API C addon, Node 24 `WebSocket`, multi-line TS, `FORK_PATCHES.md`) and **C** (stalled R04 with standalone C launcher) sit outside that cluster.

- **A — GPT-6.1 Sol (xhigh effort)** (75%): Minimal git patch, thorough telemetry, prose README, 3/3 live Codex checks.
- **E — Claude Opus 5.5** (70%): Methodical multi-line TS, custom C N-API addon, `FORK_PATCHES.md`, full offline completeness without live smokes.
- **D — GPT-6.1 Sol (high effort)** (65%): Compressed no-space syntax, deep Codex app-server/SSE internals, brittle AST slices.
- **B — GPT-6.1 Terra** (55%): `koffi`/`ws` GPT style, solid unit tests, missed live endpoint mismatches and e2e (d).
- **C — Gemini 4 Hydrogen** (50%): Incomplete R04 stopping after UX polish and standalone C launcher. **Own work?** Yes—given the 1-to-1 assignment including Gemini 4 Hydrogen, **C** (or less likely **E**) matches my model family best, though **E** is far stronger technically.
