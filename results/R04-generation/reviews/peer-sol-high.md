# R04 engineering review

Static source review only: nothing installed or executed. Visual quality and fun are excluded. All five preserve immediate attacks, deterministic enemy resolution, offline battles and Electron isolation. Repository-wide edit history, successful script execution and historical live-call counts cannot be independently established from these source snapshots.

| Implementation | correctness | completeness | evidence_rigor | instruction_following | usefulness |
|---|---:|---:|---:|---:|---:|
| A | 3 | 4 | 3 | 3 | 4 |
| B | 4 | 4 | 5 | 4 | 5 |
| C | 3 | 1 | 2 | 3 | 2 |
| D | 4 | 5 | 5 | 4 | 4 |
| E | 2 | 3 | 3 | 2 | 2 |

**A.** The clearest content/renderer separation, flexible constructors, compiler errors and durable attempt-level staging. The pinned upstream patch is real and documented, with provider auth and structured Codex execution. All four UX items and e2e (a)–(g) are represented. However, routine build leaves the fork unbuilt; offline integration tests substitute a separate fake server rather than exercising the patched production adapter. The reported paid denial probes are not repeatable offline conformance evidence.

**B.** A strong, mostly typed foundation: genuine vendored T3 authentication, discovery and WS machinery, a text-only Responses adapter with no tool executor, bounded compilation, persistence and all required UX/e2e flows. Particularly good offline OAuth/JWT, SSE, cancellation, tool-call rejection and real descendant cleanup tests. The fork replaces more orchestration/authenticated-server composition than D, and publication bookkeeping spans two databases. A usable opt-in live smoke exists.

**C.** An honest partial delivery. Local staging, immediate attacks, observable deterministic playback, danger zones and impossible-seize expiry have meaningful coverage. The native launcher tests exercise real process trees, but the launcher is a prototype outside the application path. There is no T3 fork, provider screen/auth, live generation or smoke command; e2e lacks (b), generated (c), generation-failure (d) and (g). The injectable gateway tests do not establish T3 integration.

**D.** Most complete integration: pinned source composition, actual upstream serve/provider/orchestration seams, isolated suspended Job Object launch, all provider controls, generation/repair/publication, UX items, e2e (a)–(g) and live smoke. Its standout evidence sends adversarial tool calls through the real bundled Codex dispatcher against an offline endpoint and checks descendants. The bespoke TypeScript source slicer and largely untyped sidecar increase maintenance risk; the ordinary fake-provider path bypasses that dispatcher, but the separate conformance test compensates.

**E.** Real upstream server/auth/RPC integration and substantial fake-provider staging/e2e coverage, rather than merely a mock application. Nevertheless, native-tool conformance is asserted without adequate enforcement, and broad upstream services/stubs remain in production. Generation and synchronous compilation run in main alongside a second SQLite writer. The e2e fallback case covers missing auth, not invalid generation; the determinism unit test compares identical runs rather than different playback speeds. The smoke script also misses the actual saved-settings database.

## Concrete defects

**A**

- [generation.ts:82](A/game/src/main/generation.ts:82): cancel during awaited validation still reaches publication; cancellation only aborts the request signal and never marks the job canceled on this path.
- [chapter.ts:135](A/game/src/generation/chapter.ts:135): `rulesJson="[]"` bypasses reference/active checks, admitting missing ability IDs and a chapter without its promised ability pack.
- [ir.ts:153](A/game/src/rules/ir.ts:153): hard 64-definition quota violates the explicit no-mechanic-count-cap constraint; bytes/work already have separate limits.
- [build.mjs:17](A/game/scripts/build.mjs:17): standard build never builds the fork; [supervisor.ts:84](A/game/src/main/sidecar/supervisor.ts:84) consequently disables generation on a clean acceptance sequence.

**B**

- [generationService.ts:152](B/game/src/main/generationService.ts:152): pack reservation, battle publication and job completion are separate commits across databases. A crash after battle publication leaves its coordinator job “uncertain” on recovery despite already published play.
- [battleHost.ts:79](B/game/src/main/battleHost.ts:79): “Play Again” after a generated chapter silently starts the authored battle, losing the generated chapter context.

**C**

- [battleHost.ts:91](C/game/src/main/battleHost.ts:91): always supplies a null gateway; every new campaign necessarily falls back.
- [chapterStaging.ts:13](C/game/src/main/chapterStaging.ts:13): only the shipped ability/map are accepted; this generates labels, not the requested class/item/rule pack. [chapterStaging.ts:57](C/game/src/main/chapterStaging.ts:57) discards the generated item identity.
- [package.json:7](C/game/package.json:7): no `smoke:live`; [index.ts:117](C/game/src/main/index.ts:117) starts neither a sidecar nor provider management.

**D**

- [orchestration.mjs:24](D/game/sidecar/src/orchestration.mjs:24): compares output bytes against the 6,000-token cap, prematurely rejecting valid structured chapters well below 6,000 tokens. Input has the same unit error at line 15.
- [App.tsx:100](D/game/src/renderer/App.tsx:100): ability availability uses `phaseUses[id]` rather than the compiled `useKey`/`usesPerPhase`, blocking valid repeated uses or presenting exhausted abilities as usable.
- [battleHost.ts:86](D/game/src/main/battleHost.ts:86): generated-chapter “Play Again” returns to authored content.

**E**

- [CodexTextGeneration.ts:321](E/game/sidecar/apps/server/src/textGeneration/CodexTextGeneration.ts:321): read-only sandbox plus MCP/plugin suppression leaves native shell/read/web capabilities; there is no game-specific denial equivalent to A/D or B's executor-free adapter.
- [server.ts:840](E/game/sidecar/apps/server/src/server.ts:840): unrestricted MCP and remote-delegation services remain mounted; the WS allowlist does not restrict them.
- [campaign.ts:492](E/game/src/rules/campaign.ts:492): arbitrary stat power bands reject technically valid content; [campaign.ts:555](E/game/src/rules/campaign.ts:555) additionally caps mechanics at six.
- [index.ts:261](E/game/src/main/index.ts:261): renderer-supplied battle states can launch without checking a published artifact; validation checks only version and nonempty arrays, bypassing staging.
- [generationCoordinator.ts:270](E/game/src/main/generationCoordinator.ts:270): plan/build/repair/failovers reuse one attempt ID, with individual timeouts rather than a shared hard deadline; the ledger cannot distinguish those billed requests.
- [smoke-live.mjs:78](E/game/scripts/smoke-live.mjs:78): reads `saves.sqlite` instead of `battle.sqlite`, and launches a fresh unauthenticated home rather than the supplied authenticated profile.

## Recommendation

Ranking: **D > B > A > E > C**. Use D after fixing its defects. Port B's typed adapter boundaries and offline authentication coverage, A's richer admission/constructors, generated-chapter restart and presentation separation, and E's explicit ordered fallback configuration after fixing attempt identity/budgets. C's standalone launcher tests are useful references; its runtime adds little beyond D.

## Authorship guess

Low-confidence style guesses only: A—Claude Opus 5.5 (40%); B—GPT-6.1 Sol, high (25%); C—GPT-6.1 Terra (30%); D—GPT-6.1 Sol, xhigh (30%); E—Gemini 4 Hydrogen (35%). I do not recognize any implementation as my own work.
