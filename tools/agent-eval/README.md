---
purpose: Collect local T3 agent cost, speed and quality evidence for paired model comparisons
usage: python tools/agent-eval/agent_eval.py <collect|score|report> <args>
status: experimental
lang: python
updated: 2026-11-14
source: user-request-agent-eval
---

# Agent evaluation

Python 3.12+, standard library only. Run from the workspace root; output paths are
resolved relative to this tool's location, so another working directory also works.
No setup, network, provider invocation, git operation or emulator is involved.
The T3 schema and Antigravity protobuf decoding are private formats and may change.

## Usage

```powershell
python tools/agent-eval/agent_eval.py collect --thread '<thread-id>' --experiment experiment-1 --task task-1 --variant sol-xhigh-fast
python tools/agent-eval/agent_eval.py collect --thread '<other-thread-id>' --experiment experiment-1 --task task-1 --variant gemini-high
python tools/agent-eval/agent_eval.py report --experiment experiment-1
python tools/agent-eval/agent_eval.py report --experiment experiment-1 --unit run
```

Selectors are repeatable and combined as a union. `--parent '<thread-id>'` collects
all direct child threads through the indexed subagent table; add `--recursive` for
descendants. `--title-contains 'literal text'` matches a case-insensitive substring
(ASCII case folding as provided by SQLite). `%` and `_` have no wildcard meaning.
Title discovery scans only thread id/title metadata, because arbitrary substrings
cannot use a title index. Every subsequent projection query is scoped to a selected
thread or an indexed node key; large item/message payloads are never loaded.

Data directory precedence: `collect --data-dir <userdata-directory>`, then
`T3_DATA_DIR`, then `%USERPROFILE%/.t3/userdata` (home on other systems).
The directory contains `statev2.sqlite`, not the database filename itself.
No username or workspace drive is embedded in the implementation.

The collector opens `statev2.sqlite` and mapped Antigravity conversation databases
using `sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5.0)`, sets
`query_only`, and closes each read transaction. It does not use `immutable=1`,
which would miss live WAL data. It never copies a database or opens credentials,
`acp_token.json`, `.env`, `secrets/`, trace logs or arbitrary provider config files.
Missing files are errors, never newly created databases.

## Evidence and record semantics

All outputs are under `evidence/agent-eval/`:

| File | Meaning |
| --- | --- |
| `runs.jsonl` | One append-only snapshot per changed thread/run, including tags, run model/options, usage source, context, timestamps, status and item counts |
| `scores.jsonl` | Rubric reviews, created only by `score` |
| `manual_usage.csv` | Persistent user-editable dashboard numbers; new runs get blank rows, recollection preserves edits |
| `quota_snapshots.jsonl` | Append-only dated quota observations, manual attestations and classified error/reset events; never raw error text |
| `calibration_ledger.json` | Rebuilt provider/model/account/window token totals, capacity lower bounds, calibrated capacities and observed events |
| `reports/report-<UTC timestamp>.md` and `.csv` | Reproducible summaries of local evidence with current prices |

Collection prints exact `run_id` and `snapshot_id`. Unchanged snapshots are skipped;
collection time and running elapsed time alone do not create duplicates. Reports
use the last appended snapshot per thread/run. Recollect after completion, using
the same tagged command. Omitted tags preserve prior values for an existing run;
explicit nonempty tags replace them. Tags for newly discovered follow-up runs must
still be supplied. Use one writer at a time; JSONL and CSV append operations do not
provide cross-process locking. Interrupted/corrupt JSONL raises an error instead
of silently dropping evidence. No raw prompts, reasoning text, tool outputs or
source files are exported.

`wall_seconds` is requested-to-completed time, including queue/provider startup;
`execution_seconds` starts at the run's actual start. Active runs have null final
duration and a separate elapsed snapshot. Counts include all projected item types
(`command_execution`, `dynamic_tool`, `file_change`, etc.), including user messages
and checkpoints. Unknown/missing usage is null, never zero. Partial sums retain
coverage counts and flags. Turns join runs through attempts/root nodes, then an
indexed node lookup; unmapped turns are flagged, never guessed into a run.

