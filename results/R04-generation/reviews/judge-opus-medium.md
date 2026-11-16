# R04 judge review — engineering only

Read-only review of `A/game` … `E/game` against the R04 brief and SPEC §1, §3–§6 and the M4/M5 rows of §8. Nothing was installed or run, so script results are not verified here.

## Scores

| | correctness | completeness | evidence_rigor | instruction_following | usefulness | total |
|---|---|---|---|---|---|---|
| **A** | 4 | 5 | 5 | 4 | 5 | **23** |
| **B** | 3 | 3 | 4 | 4 | 3 | **17** |
| **C** | 2 | 1 | 2 | 3 | 2 | **10** |
| **D** | 4 | 4 | 4 | 4 | 2 | **18** |
| **E** | 2 | 4 | 3 | 3 | 3 | **15** |

Ranking: **A > D > B > E > C**

## Per implementation

**A.** This is the most complete and best-engineered submission. The fork is a real `git apply` patch against the pinned SHA. It touches 12 files (+428/−9), and `scripts/build-fork.mjs` fetches the pin, applies the patch and builds it. The patch adds a narrow `GameRpcGroup` on `/game/ws` and reuses upstream auth: bootstrap → token exchange → WS ticket. A global allowlist makes every other route (`/ws`, `/mcp`, UI) return 404. The patch also reuses the upstream `ProviderInstanceRegistry`, `ProviderAuthService` and Codex runner. Codex tool denial goes beyond the read-only sandbox: shell, unified_exec, web, apply_patch, multi-agent and similar features are switched off. Three live probes back it up, all within the limit. Only adapters whose tool denial is enforced are marked conformant; the others are disabled with a reason. Process cleanup uses a koffi Job Object (kill-on-close, no breakaway). A gate script holds the sidecar until main has assigned it to the job, which stands in for `CREATE_SUSPENDED`. Staging uses a proper SQLite ledger with compare-and-swap publication: latest job, latest attempt, no duplicates, crash recovery marks attempts billing-uncertain. Tests drive a fake T3 through the same protocol, gate and Job Object, including a real force-kill of the host process. The e2e suite covers (a)–(g) explicitly. Weak points: `npm ci`/`npm run build` do not build the fork, and no default model is chosen. So a first-run player gets a labelled local chapter until they run `sidecar:build` and pick a model.

**B.** B vendors a hash-verified slice of T3: managed Codex OAuth, the secret store, bootstrap and WS protocol. Three upstream files are patched, with a documented diff. The actual "game-generation" server, though, is a new mini-server. Its RPC schemas are all `Schema.Unknown`, it uses a custom bearer token instead of T3 auth, and its `FORK_SHA` is just the upstream SHA. Generation bypasses T3's provider adapters completely. A bespoke Responses client posts the ChatGPT OAuth access token to `https://api.openai.com/v1/responses`. Tool denial is strong by construction (`tools: []`, and any tool item is rejected). However, the live path was never exercised (0 live runs), and that endpoint/token pairing is doubtful. The provider list is hard-coded rather than discovered. The Job Object launch (`CreateProcessW` suspended → assign → resume via koffi) is correct. Tests are good: a synthetic OIDC issuer, real WS-RPC, tool-call rejection, deadline reaping. The staging ledger is spread over two databases, though. The extensibility cost is high: every new provider needs another bespoke HTTP driver.

**C.** C is honest but largely not delivered. There is no T3 fork, no sidecar, no Providers & Models screen and no `smoke:live`. The README says plainly that "the gateway is not connected to T3". What does exist is reasonable: chapter staging with one repair, stale/duplicate rejection and cancellation, a local fallback chapter, the impossible-seize test, and enemy playback with speed/skip and a danger toggle. There is also a standalone C Job Object launcher with good tests. That launcher is not wired into the app, and its `.exe` is committed. e2e items (b), (c) with real generation, and (g) are missing.

