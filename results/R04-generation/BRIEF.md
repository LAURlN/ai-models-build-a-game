# Round R04 — Headless T3 fork, provider management, first generated chapter, UX pass (M4 + M5 + player feedback)

You are one of several independent implementers. Work alone; do not look for other implementations.

`game/` contains the accepted build so far: an Electron/React/PixiJS tactics game with a deterministic FE combat kernel, a Rule IR slice ("Borrowed Second"), SQLite saves and a Turnwheel. Read `docs/SPEC.md` first. It is authoritative, especially §1, §3, §4 (generation pipeline, headless T3 Code fork, provider and model selection, latency, failure behaviour), §5, §6, §7 and the M4 and M5 rows of §8. Then read `game/README.md` and the code. This round is large. Plan your work, keep the build green as you go, and finish all of it.

## 1. M4: the game's own headless T3 Code fork (SPEC §4)
- Integrate a fork of T3 Code (github.com/pingdotgg/t3code). Pin a specific commit and record it. Reuse its existing headless server / WS-RPC surface as the spec describes. Keep the fork surface as small as possible and document every change you make to upstream.
- The game starts and stops its own T3 instance as a managed sidecar with an **isolated base directory inside the game's own app-data folder**. It must never read, modify or reuse the user's normal T3 Code installation or its data (`%USERPROFILE%\.t3`). On Windows, a force-killed game must leave no sidecar or provider child processes behind, for example via a Job Object, as the spec requires.
- Generation requests return **structured JSON** that the game validates. Native agent tools such as shell, file edits and web access are denied for generation. Cancellation works. When no provider is available or authenticated, the game stays fully playable with a local fallback.

## 2. Model selection and provider connection management (player-facing)
- A **Providers & Models** screen. It lists the providers the embedded T3 instance knows about, each provider's connection/auth status and the available models. The player assigns models to the generation roles the spec defines (e.g. the two-slot picker), with options such as effort where the provider supports them. Choices persist.
- **Manage connections:** connect, re-check and disconnect a provider using T3's own provider auth and configuration mechanisms (for example, start the provider's own login flow). The game never reads, copies or displays credential files or tokens.

## 3. M5: one generated chapter through staging (SPEC §4, M5 row)
- **New campaign** screen: the player writes a free-text setting premise. The game generates company identities, one supported class/item/rule pack and a constructor-based encounter, then lets the player play that chapter.
- Generated content is published only after the technical checks pass. One failed repair yields a clearly labelled local result. Duplicate or stale attempts cannot republish.
- An impossible-seize fixture must pass validation and reach expiry defeat. Per the spec there are no fairness or winnability checks, only technical integrity.
- Show generation progress and keep the UI responsive. Generated text and abilities must be readable in the game. Generated abilities may only use the Rule IR vocabulary that is implemented; unsupported operations are rejected explicitly.

## 4. Player feedback from the last playtest (must address)
- **No attack confirmation step.** Attacking (select → target, and bump-attack) resolves immediately. The Turnwheel is the safety net for misclicks. The forecast stays visible on hover/selection before acting.
- **The enemy phase is not instant.** The player must be able to follow it visually: units move and attack one after another with readable animation and a short pause, with a speed setting and a skip option. Resolution stays deterministic; animation is presentation only.
- **Information design.** Think about what the player needs, what is irrelevant and what is redundant. The map must dominate the screen. Side panels are compact and secondary. Attack/move ranges and threat zones are clearly visible (for example on selection or hover, plus a toggle for enemy danger zones). Stats are shown where they are needed and not duplicated.
- **Mechanics give visible feedback.** When an ability such as Borrowed Second does something, the player sees what happened and why (e.g. a status icon, a floating label, a log line in plain language).

## Testing rules
- Unit tests and e2e must **not** call real providers. Use a fake or mock provider through the same T3 interface, so tests are deterministic, offline and free.
- Add an opt-in `npm run smoke:live` that performs one small real generation through the embedded T3 fork with a provider/model chosen by the player's saved settings or an argument. During development you may run real generations **at most 3 times in total**, and only via Codex `gpt-6.1-terra` with low effort. Never use Gemini/Antigravity or Claude for live tests.

## Acceptance contract (run from `game/`)
| Script | Must do |
|---|---|
| `npm ci`, `npm run typecheck`, `npm run build` | exit 0 |
| `npm test` | Unit tests covering: sidecar lifecycle and cleanup, structured-output validation and repair/fallback, staging (publish only after checks, no stale/duplicate republish), the impossible-seize fixture, provider-settings persistence, the absence of an attack confirm, deterministic enemy-phase resolution independent of animation speed, and all earlier tests still passing. Exit 0. |
| `npm start` | launches the built app |
| `npm run e2e` | Drives the real Electron app with the fake provider and checks each item below. Exit 0. |

Items `npm run e2e` must check:
- (a) The board renders and clicks hit the right cells.
- (b) The Providers & Models screen lists providers, lets the player pick models and persists the choice across a restart.
- (c) New campaign: enter a premise, generate, and the generated chapter becomes playable with its generated names visible.
- (d) Generation failure and no-provider cases fall back to a labelled local result while the game stays playable.
- (e) An attack resolves with no confirmation, and the Turnwheel can undo it.
- (f) The enemy phase plays out step by step, observable in the UI, and can be skipped.
- (g) A force-quit of the app leaves no sidecar processes.

Update `game/README.md` (run/test, the fork pin and its patch list, the architecture overview ≤1 page, the live smoke test).

## Rules
- Only create or modify files inside `game/` (the fork may live inside `game/`, e.g. `game/sidecar/`). Do not touch `docs/`, `rounds/`, `tools/`, `evidence/`, `video/` or `playtest/`.
- Never read anything under `%USERPROFILE%\.t3\` (the user's T3 installation and data), any `acp_token.json`, `.env` files, or credential/token files of any provider.
- **Do not leave game windows or processes running.** Close or kill exactly the processes you start as soon as each check is done; nothing of yours may remain at the end.
- Before finishing, run every script above from a clean `npm ci` and fix any failures. **Commit** your finished work on your current branch.
- When done, reply with ≤12 lines: what you built, the result of each script, the T3 commit you pinned, the number of live generations you used, and any known limitations or spec deviations.