The default report unit is **thread**: a paired task is usually one thread and
Antigravity can reuse one conversation across multiple runs. Thread reports count
each mapped conversation once, span first request to last completion (including
idle gaps between follow-ups), and average any scored runs within each thread.
`--unit run` keeps runs separate; shared conversation totals stay in each run's
`antigravity_conversations` metadata but are not assigned repeatedly to run token
totals. A thread with conflicting experiment/task/variant tags requires recollection
with consistent tags or a run report. Threads that change model/options are marked
`mixed_run_configuration` and do not receive a cost estimate.

Reports group by experiment, task, provider, model, variant and options. Final runs
(including failures) feed duration/token/cost/quality statistics; counts retain
active runs. Context statistics include active snapshots. Observed token means
retain partial reported counts; complete-only means/totals and denominators for
each field are also in CSV. Failed/cancelled runs remain visible through final and
completed counts and flags. Keep failures in the experiment rather than selecting
only successful attempts. CSV contains all five quality dimension averages.

`collect --role overhead` tags orchestrator/judge runs independently of `--variant`.
The default is contestant; omitted roles preserve an existing tag. Both report
formats separate roles, with separate totals. An optional repeatable `collect
--run <exact-id>` restricts selected threads to specific runs, useful for attributing
only an orchestrator's experiment-related turns. Never tag an entire multipurpose
parent thread as experiment overhead without checking its scope. Reports preserve
the old `cost_*` CSV names as API-cost aliases; `api_cost_*` and
`subscription_cost_*` are explicitly separate. Totals require full coverage;
unknown rows do not become zero. Wall-time totals sum evaluation-unit durations,
so parallel durations are work-time sums, not experiment elapsed time.

## Cumulative usage and context are different measurements

For Codex, cost uses `provider_turns.payload_json.turnTokenUsage`, summed once per
provider turn across attempts. `inputTokens` includes `cachedInputTokens`;
uncached input is their difference. `reasoningTokens` is treated as a subset of
output and is **not** added to output for billing. The much smaller per-turn
`tokenUsage` is a context-window snapshot, not cumulative usage.

For **every provider**, the collector records provider-thread `contextUsage`
(`usedTokens`, `maxTokens`) when present. It also records each turn's
`tokenUsage.usedTokens/maxTokens` and uses the last turn snapshot when provider
context is absent, as observed for Codex. The report puts context used/capacity
beside cumulative tokens and labels the source. This compares occupied context
as reported by each provider, not total work or money. Provider-thread context is
mutable: a later run's meter is never represented as an earlier run's final meter.
Raw current provider context and its update timestamp are retained even when the
historical per-run value cannot be recovered. Collect before reusing a thread when
you need its final per-run context.

## Antigravity conversation usage (experimental)

Verified by local read-only inspection on 2026-11-14: the state projection reports
`turnTokenUsage.usageStatus='unavailable'` without counts and `tokenUsage=null` for
the comparison thread. This is **unavailable from T3's state projection**, not proof
that the provider has no usage data. Conversation files supply a separate source:

```text
<userdata>/providers/antigravity/<account-hash>/antigravity-acp/conversations/<uuid>.db
```

Mapping first uses UUIDs in whitelisted native thread/turn/session metadata.
Verified mapping: `provider_threads.payload_json.nativeThreadRef.nativeId` and
`provider_turns.payload_json.nativeTurnRef.nativeId` identify
`00000000-0000-4000-8000-000000000001` for the supplied Gemini thread.
If native metadata supplies no existing file, the fallback checks only UUID-named
`.meta` JSON files for matching session cwd and database birth time inside the
run window with 120 seconds tolerance. It accepts exactly one candidate; ambiguous
matches are flagged and rejected. A heuristic mapping remains explicitly flagged
and cannot produce a cost estimate until native linkage becomes available. Birth
time fallback is supported on Windows; mtime is not a generation start timestamp.

