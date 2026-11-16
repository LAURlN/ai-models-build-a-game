# Paired agent test protocol

1. Define a task and acceptance criteria before running either model. Store the
   exact task text and its hash under the experiment's evidence directory. Use one
   experiment ID, one task ID, and distinct variant labels. Variant includes model,
   effort and service tier where relevant; the collector also records actual options.
2. Give each variant the same starting repository commit/state, instructions,
   permitted tools, dependencies, inputs and time budget. Use separate worktrees or
   identical snapshots so one variant cannot see the other's changes. Do not copy
   private game data outside this workspace. Record state identifiers and any
   unavoidable differences. The evaluation tool creates no worktrees itself.
3. Start fresh threads/conversations with identical task text and comparable
   context. Record provider, model, effort, tier, permissions, delegations, external
   tool/network access and cache conditions. Avoid follow-ups; if needed, keep their
   text/rules equal and retain them in both variants' evidence. Alternate/randomize
   run order across pairs to reduce warm-cache, load and time-of-day effects.
4. Collect each thread after completion with the same experiment/task tags. Example:

   ```powershell
   python tools/agent-eval/agent_eval.py collect --thread '<A>' --experiment paired-1 --task task-01 --variant sol-xhigh-fast
   python tools/agent-eval/agent_eval.py collect --thread '<B>' --experiment paired-1 --task task-01 --variant gemini-high
   ```

   Running collections are provisional. Recollect with the same tags to capture
   final status, totals and context. Never discard failed/cancelled runs to improve
   a model's result. Record retries, interventions and excluded pairs with reasons.
5. Read the usage source and completeness flags. Codex `turnTokenUsage` is cumulative
   work; `tokenUsage` and provider-thread `contextUsage` are context meters. Compare
   **context used/capacity** beside cumulative tokens, never substitute one for the
   other or charge for occupied context. Provider meters can differ in accounting.
   Collect before reusing a thread if a historical final context meter is needed.
6. For Antigravity, verify the native UUID mapping to its conversation DB. The
   reverse-engineered generation decoder normalizes uncached f2 + cached f5 as
   input, total output f3, and **likely** thinking f9/visible f10 (f9+f10=f3).
   Keep decoding errors, generation coverage and uncertainty visible. A shared
   conversation cannot be reliably split into app runs by this schema: the default
   thread report counts it once; run reports leave shared run totals unknown.
   The observed aggregate cache-read discrepancy with the dashboard is unresolved;
   do not treat decoded cost as a bill. Missing whole usage messages are unknown,
   not verified zero-token generations. Partial observed cost prices only decoded
   rows and is distinct from a complete estimate.
7. Record real prices in `prices.toml` with a dated source in experiment notes.
   Match provider, model, tier, currency and any cache assumptions. Unknown rates
   remain unknown. Subscription cost, quota depletion and per-token API estimates
   answer different questions. For independent dashboard checks, fill the persistent
   `manual_usage.csv` with total tokens/cost, currency, time window and source. Put a
   multi-run conversation total on one row only. Keep these numbers separate from
   raw state/conversation-derived usage; do not resolve discrepancies by overwriting
   measurements.
8. Score outputs blind where possible: remove model/variant labels, randomize order,
   and use the same acceptance checks and rubric for both. Do not let the tested
   agent score itself. Verify artifacts and cited evidence before scoring. Record
   scorer identity, all five 1–5 dimensions, notes and any test failures:

   | Dimension | What to judge |
   | --- | --- |
   | Correctness | Claims and behavior match requirements and observable reality |
   | Completeness | Required outputs and edge cases are handled |
   | Evidence/rigor | Checks support claims; uncertainty and failures are represented |
   | Instruction following | Scope, constraints and requested workflow were respected |
   | Usefulness | Result is understandable, maintainable and ready for its intended use |

   Common anchors: 1 fails; 2 major defects; 3 usable after material corrections;
   4 minor corrections; 5 meets the task convincingly. Scores attach to a collected
   run, and keep its snapshot ID. If reviewing follow-ups, score those runs explicitly.
9. Generate `report --experiment <id>` (thread units) and optionally `--unit run`.
   Inspect sample size, completion counts, coverage, median/mean wall time, observed
   versus complete totals, quality dimensions, estimated cost and dashboard figures.
   Thread wall time spans first request to last completion, including idle gaps;
   use execution time in raw evidence to diagnose startup/idle differences.
   Repeat multiple paired tasks; one pair supports a case study, not a general model
   ranking. Keep task IDs separate when difficulty differs and compare like options.

Status: the CLI and synthetic/real read-only ingestion are verified as recorded in
`evidence/agent-eval/VERIFICATION.md`. The Antigravity field meanings and cache
accounting remain experimental. Console or gameplay quality is outside this tool.