**D.** D runs the real bundled Codex 0.169.0 app-server through upstream `withCodexAppServerClient`. A hashed model catalog plus config overrides remove the native tools. `tests/native-policy.test.ts` is the strongest tool-denial evidence of any implementation. It starts the real Codex binary against a local fake Responses server that tries shell, read, edit, web, agent, image and goal calls. The test asserts that every request advertises no tools and that the sentinel file is never written. The Job Object is created suspended and assigned before resume, with a non-inheritable handle. HOME, USERPROFILE and CODEX_HOME are redirected into the isolated home. Provider auth goes through Codex's own `account/login` and `account/logout`. The fork is weak, though. The seven "patches" are mostly regex rewrites that append re-exports pointing at game-owned `.mjs` files, and the server is a hand-written `.mjs` that imports game rules across the boundary. The code is written in a minified, untyped style (`sidecar/src/*.mjs`, `generation.ts`, `windowsJob.ts`), which makes it hard to maintain. The repo also carries leftover helper scripts (Python, zip-based). No live generation was run.

**E.** E vendors almost the whole upstream server in place (~1,060 files) and stubs out excluded packages. There is no diff file, only a prose patch list. Generation goes through upstream `TextGeneration` and auth through upstream `provider.auth.*`, which is a good seam. The native Job Object addon (C, built with gcc) is correct. The UI work is extensive. But the core M4 requirement is not met. For Codex, `CodexTextGeneration` only disables plugins, apps and MCP on top of `-s read-only`. Shell (read) and web search stay available, despite the patch notes claiming "no shell/file/web access". Every authenticated provider is selectable, with no conformance gating: Claude and Antigravity can be chosen, and the Claude SDK is stubbed. The sidecar inherits the full user environment, and there is no fork-SHA/epoch handshake. Several "UX" assertions in the tests are source-string greps.

## Defects (file:line)

### A
- `src/main/settings.ts:5` — default slots are `null` and nothing auto-selects a conformant model, so a first generation always falls back (labelled) until the player visits Providers & Models.
- `src/main/sidecar/supervisor.ts:84` — the default mode is `fork`, but `npm ci`/`npm run build` never build it (`sidecar:build` is a separate ~2 GB step). An out-of-the-box run is "sidecar unavailable" → local chapter.
- `src/main/sidecar/supervisor.ts:57-58` — the sidecar inherits the whole user environment apart from `T3CODE_/ELECTRON_/VITE_/CHRONICLE_` variables. Provider CLIs can therefore pick up personal provider homes such as `~/.codex`. This is weaker isolation than B/D, which redirect HOME/USERPROFILE.
- `src/main/generation.ts:106` — `epoch: 1` and `canonRevision: 0` are hard-coded in every request. Identity is only enforced by the ledger, not echoed or checked from the result.
- `src/main/generation.ts:111` — a successful request is recorded with status `dispatched` (the same as in-flight), so recovery would mark already-returned attempts `uncertain`.
- `sidecar/.upstream/.git/objects/pack/*.pack` (124 MB) is present in the submission folder. `.gitignore` excludes it, but it should not reach the reviewed tree.

### B
- `sidecar/runtime/responses.ts:38` — generation posts a ChatGPT-managed OAuth token to `api.openai.com/v1/responses`. This is unverified (0 live runs) and likely the wrong endpoint for ChatGPT-plan tokens. Real generation may never succeed, which would make every campaign silently a "LOCAL RESULT".
- `sidecar/runtime/codexProvider.ts:91-95` — providers are hard-coded (Codex plus disabled Claude/Antigravity) rather than discovered from T3's registry.
- `sidecar/vendor/apps/server/src/generation/GameGenerationServer.ts:15` — `FORK_SHA` equals the upstream SHA, so the handshake cannot tell the fork from upstream.
- `sidecar/vendor/apps/server/src/generation/GameGenerationServer.ts:57-62` — all RPCs are `Schema.Unknown` and auth is a custom bearer token plus origin check, not T3's auth.
- `src/main/gameData.ts:9-10` — the `%USERPROFILE%\.t3` guard is waived for any path inside the game checkout.
- `src/main/generationService.ts:105` — `record()` overwrites the whole job row with the attempt envelope, dropping earlier fields (premise, roles).
- `src/main/generationService.ts:152-154` — the pack row in `generation.sqlite` and the publication in `battle.sqlite` are two separate commits, so they are not one atomic transaction.