Only `gen_metadata(idx, data, size)` is read in the mapped conversation. `data` is
protobuf, decoded without third-party dependencies. The observed mapping is:

| Field path | Interpretation |
| --- | --- |
| top-level bytes f1 → bytes f4 → varint f2 | Uncached input |
| same usage message → varint f5 | Cache-read input |
| same usage message → varint f3 | Total output |
| same usage message → varint f9 | **Likely** thinking/reasoning output; interpretation unverified |
| same usage message → varint f10 | **Likely** visible output; interpretation unverified |

Normalized total input is f2 + f5. The coordinator's verified example has f2=6559,
f5=228164, f3=5750, f9=3625, f10=2125; f9+f10 equals f3. The fixture reproduces that
example. Local smoke data also satisfies the output split for decoded generations.
Omitted scalar counters default to zero within a present usage message, but an
entirely empty usage message is treated as **unknown**, not a verified free call.
Malformed or missing messages are counted and recorded by generation index.
Each record retains generation count, decoded count, normalized totals, visible
output (likely), output-split mismatches, model strings found and decoding errors.
Model strings are diagnostic only; selected/observed T3 model metadata determines
the reported model, since the blob can contain base names and variant names.

Coordinator-provided cross-check (not independently reproduced across all other
conversations here): output across conversations excluding one dated October 18
was about 342K, matching T3's dashboard; input about 3.38M vs dashboard 3.23M while
active; cache-read sum about 52.5M vs dashboard 28.6M. **The cache discrepancy is
unresolved** (possibly scope/time window or different cache accounting). Do not
claim invoice accuracy or compare those aggregate numbers with one task's totals.
Trace logs are not consulted. The decoder is reverse engineered, not an official
provider schema. Keep this uncertainty attached to Gemini estimates.

## Prices and manual dashboard figures

Edit `tools/agent-eval/prices.toml` with verified per-million input, cached input
and output rates. Empty strings are unknown, not free; numeric zero means free.
All three rates must be known. Optional service-tier tables override the model
defaults in full; unpublished tiers return n/a. Ensure the
chosen prices match the actual provider/tier (the same model name can be sold at
different prices). `--prices <file>` selects another TOML; no price lookup occurs.

```text
estimate = (uncached input * input rate + cache reads * cached input rate + output * output rate) / 1,000,000
```

No additional reasoning charge is added. T3 usage with unknown/nonzero cache
creation has no estimate because this three-rate scheme cannot price it safely.
Antigravity estimates price only decoded f2/f5/f3; cache creation is unreported and
no additional charge is assumed. `cost_mean` requires complete usage;
`observed_cost_mean` can price only decoded generations as a **partial estimate**
when one generation is unknown. Unknown prices still produce n/a. These are
monetary estimates, not subscription invoices or quota depletion measurements.

### Verified public API rates

All sources accessed **2026-11-14**; USD per million tokens, standard global API.
The consumer-provider runs are priced as an API **equivalent**, not an invoice.

| Model | Uncached input | Cache read | Output incl. reasoning | Cache write |
| --- | ---: | ---: | ---: | --- |
| GPT-6.1 Sol | 2.00 | 0.10 | 10.00 | 2.50/5.00 (30m/12h) |
| GPT-6.1 Terra | 1.00 | 0.05 | 5.00 | 1.25/2.50 (30m/12h) |
| Hydrogen low/medium/high/xhigh | 1.50 | 0.075 | 7.50 | Explicit writes unsupported (implicit cache only) |
| Claude Opus 5.5 | 4.00 | 0.20 | 20.00 | 5.00/8.00 (5m/1h) |
| Claude Sonnet 5.5 | 2.00 | 0.10 | 10.00 | 2.50/4.00 (5m/1h) |

