# Task: write the merged game specification `docs/SPEC.md`

Inputs (read all): `rounds/R01-design/BRIEF.md` (original brief), the three proposals in `rounds/R01-design/candidates/` (`hydrogen-high.md`, `sol-high.md`, `terra-high.md`), the reviews `rounds/R01-design/JUDGE.md` and `rounds/R01-design/peer/*/REVIEW.md`, and — **highest authority** — the user's verdict `rounds/R01-design/USER_VERDICT.md`.

## What to take from where

- **Vision, pitch, session/campaign flow, combat feel → Hydrogen** ("Chronicle Tactics"): FE-style phases, hit/crit/follow-up, forecast card showing exact triggers, Turnwheel, Field Parley, objectives variety, map sizes, genesis prompt + tone sliders. Keep Sol's good session details where they don't conflict (camp → briefing → battle → aftermath, defeat can mean retreat/capture/lost opportunity — but see "no safety net" below).
- **Mechanics engine → Hydrogen's Rule IR as the base, Terra's ideas second, Sol's resolution semantics only as the precise underpinning.** Fix Hydrogen's flaws the reviewers found: every primitive/selector/condition used in examples must be in the declared vocabulary (define the full vocabulary, e.g. control flow, iteration, spawn, status queries). Import from Terra: generated descriptions must match the compiled rule text. Import from Sol: exact deterministic resolution order, integer math, trigger-chain termination guarantees and transactional rollback. **Remove any cap on how many unique mechanics a chapter/campaign may have** (Sol's "1 signature + ≤2 minor" rule goes) — the game must feel limitless; limits exist only for technical safety (termination, performance budgets).
- **Visuals → Sol** (illustrated atlas board-game look, medallion portraits from shipped primitives, bounded motion library, accessibility), enriched with Hydrogen's forecast card, heraldic tokens and synth SFX where they fit.
- **Memory & player input → Sol and Terra** (history never overwritten, sourced canon, tracked promises; Terra's fact kinds established/rumor/intention; dialogue becomes canon after its consequences validate). Hydrogen's in-character deflection of stat-cheat prompts may stay.
- **T3 integration → follow the AI judges:** use the existing `t3 serve` / WS-RPC / MCP surface as Hydrogen proposed (smallest fork), with Sol's correct facts (provider adapters live in `apps/server/src/provider`, not `packages/provider-*`), Sol's job/attempt ledger, idempotency and failure handling, mandatory Windows Job Object process cleanup (Hydrogen's `awaitLauncherLoss` claim is false on Windows), and Hydrogen's two-slot model picker (player chooses providers/models from what the embedded T3 server discovers). Verify any T3 claim you keep against github.com/pingdotgg/t3code and cite it.

## Explicit user decision — no safety net

**Remove all winnability / fairness / balance-guarantee checks** (no Monte-Carlo solver, no witness replay, no power-budget clamping toward fairness, no win-rate bands). Maps and situations may be unwinnable; a guaranteed game over is acceptable, especially as the consequence of the player's earlier choices. Keep only **technical integrity** validation: schema validity, references resolve, trigger chains terminate, no hangs/crashes, the engine can always reach *some* ending (victory, defeat or other) — a battle can never get stuck with no possible outcome. Describe how consequences of earlier choices can make later chapters harder or hopeless, and how game over / campaign end is presented.

## Form

- Single file `docs/SPEC.md`, ≤ 6,000 words, no padding, no hedging. Same 8 sections as the original brief, plus a short "Decisions log" listing each major decision and its source (H/S/T/user).
- Milestones: 8–10, each one agent session, each with testable acceptance criteria. These milestones will be implemented as competitive rounds, so make each self-contained with a clear definition of done. M1 should be buildable from an empty repo.
- No application code beyond short schema/interface snippets.

Only create `docs/SPEC.md`. Do not commit. Reply with ≤10 lines: the main decisions and anything from the inputs you had to reject and why.