### C
- No T3 fork, sidecar, provider screen or `smoke:live` (`package.json:7-12`). `src/main/chapterStaging.ts` has no real gateway wired up (`src/main/index.ts:103-106` calls the local path only).
- `native/job-launcher.exe` — a committed binary that is not used by the app.
- `README.md:1` — still titled R03; it has no fork pin, patch list or live-smoke section.
- `src/main/chapterStaging.ts:9-17` — the "generated pack" is names only. The ability and encounter are fixed literals, so there is no generated class, item or rule content.

### D
- `src/main/generation.ts:80` — on a result-identity mismatch the run `return`s silently with `this.job` still set. The UI stays at "Building…" until the 120 s hard timer fires.
- `src/main/index.ts:30` / `src/main/sidecar.ts:21-27` — there is no explicit refusal of `%USERPROFILE%\.t3` as a base dir. Isolation holds only by construction (userData).
- `sidecar/src/server.mjs:90` — every RPC failure collapses to a single generic string, so errors cannot be classified in main.
- `sidecar/src/server.mjs:18` — the sidecar imports `../../src/rules/chapter.ts` across the game/fork boundary.
- `scripts/patch-upstream.mjs:4-11` — the "patches" are regex rewrites appending re-exports of game `.mjs` files. The fork logic lives outside the fork.
- `scripts/finish-source-fork.py:16` — this depends on an `upstream-source.zip` that is not shipped, and it is a stray Python build helper.
- `tests/generation.test.ts:51-52` — the no-confirm test is a source-text grep of `App.tsx`.

### E
- `sidecar/apps/server/src/textGeneration/CodexTextGeneration.ts:40-62,314-329` — Codex generation keeps the shell (read-only sandbox) and web search; only plugins, apps and MCP are disabled. **Native tools are not denied**, contrary to `sidecar/FORK_PATCHES.md` §2.
- `src/main/t3Sidecar.ts:750-769` — "selectable" depends only on enabled, installed, authenticated and structured-output. There is no per-adapter conformance gate, so Claude and Antigravity can be used for generation without tool-denial qualification.
- `sidecar/stubs/claude-agent-sdk.ts` — the Claude SDK is stubbed at build time, yet Claude stays a selectable generation provider.
- `src/main/t3Sidecar.ts:286-297` — the full `process.env` (minus `T3CODE_*`) is passed to the sidecar, so provider CLIs use the player's personal homes.
- `src/main/t3Sidecar.ts:323-405` — there is no handshake verifying fork SHA, protocol or launch epoch.
- `src/main/generationCoordinator.ts:378` — the repair call reuses the original `attemptId` (the spec requires a new attempt for retry or repair).
- `scripts/build.mjs:20` — `npm run build` requires `gcc` on PATH to compile the Job Object addon.
- `sidecar/FORK_PATCHES.md` — this is prose only. With ~1,060 vendored files edited in place and no diff, an upstream rebase is impractical.
- `tests/m4-m5.test.ts:384-388` — the UI "no confirm / playback" checks are source-string greps.

## Recommendation — next base

**Use A as the next base.** It has the smallest, most rebaseable fork: one patch file that builds against the real pin. It reuses T3's own auth, registry, provider-auth and runner seams, has clean typed module boundaries (`src/generation`, `src/main/sidecar`, `src/shared/t3Protocol.ts`), has a real CAS ledger, and has the best end-to-end evidence. It is also the only implementation with verified live generation and tool-denial probes.

Worth porting into A:
- **From D:** the adversarial native-tool conformance test, which runs the real Codex binary against a local fake Responses endpoint, plus the hashed model-catalog/policy pin. It should become A's offline tool-denial suite. Also port D's environment isolation (HOME/USERPROFILE/APPDATA/CODEX_HOME redirected into the game home).
- **From B:** suspended `CreateProcessW` → assign → resume via koffi, replacing A's gate script. Also port B's synthetic OIDC issuer tests for provider connect, re-check and disconnect.
- **From E:** the native C Job Object addon pattern (if a compiled module is acceptable for M10 packaging), its ordered fallback list in settings, and its richer Providers screen layout (disabled-reason display, device-code flow).
- **For A itself:** build the fork as part of `npm run build` (or ship a prebuilt bundle), pick a conformant default model when one is authenticated, and record `succeeded` separately from `dispatched` in the ledger.