OpenAI [API rate card](https://developers.openai.com/api/docs/pricing),
[Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra): prompts above
272K input pay 2x input/cache and 1.5x output for the full request.
[Priority/Fast](https://openai.com/api-fast-mode/) doubles standard rates; both
service-tier names are accepted. Source comments in TOML apply to every listed
number. Historical event context-input samples provide a maximum observed prompt
size; they are distinct from cumulative input. Missing samples can hide peaks.
An aggregate containing observed long requests has n/a API cost because the
short/long token split is unavailable. Without history, cumulative input below the
threshold is safe; larger aggregates need request-context evidence.

Google's [rate card](https://aistudio.google.com/docs/pricing#gemini-4-hydrogen) and
[Hydrogen announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/)
give flat 1M-context pricing, shared across thinking levels. The rates agree with
the user's Hydrogen dashboard cross-check. Anthropic's
[rate card](https://platform.claude.com/docs/en/about-claude/pricing) has no
long-context premium for these two models. Reasoning is billed within output:
[OpenAI](https://developers.openai.com/api/docs/guides/reasoning),
[Claude](https://platform.claude.com/docs/en/build-with-claude/extended-thinking).
Cache-write prices are recorded, but aggregate creation counts without a proven
TTL breakdown still produce n/a (including the R01 judge). A last-request TTL
snapshot does not prove the TTL of all earlier cache writes.

## Subscription estimates and empirical quota calibration

Sources below accessed **2026-11-14**. These US monthly list prices exclude tax,
annual discounts, promotions and purchased overage/reset credits.

| Provider | Current plan | Monthly USD | Relevant limits |
| --- | --- | ---: | --- |
| Codex | ChatGPT Pro 100 / Pro 200 / Pro 500 | 100 / 200 / 500 | Weekly Work/Codex pool; current Pro has no 5h cap. Model/settings affect depletion; Chat Pro model quotas are separate. |
| Antigravity | Google AI Pro | 19.99 | 5h quota until weekly limit; no public token capacity. Model/workload and shared plan usage matter. |
| claudeAgent | Claude Pro | 20 | 5h sessions plus all-model weekly limit; possible discretionary model/feature caps. |

Sources: [OpenAI Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers),
[Work/Codex limits](https://learn.chatgpt.com/docs/pricing),
[Google plan price](https://one.google.com/about/google-ai-plans/),
[Antigravity plan limits](https://antigravity.google/docs/plans/),
[Claude Pro price and limits](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan).
The general 5h Codex limit does **not** describe current Pro. Set the actual
`subscriptions.codex.monthly_usd` and plan label in TOML before pricing: the user's
unspecified "ChatGPT Pro" does not identify one of today's three tiers. Set a
subscription entry for another provider ID if a different adapter is used.

The fully-utilised allocation convention is:

```text
windows_per_month = (30.4375 * 24 * 60) / window_minutes
window_cost = fraction_consumed * monthly_plan_price / windows_per_month
run_subscription_cost = max(window_cost for each applicable binding constraint)
```

We take the maximum across constraints, never add the same run's 5h and weekly
allocation. All applicable windows must be measured/calibrated; otherwise n/a is
labelled `uncalibrated` with a reason. If the account has additional model-specific
limits, configure them only when supported and observable; unsupported window
names remain uncalibrated. This allocation assumes sustained full utilisation,
assigns the entire bundle price to agent use, and is not marginal spend or savings.
Idle windows, other subscription benefits, changing limits, integer-rounded
percentages, partial resets and bought usage weaken that assumption.

### What is observable locally

The read-only R01 audit found no quota-named tables, no usable quota snapshots in
the selected provider projections or indexed metadata events, and no mapped
Antigravity `steps.error_details` rows. The adapter directories contain conversation
DBs and metadata, but no dedicated quota snapshot file was found. No credentials,
`acp_token.json`, settings/config contents, `.env`, secrets or trace logs were read.
This is a scoped observation, not a claim that no provider ever exposes quota.
The durable audit is `evidence/agent-eval/PRICING-RESEARCH.md`.

`collect` and automatic `quota` inspect whitelisted `rateLimits`, `rate_limits`,
`quota`, `quotaInfo`, `usageLimits` (and native-metadata counterparts). They read
only selected threads, with at most 2,000 metadata/error events per store and a
truncation flag. Both old `orchestration_events` and `orchestration_v2_events` are
supported. Current mutable projections use observation time, not an old update
timestamp. Error fields are classified for `usage_limit`, `quota`,
`resource_exhausted`/`resource exhausted` and `rate_limit`; raw error text is never
exported. Such events are **limit candidates**, not automatically proven plan
exhaustion (RPM or service errors can look similar). Explicit quota reset events
are retained. Only already-mapped UUID Antigravity DBs are checked for up to 100
bounded error-detail blobs; step prompts and tool payloads are excluded. Missing
signals create an explicit `unavailable` observation when `quota` is invoked.

### Before and after every calibration run

1. Choose a non-secret `--quota-account` label and keep it consistent in `quota`
   and `collect`. Check all relevant meters and their reset timestamps. Observe
   a fresh reset to establish `--window-start`; do not subtract 5h from a displayed
   reset for a rolling window or assign historical R01 runs to invented windows.
2. Immediately before the run, try automatic capture on its existing thread:

   ```powershell
   python tools/agent-eval/agent_eval.py quota --provider antigravity --model gemini-4-hydrogen-high --thread '<id>' --phase before --exclusive
   ```

   If no signal is exposed, enter the UI reading manually (the example uses
   PowerShell variables containing **actual** readings, not supplied measurements):

   ```powershell
   python tools/agent-eval/agent_eval.py quota --manual --provider antigravity --model gemini-4-hydrogen-high --thread $tid --window 5h --used-percent $used --reset-at $reset --window-start $start --phase before --exclusive --note 'Antigravity UI'
   ```

   Repeat for `--window weekly` with that meter's own readings and boundaries.
   For Codex Pro, only weekly is configured. `--remaining-percent` is also accepted.
   Use `--at` only to record a real previously observed timestamp, never fabricate
   a before reading for an already finished run. Manual recording works offline
   without a T3 DB. A simple manual command without boundaries is retained but
   cannot yet yield a depletion/capacity estimate.
3. Run the task. Avoid concurrent account use in other threads/apps during a delta
   measurement. `--exclusive` attests that no uncollected/account-external usage or
   paid overage occurred; it does not change the account. Collect **all** work from
   a calibration window, including failures and overhead, with consistent model,
   options and account. Immediately capture `--phase after` for each meter (same
   syntax, new percentage). Before/after readings must bracket the run within
   5 minutes at each end, share a reset, and have nondecreasing usage. Known
   concurrent runs on the same provider/account invalidate individual attribution.
4. `collect --thread $tid ...` retains available snapshots and deltas. `report`
   recomputes with the latest evidence, so manual readings entered later work too.
   Quota calculations always use **all** collected account runs, regardless of
   report experiment/variant filters. Runs that cross a boundary remain unassigned;
   shared Antigravity conversation totals count once and cannot be split at resets.
5. At a real quota stop, first collect final runs. Record the hit and the verified
   window boundaries. Only attest `--complete-window --exclusive` when **all**
   usage since a fresh reset was collected, with one model/options configuration
   and no paid overage, unseen calls, other-model usage or boundary-straddling runs:

   ```powershell
   python tools/agent-eval/agent_eval.py quota --manual --provider antigravity --model gemini-4-hydrogen-high --window 5h --event limit_hit --used-percent 100 --window-start $start --reset-at $reset --complete-window --exclusive --note 'Confirmed plan stop; complete window collected'
   ```

   Record actual resets using `--event reset`, then repeat for subsequent windows.
   A generic rate-limit error must be verified before entering `limit_hit`.

The ledger's empirical token measure is **input + output**: input already includes
cache reads; output already includes reasoning. Before a hit, tokens successfully
observed in a known window are a capacity lower bound. For a matched workload this
gives a conditional upper bound on that window's subsidised cost. A complete-window
hit yields `capacity_tokens`; then `cost_per_token = price / (windows_per_month *
capacity_tokens)`. Recollection deduplicates run snapshots; Antigravity shared
conversations count once. Unassigned historical totals are displayed as observed
tokens, **not** claimed as a per-window lower bound. Overall cost upper bounds
require bounds/estimates for every applicable constraint. Ledger entries retain
all observed hit/reset candidates and snapshot references.

Token capacity is workload-specific: input, cache and output likely consume quota
at different weights. Do not treat raw tokens as a provider-wide fixed allowance.
Calibration is matched to provider/model/options/account and the latest complete
matching window is used; repeat with representative workloads and recalibrate
after plan/provider changes. Set a subscription's optional `calibration_since`
ISO timestamp to exclude capacity evidence predating a plan/limit change while
preserving the ledger history. Empirical estimates do not extrapolate across models
or tiers. The tool makes no API-equivalent monthly-value fallback: no defensible
official full-month value was found for these consumer limits. R01 has no before/
after meters or verified window boundaries, so its subscription costs remain
uncalibrated; this implementation does not deliberately spend quota to exhaust it.

For independent dashboard numbers, edit the persistent `manual_usage.csv` columns:
`dashboard_total_tokens`, `dashboard_cost`, `dashboard_currency`, `source`,
`recorded_at`, `notes`. Leave unavailable entries blank. Do not change thread/run
IDs or the header. Provide a currency with cost and explain the dashboard's time
window/scope and what its total includes. For a conversation total spanning runs,
enter it on **one** row only. Reports keep these values in separate dashboard
columns; recollection does not overwrite edits. Generated report CSVs are outputs,
so edit the persistent input rather than a generated report. Different currencies
are not averaged together. Manual entries never silently replace measured tokens.

## Quality scoring

Use the exact `run_id` printed by collect. Scores are accepted only for a collected
final run. Do not score the shipped smoke runs until the coordinator reviews them.

```powershell
python tools/agent-eval/agent_eval.py score --run '<run-id>' --scorer user --correctness 4 --completeness 4 --evidence-rigor 3 --instruction-following 5 --usefulness 4 --notes 'Explain observed strengths and defects'
```

Each dimension is 1–5: 1 fails, 2 has major defects, 3 is usable with material
corrections, 4 is strong with minor corrections, 5 fully meets the task with
convincing evidence. Fixed dimensions are correctness, completeness, evidence/rigor,
instruction following and usefulness. A review retains its source run snapshot.
An identical review is deduplicated; a changed review appends history. Reports use
the latest review per scorer/run, average scorers equally per run, then runs equally
within a thread, then evaluation units equally. Unscored units are n/a, never zero.

## Verification and real example

Verified on Python 3.12.3, 2026-11-14. See `evidence/agent-eval/VERIFICATION.md` for
exact smoke commands, observed values and the final fixture test result.

```powershell
python -m unittest discover -s tools/agent-eval -p 'test_*.py' -v
python tools/agent-eval/agent_eval.py collect --thread 'thread:<thread-id>' --experiment carriers-v2 --task carrier-research --variant sol-xhigh-fast
```

Verified first collection: `Collected 1 run(s) from 1 thread(s); appended 1 snapshot(s).`
Sol: completed, 1012.254 s wall, one turn; input 8,791,399, cached 8,544,896,
uncached 246,503, output 40,811, reasoning 11,067, cache creation 0.
Context: 289,494 / 475,000. Options: xhigh, priority.
The actual evidence is local metadata only; no quality scores or invented prices
are shipped. Fair-test procedure: [PROTOCOL.md](PROTOCOL.md).

## Reviews ledger (`evidence/agent-eval/reviews.jsonl`)

Orchestrator-maintained, append-only. One record per reviewer per experiment, human and AI side by side: `reviewer`, `reviewer_kind` (`human`, `ai_neutral_judge`, `ai_contestant_peer`), `blind`, `format` (`rubric_1_5` with per-variant scores incl. creativity, or `per_area_ranking` for the user's area rankings + 3/2/1 points), `ranking`, optional `authorship_guess`, `decisions`, `source`. AI rubric scores are also in `scores.jsonl` (scorer `blind-judge:*` or `peer:<variant>`), so report quality means average neutral judge + peers (including self-scores; `notes` marks `self=True`). The user's area rankings are not rubric scores and live only here.
