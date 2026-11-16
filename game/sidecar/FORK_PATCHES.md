# Headless T3 Code Fork Pin & Patch Ledger

- **Upstream repository:** `https://github.com/pingdotgg/t3code`
- **Pinned commit:** `e72dd5055eb437c93c0b3ddf710246ecbfe1f16e`
- **Vendored location:** `game/sidecar/`

## Scope & Build Layout

Vendors `apps/server` and its required workspace packages (`contracts`, `shared`, `provider-core`, `provider-acp`, `effect-acp`, `effect-codex-app-server`, `secret-provider-*`, `source-control-core`). Browser UI, mobile/desktop Electron shells, and optional non-core providers/VCS integrations are omitted or replaced with minimal build-time stubs in `sidecar/stubs/` so `esbuild` bundles a single headless ESM executable (`dist/sidecar/bin.mjs`).

## Patches Applied to Upstream

1. **Structured JSON generation contract & pipeline**
   - `packages/contracts/src/game.ts`, `packages/contracts/src/rpc.ts`, `packages/contracts/src/index.ts`: Added `WS_METHODS.gameGenerate` (`game.generate`) and `WS_METHODS.gameCancel` (`game.cancel`), schemas `WsGameGenerateRpc` / `WsGameCancelRpc` / `GameGenerateInput` / `GameGenerateResult`, and registered them in `WsRpcGroup`.
   - `packages/provider-core/src/server/textGeneration.ts`, `textGenerationUtils.ts`, `textGenerationOperations.ts`: Added `withRawJsonSchema`, `generateStructuredJson`, and Effect Schema JSON extraction so callers can pass an explicit JSON Schema object for structured output without changing upstream commit/PR/title generation paths.
   - `apps/server/src/textGeneration/TextGeneration.ts`: Added `generateStructuredJson` method on the server `TextGeneration` service (no silent fallback provider switching inside T3; the game coordinator owns model selection and fallback).
2. **Plain chapter generation through the text-generation adapters**
   - `apps/server/src/textGeneration/CodexTextGeneration.ts`, `ClaudeTextGeneration.ts`, `AntigravityTextGeneration.ts` (via `TextGeneration.ts` / structured JSON runner): Plain chapter requests use single-turn structured output, without the investigation mode. Codex uses a read-only sandbox; Claude receives an empty `--tools` list. Antigravity receives a no-tools instruction in its prompt (not an adapter-enforced sandbox). R06 agent requests deliberately enable native tools as described in item 6 below.
3. **Game generation & cancellation RPC service + deterministic fake provider**
   - `apps/server/src/game/GameGeneration.ts`: Executes `game.generate` in an interruptible Effect fiber keyed by `attemptId` so `game.cancel` interrupts the active generation fiber cleanly.
   - `apps/server/src/game/FakeProvider.ts`: Deterministic offline fake provider (`CHRONICLE_FAKE_PROVIDER=1`) routed through the exact same WS-RPC, server config, and `provider.auth.*` interfaces, persisting fake auth state strictly inside the sidecar `--base-dir` (`fake-providers.json`).
4. **Profile isolation & RPC authorization allowlist (`--game-profile`)**
   - `apps/server/src/config.ts`, `apps/server/src/cli/config.ts`: Added `--game-profile` CLI flag and `T3CODE_GAME_PROFILE` environment setting.
   - `apps/server/src/auth/RpcAuthorization.ts`: When `gameProfile` is enabled, restricts WS-RPC methods to the game allowlist: probe, get config, refresh providers, update provider/settings, config/lifecycle subscriptions, provider-auth start/respond/complete/cancel/remove-method/logout/subscribe, and game generate/cancel. All orchestration thread/git/terminal/filesystem RPCs are denied at authorization time.
5. **WebSocket server wiring & pruning stubs**
   - `apps/server/src/ws.ts`: Provided `GameGeneration.layer`, passed `{ gameProfile }` to `RpcAuthorization.layer`, wired `[WS_METHODS.gameGenerate]` and `[WS_METHODS.gameCancel]`, and routed `server.*` / `provider.auth.*` through `FakeProvider` when `CHRONICLE_FAKE_PROVIDER=1`.
   - `apps/server/src/provider/builtInDrivers.ts` & `apps/server/src/sourceControl/sourceControlDefinitions.ts`: Retained core Codex / Claude / Antigravity / ACP providers and pruned excluded third-party provider/forge packages behind compile stubs in `sidecar/stubs/`.
   - `apps/server/src/terminal/NodePtyAdapter.ts`, `apps/server/src/workspace/WorkspaceSearchIndex.ts`, `apps/server/src/policy/ManagedPolicy.ts`: Replaced `createRequire(...)` of pruned native dependencies (`node-pty`, `@ff-labs/fff-node`, `ffi-rs`) with static imports mapped to `sidecar/stubs/` and bypassed HKLM policy lookup under `--game-profile`.

6. **Agent mode for living campaigns (R06)**
   - `packages/contracts/src/game.ts`: `GameGenerateInput` gains `agent: { cwd }` and the `narrator` / `helper` / `archivist` roles.
   - `packages/provider-core/src/server/textGeneration.ts`, `textGenerationOperations.ts`: structured requests may carry `agent: { timeoutMs }`.
   - `apps/server/src/textGeneration/CodexTextGeneration.ts`: in agent mode Codex runs with `-s danger-full-access` (full shell, file and code execution) in the campaign workspace instead of `read-only`.
   - `apps/server/src/textGeneration/ClaudeTextGeneration.ts`: in agent mode Claude keeps its full native tool set (`--tools` is not emptied) with `--permission-mode bypassPermissions`.
   - `apps/server/src/game/GameGeneration.ts`: agent requests run in the given workspace directory with a 15-minute default deadline. Plain chapter generation keeps the old tool-less, read-only path.
7. **Scripted story fake (R06)**
   - `apps/server/src/game/FakeStory.ts` (+ routing in `FakeProvider.ts`): deterministic Narrator, helper and archivist for `CHRONICLE_FAKE_PROVIDER=1`. The fake helper really writes module and battle files into the campaign workspace (copying the workspace's `examples/`), so tests exercise the whole loop offline. Test flags (`[FORCE_DELAY_MS=n]`, `[FORCE_FAIL]`, `[FORCE_BROKEN_MODULE]`, `[FORCE_RUNTIME_FAULT]`, `[FORCE_HANG]`, `[FORCE_REPAIR_FAILS]`) are honoured only in the newest player message or helper brief.

8. **Release metadata and notices**
   - `sidecar/package.json` and all ten vendored `packages/*/package.json` explicitly declare `MIT`, matching the upstream root licence; `apps/server/package.json` already declares MIT. Added `NOTICE` identifying the modified fork. The upstream `LICENSE` is unchanged. Packaging copies these notices and this ledger into `resources/licenses/t3code/`, and places the bundled headless executable outside `app.asar` in `resources/runtime/sidecar/`.
