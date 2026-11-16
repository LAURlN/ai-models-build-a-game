# R04 engineering review

Static review only: no installs, builds, tests or live calls were run. Scores reflect source evidence, not independent execution. Paths below are relative to each letter's `game/`.

| Implementation | Correctness | Completeness | Evidence rigor | Instruction following | Usefulness |
|---|---:|---:|---:|---:|---:|
| A | 4 | 4 | 5 | 4 | 5 |
| B | 4 | 4 | 5 | 4 | 4 |
| C | 2 | 1 | 2 | 3 | 2 |
| D | 4 | 4 | 5 | 4 | 4 |
| E | 2 | 3 | 3 | 2 | 3 |

**A.** Strong separation of coordinator, validator, worker, and sidecar; meaningful fake-provider and process-tree tests, and documented live conformance evidence. Its small upstream patch and general chapter validation are good foundations. The fork needs a separate network build, however, and first-time generation needs explicit model selection.

**B.** Broad offline tests and a careful staging and Windows lifecycle implementation. Its text-only Responses driver makes tool denial straightforward, but this is a substantial custom generation and transport slice rather than the requested reuse of the full upstream `serve` composition. Real account/model compatibility is not demonstrated by its synthetic tests.

**C.** Honest, limited increment: local campaigns, immediate attacks, and enemy playback exist; the isolated staging prototype and Windows launcher are useful starting points. It does not deliver the central M4 integration or a general generated chapter, and its e2e coverage reflects that omission.

**D.** A comprehensive end-to-end integration with upstream-derived server composition, bundled Codex, explicit native-tool policy and unusually strong offline adversarial tests. The generation and UX paths are well wired. Its fork duplicates a sizable source slice and policy machinery, raising maintenance costs; fresh installations still require a model choice.

**E.** A substantial upstream source fork with real RPC wiring, generation staging and useful UI coverage. The real generation adapter's security and isolation assumptions are not established by its fake provider tests; these are material blockers for use as the base. Its large vendored tree and stubs also increase maintenance burden.

## Concrete defects and gaps

- **A:** Normal `build` does not build or fetch the fork (`scripts/build.mjs:11`); a clean checkout starts without generation until a separate network-dependent command is run (`src/main/sidecar/supervisor.ts:83`). Both model slots start empty (`src/main/settings.ts:5`), so connecting a provider alone still yields local fallback until a model is selected (`src/main/generation.ts:73`).
- **B:** The dedicated `game-generation` entry exports a new game server (`sidecar/vendor/apps/server/src/cli/game-generation.ts:2`), and its custom Responses driver calls the API directly (`sidecar/runtime/responses.ts:37`), leaving the requested upstream serve/adapter reuse and actual managed-account compatibility unproven. No real-provider run is documented (`README.md:71`).
- **C:** The application invokes local-only generation (`src/main/localChapter.ts:5`); the staging gateway is injectable but not connected (`src/main/chapterStaging.ts:16`), and only the shipped ability and map are admitted (`src/main/chapterStaging.ts:45`). The Job Object prototype is not wired to the application (`README.md:34`); provider screens, smoke script, and generation e2e are absent (`package.json:1`, `e2e/battle.e2e.ts:30`).
- **D:** Fresh settings select neither model (`src/main/generation.ts:12`), requiring manual setup before generated play. The fork retains both upstream and patched source slices (`sidecar/FORK.md:1`), increasing the surface that must be checked during upstream updates.
- **E:** The real Codex runner sets read-only sandboxing but does not disable shell or web tools (`sidecar/apps/server/src/textGeneration/CodexTextGeneration.ts:310`); read-only is not native-tool denial. The sidecar inherits ambient environment and sets `T3CODE_HOME` but not `CODEX_HOME` (`src/main/t3Sidecar.ts:287`); the runner only overrides `CODEX_HOME` when configured (`sidecar/apps/server/src/textGeneration/CodexTextGeneration.ts:288`), risking use of personal Codex state. Invalid plan output falls straight to fallback without the permitted repair (`src/main/generationCoordinator.ts:318`). The e2e tests cover no-provider fallback but not generation-failure fallback (`e2e/battle.e2e.ts:271`). The build requires an external `gcc` on Windows (`scripts/build.mjs:18`).

## Recommendation

Use **A** as the next base, after making fork preparation part of the normal build and fixing initial model selection. Port D's bundled runtime and adversarial tool-policy test, and B's synthetic auth and usage-limit coverage. Take C's explicit local-only documentation and E's ordered fallback controls where they fit the validated job policy. Recheck real-provider isolation and cleanup before relying on any integration.

## Authorship guesses

Low-confidence stylistic guesses only; code does not establish authorship. A: GPT-6.1 Sol xhigh (25%); B: GPT-6.1 Sol high (20%); C: Gemini 4 Hydrogen (25%); D: GPT-6.1 Terra (25%); E: Claude Opus 5.5 (20%). D might be my own work, but I have no evidence of that.

