"""Offline T3 run metrics. Python 3.12+, standard library only."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import sys
import tomllib

from antigravity_usage import conversation_usage
import quota_tracking as qt

TOOL_DIR = Path(__file__).resolve().parent
WORKSPACE = TOOL_DIR.parent.parent
EVIDENCE = WORKSPACE / "evidence" / "agent-eval"
PREFIX = "orchestration_v2_projection_"
FIELDS = {
    "input": "inputTokens", "cached_input": "cachedInputTokens",
    "output": "outputTokens", "reasoning": "reasoningTokens",
    "cache_creation": "cacheCreationTokens",
}
RUBRIC = ("correctness", "completeness", "evidence_rigor",
          "instruction_following", "usefulness")
TERMINAL = {"completed", "failed", "cancelled", "interrupted"}
MANUAL_COLUMNS = ("thread_id", "run_id", "dashboard_total_tokens", "dashboard_cost",
                  "dashboard_currency", "source", "recorded_at", "notes")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def obj(raw):
    if raw is None:
        return {}
    result = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(result, dict):
        raise ValueError("Expected a JSON object in projection metadata")
    return result


def default_data_dir():
    return Path(os.environ.get("T3_DATA_DIR") or (Path(os.environ.get("USERPROFILE") or Path.home()) / ".t3" / "userdata"))


@contextmanager
def read_db(data_dir):
    """No immutable=1: a live WAL must remain visible. Never create a missing DB."""
    path = (Path(data_dir).expanduser() / "statev2.sqlite").resolve()
    if not path.is_file():
        raise ValueError(f"Database does not exist: {path}")
    con = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5.0)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA query_only=ON")
        con.execute("BEGIN")  # One short, consistent WAL read snapshot per collection.
        yield con
    finally:
        con.rollback()
        con.close()


def rows(con, suffix, thread_id, columns="*"):
    # Table/column identifiers are internal constants; selectors are bound parameters.
    return [dict(r) for r in con.execute(
        f"SELECT {columns} FROM {PREFIX}{suffix} WHERE thread_id=?", (thread_id,))]


def select_threads(con, args):
    selected = set(args.thread or [])
    for parent in args.parent or []:
        pending, visited = [parent], {parent}
        while pending:
            current = pending.pop()
            children = con.execute(
                f"SELECT child_thread_id FROM {PREFIX}subagents WHERE thread_id=? AND child_thread_id IS NOT NULL",
                (current,)).fetchall()
            for (child,) in children:
                if child in visited:
                    continue
                visited.add(child)
                selected.add(child)
                if args.recursive:
                    pending.append(child)
    for text in args.title_contains or []:
        # Substring matching cannot use a title B-tree. Scan ONLY id/title metadata,
        # never payloads, turns, messages or items across the database.
        selected.update(r[0] for r in con.execute(
            f"SELECT thread_id FROM {PREFIX}threads WHERE instr(lower(title), lower(?)) > 0", (text,)))
    if not selected:
        raise ValueError("No matching threads")
    return sorted(selected)


def options(selection):
    value = selection.get("options") or {}
    if isinstance(value, dict):
        return value
    return {v["id"]: v.get("value") for v in value if isinstance(v, dict) and "id" in v}


def seconds(start, end):
    if not start or not end:
        return None
    return round((datetime.fromisoformat(end.replace("Z", "+00:00")) -
                  datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds(), 3)


def usage_summary(turns):
    totals = {key: None for key in (*FIELDS, "uncached_input")}
    coverage = {key: 0 for key in totals}
    details, flags, models = [], set(), set()
    for turn in turns:
        payload = obj(turn["payload_json"])
        usage = payload.get("turnTokenUsage")
        usage = usage if isinstance(usage, dict) else {}
        declared = payload.get("model")
        if isinstance(declared, str) and declared:
            models.add(declared)
        models.update(m for m in usage.get("models", []) if isinstance(m, str) and m)
        values = {}
        for key, source in FIELDS.items():
            value = usage.get(source)
            valid = isinstance(value, int) and not isinstance(value, bool) and value >= 0
            values[key] = value if valid else None
            if valid:
                totals[key] = (totals[key] or 0) + value
                coverage[key] += 1
            elif value is not None:
                flags.add("invalid_usage_value:" + source)
        inp, cached = values["input"], values["cached_input"]
        if inp is not None and cached is not None:
            if cached <= inp:
                values["uncached_input"] = inp - cached
                totals["uncached_input"] = (totals["uncached_input"] or 0) + inp - cached
                coverage["uncached_input"] += 1
            else:
                flags.add("cached_input_exceeds_input")
        if not usage:
            flags.add("missing_turn_usage")
        elif usage.get("usageStatus") != "complete":
            flags.add("usage_not_complete")
        if usage and usage.get("usageScope") != "main_agent":
            flags.add("usage_scope_not_main_agent")
        if usage.get("hasSubagents"):
            flags.add("usage_has_subagents")
        # Keep only usage metadata, never message/tool payloads or context snapshots.
        details.append({
            "provider_turn_id": turn["provider_turn_id"], "status": turn["status"],
            "started_at": turn["started_at"], "completed_at": turn["completed_at"],
            "usage_scope": usage.get("usageScope"), "usage_status": usage.get("usageStatus"),
            "has_subagents": usage.get("hasSubagents"), "models": usage.get("models", []),
            "tokens": values,
            "context_usage": context_usage(payload.get("tokenUsage")),
        })
    if not turns:
        flags.add("no_provider_turns")
    for key, count in coverage.items():
        if count != len(turns) or not turns:
            flags.add("incomplete_tokens:" + key)
    return totals, coverage, details, sorted(flags), sorted(models)


def context_usage(value):
    value = value if isinstance(value, dict) else {}
    return {name: value.get(source) if isinstance(value.get(source), int)
            and not isinstance(value.get(source), bool) and value[source] >= 0 else None
            for name, source in (("used_tokens", "usedTokens"), ("max_tokens", "maxTokens"))}


def context_summary(run, runs, turns, providers):
    ids = {run["provider_thread_id"]} | {t["provider_thread_id"] for t in turns}
    contexts = []
    usable = []
    for provider in providers:
        if provider["provider_thread_id"] not in ids:
            continue
        usage = context_usage(obj(provider["payload_json"]).get("contextUsage"))
        # Provider-thread context is mutable, not historical per-run data. Never
        # assign its later-run meter to an earlier run on that provider thread.
        later = any(r["ordinal"] > run["ordinal"] and
                    r["provider_thread_id"] == provider["provider_thread_id"] for r in runs)
        item = {"provider_thread_id": provider["provider_thread_id"],
                "updated_at": provider["updated_at"], "context_usage": usage,
                "belongs_to_latest_run": not later}
        contexts.append(item)
        if not later and usage["used_tokens"] is not None:
            usable.append(item)
    if usable:
        latest = max(usable, key=lambda p: p["updated_at"] or "")
        return contexts, latest["context_usage"], "provider_thread.contextUsage"
    snapshots = [t for t in turns if context_usage(obj(t["payload_json"]).get("tokenUsage"))["used_tokens"] is not None]
    if snapshots:
        latest = max(snapshots, key=lambda t: (t["completed_at"] or t["started_at"] or "", t["ordinal"]))
        return contexts, context_usage(obj(latest["payload_json"]).get("tokenUsage")), "provider_turn.tokenUsage"
    return contexts, context_usage(None), None


def thread_records(con, tid, tags, collected_at, data_dir=None):
    found = rows(con, "threads", tid)
    if not found:
        raise ValueError(f"Unknown thread: {tid}")
    thread = found[0]
    meta = obj(thread["payload_json"])
    legacy = con.execute("SELECT model_selection_json FROM projection_threads WHERE thread_id=?", (tid,)).fetchone()
    thread_selection = meta.get("modelSelection") or (obj(legacy[0]) if legacy else {})
    lineage = meta.get("lineage") or {}
    # child_thread_id has its own index; no all-thread lineage JSON scan.
    parents = [r[0] for r in con.execute(
        f"SELECT DISTINCT thread_id FROM {PREFIX}subagents WHERE child_thread_id=?", (tid,))]
    runs = sorted(rows(con, "runs", tid), key=lambda r: r["ordinal"])
    attempts = rows(con, "run_attempts", tid)
    providers = rows(con, "provider_threads", tid, "provider_thread_id, updated_at, payload_json")
    sessions = rows(con, "provider_sessions", tid, "payload_json") if any(r["provider"] == "antigravity" for r in runs) and data_dir else []
    by_attempt = {a["attempt_id"]: a["run_id"] for a in attempts}
    by_node = {a["root_node_id"]: a["run_id"] for a in attempts}
    for run in runs:
        root = obj(run["payload_json"]).get("rootNodeId")
        if root:
            by_node[root] = run["run_id"]
    turns_by_run = defaultdict(list)
    unmapped = []
    for turn in rows(con, "provider_turns", tid):
        rid = by_attempt.get(turn["run_attempt_id"]) or by_node.get(turn["node_id"])
        if not rid:
            node = con.execute(f"SELECT run_id FROM {PREFIX}nodes WHERE node_id=? AND thread_id=?",
                               (turn["node_id"], tid)).fetchone()
            rid = node[0] if node else None
        if rid in {r["run_id"] for r in runs}:
            turns_by_run[rid].append(turn)
        else:
            unmapped.append(turn["provider_turn_id"])
    counts = defaultdict(dict)
    for r in con.execute(f"SELECT run_id, type, count(*) FROM {PREFIX}turn_items WHERE thread_id=? GROUP BY run_id,type", (tid,)):
        counts[r[0]][r[1]] = r[2]
    records = []
    for run in runs:
        rid = run["run_id"]
        payload = obj(run["payload_json"])
        selection = payload.get("modelSelection") or thread_selection
        run_turns = sorted(turns_by_run[rid], key=lambda t: (t["started_at"] or "", t["provider_turn_id"]))
        tokens, coverage, details, flags, observed = usage_summary(run_turns)
        t3_tokens, t3_coverage = dict(tokens), dict(coverage)
        source, unit_count = "t3_turnTokenUsage", len(run_turns)
        conversations = []
        provider_contexts, context, context_source = context_summary(run, runs, run_turns, providers)
        if all(tokens[k] is None for k in FIELDS):
            usage_status = "unavailable from T3"
        elif all(coverage[k] == len(run_turns) for k in FIELDS) and not {
                "usage_not_complete", "usage_scope_not_main_agent", "cached_input_exceeds_input"}.intersection(flags):
            usage_status = "complete"
        else:
            usage_status = "partial"
        if run["provider"] == "antigravity" and data_dir:
            provider_ids = {run["provider_thread_id"]} | {t["provider_thread_id"] for t in run_turns}
            selected_providers = [p for p in providers if p["provider_thread_id"] in provider_ids]
            conversations, warnings = conversation_usage(
                data_dir, [obj(p["payload_json"]) for p in selected_providers],
                [obj(t["payload_json"]) for t in run_turns], [obj(s["payload_json"]) for s in sessions],
                run["requested_at"], run["completed_at"] or collected_at)
            flags.extend(warnings)
            shared = any(r["run_id"] != rid and r["provider_thread_id"] in provider_ids for r in runs)
            if shared and conversations:
                flags.append("antigravity_conversation_shared_multiple_runs")
            if conversations and not shared and usage_status != "complete":
                source = "antigravity_gen_metadata"
                unit_count = sum(c["generation_count"] for c in conversations)
                decoded_count = sum(c["decoded_generation_count"] for c in conversations)
                tokens = {key: sum(c["tokens"][key] for c in conversations) if decoded_count else None
                          for key in ("input", "cached_input", "uncached_input", "output", "reasoning")}
                tokens["cache_creation"] = None
                coverage = {key: decoded_count if key != "cache_creation" else 0 for key in tokens}
                usage_status = "complete (experimental)" if all(c["complete"] for c in conversations) else "partial (experimental)"
                flags.extend(("antigravity_decoder_experimental", "antigravity_cache_dashboard_discrepancy_unresolved",
                              "antigravity_reasoning_likely", "cache_creation_not_reported"))
                if any(c["output_split_mismatches"] for c in conversations):
                    flags.append("antigravity_output_split_mismatch")
        selected_model = selection.get("model")
        model = observed[0] if len(observed) == 1 else ("mixed:" + ",".join(observed) if observed else selected_model)
        if len(observed) > 1:
            flags.append("mixed_models")
        if not payload.get("modelSelection"):
            flags.append("model_options_from_current_thread")
        if selected_model and observed and selected_model not in observed:
            flags.append("selected_observed_model_mismatch")
        if unmapped:
            flags.append("unmapped_thread_turns")
        finished = run["status"] in TERMINAL and run["completed_at"] is not None
        if not finished:
            flags.append("run_not_final")
        record = {
            "schema_version": 1, "thread_id": tid, "run_id": rid, "run_ordinal": run["ordinal"],
            "title": thread["title"], "project_id": thread["project_id"],
            "parent_thread_id": lineage.get("parentThreadId") or (parents[0] if parents else None),
            "relationship_to_parent": lineage.get("relationshipToParent"),
            "provider": run["provider"], "provider_instance_id": run.get("provider_instance_id"),
            "model": model, "selected_model": selected_model, "observed_models": observed,
            "options": options(selection), "status": run["status"], "is_final": finished,
            "thread_created_at": thread["created_at"], "thread_updated_at": thread["updated_at"],
            "requested_at": run["requested_at"], "started_at": payload.get("startedAt"),
            "completed_at": run["completed_at"],
            "wall_seconds": seconds(run["requested_at"], run["completed_at"]) if finished else None,
            "execution_seconds": seconds(payload.get("startedAt"), run["completed_at"]) if finished else None,
            "elapsed_seconds": seconds(run["requested_at"], collected_at) if not finished else None,
            "thread_run_count": len(runs), "run_count": 1, "turn_count": len(run_turns),
            "attempt_count": sum(a["run_id"] == rid for a in attempts),
            "tokens": tokens, "token_coverage": coverage, "turn_usage": details,
            "usage_source": source, "usage_unit_count": unit_count,
            "t3_tokens": t3_tokens, "t3_token_coverage": t3_coverage,
            "antigravity_conversations": conversations,
            "generation_count": sum(c["generation_count"] for c in conversations) if conversations else None,
            "cumulative_usage_status": usage_status,
            "provider_thread_contexts": provider_contexts,
            "context_used_tokens": context["used_tokens"], "context_max_tokens": context["max_tokens"],
            "context_source": context_source,
            "item_counts": counts[rid], "thread_unassigned_item_counts": counts[None],
            "unmapped_thread_turn_ids": unmapped, "flags": sorted(set(flags)), **tags,
        }
        # Snapshot dedup ignores collection time and volatile running elapsed time.
        stable = {k: v for k, v in record.items() if k != "elapsed_seconds"}
        record["snapshot_id"] = digest(stable)
        record["collected_at"] = collected_at
        records.append(record)
    return records


def read_jsonl(path):
    if not path.exists():
        return []
    result = []
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    result.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Invalid JSON at {path.name}:{number}: {exc.msg}") from exc
    return result


def append_unique(path, records, key):
    """Single writer, append-only history. Reports collapse snapshots by run ID."""
    def identity(record):
        base = (record["thread_id"], record["run_id"])
        return base + (record["scorer"],) if key == "score_id" else base

    latest = {identity(r): r[key] for r in read_jsonl(path)}
    pending = []
    for record in records:
        logical = identity(record)
        if latest.get(logical) != record[key]:
            pending.append(record)
            latest[logical] = record[key]
    if pending:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            for record in pending:
                handle.write(canonical(record) + "\n")
    return len(pending)


def latest_records(records):
    latest = {}
    for record in records:
        latest[(record["thread_id"], record["run_id"])] = record
    return list(latest.values())


def thread_metrics(records):
    """Build comparable thread units; conversation usage cannot be split by run."""
    groups = defaultdict(list)
    for r in records:
        groups[r["thread_id"]].append(r)
    result = []
    for members in groups.values():
        members.sort(key=lambda r: r["run_ordinal"])
        r = dict(members[-1])
        r["member_runs"] = [{"thread_id": m["thread_id"], "run_id": m["run_id"]} for m in members]
        r["is_final"] = all(m["is_final"] for m in members)
        r["status"] = "completed" if all(m["status"] == "completed" for m in members) else "mixed_or_incomplete"
        r["requested_at"] = min(m["requested_at"] for m in members)
        r["completed_at"] = max(m["completed_at"] for m in members) if r["is_final"] else None
        r["wall_seconds"] = seconds(r["requested_at"], r["completed_at"])
        r["execution_seconds"] = sum(m["execution_seconds"] for m in members) if all(m["execution_seconds"] is not None for m in members) else None
        r["run_count"] = len(members)
        r["turn_count"] = sum(m["turn_count"] for m in members)
        r["usage_unit_count"] = sum(m["usage_unit_count"] for m in members)
        r["tokens"] = {field: sum(m["tokens"][field] for m in members if m["tokens"][field] is not None)
                       if any(m["tokens"][field] is not None for m in members) else None for field in members[0]["tokens"]}
        r["token_coverage"] = {field: sum(m["token_coverage"][field] for m in members) for field in r["tokens"]}
        r["flags"] = sorted({flag for m in members for flag in m["flags"]})
        configs = {(m["provider"], m["model"], canonical(m["options"])) for m in members}
        if len(configs) > 1:
            r["flags"].append("mixed_run_configuration")
            r["model"] = "mixed:" + ",".join(sorted({m["model"] or "unknown" for m in members}))
            r["provider"] = "mixed:" + ",".join(sorted({m["provider"] for m in members}))
            r["options"] = {"per_run": [m["options"] for m in members]}
        for tag in ("experiment", "task", "variant", "role", "quota_account"):
            values = {m.get(tag) for m in members}
            if len(values) > 1:
                raise ValueError(f"Thread has conflicting {tag} tags; recollect it with consistent tags or report --unit run")
        conversations = {}
        for m in members:
            for conversation in m.get("antigravity_conversations", []):
                conversations[conversation["relative_path"]] = conversation
        r["antigravity_conversations"] = list(conversations.values())
        if conversations and all(m["provider"] == "antigravity" for m in members):
            values = list(conversations.values())
            decoded = sum(c["decoded_generation_count"] for c in values)
            r["usage_source"] = "antigravity_gen_metadata"
            r["usage_unit_count"] = sum(c["generation_count"] for c in values)
            r["generation_count"] = r["usage_unit_count"]
            r["tokens"] = {field: sum(c["tokens"][field] for c in values) if decoded else None
                           for field in ("input", "cached_input", "uncached_input", "output", "reasoning")}
            r["tokens"]["cache_creation"] = None
            r["token_coverage"] = {field: decoded if field != "cache_creation" else 0 for field in r["tokens"]}
            r["cumulative_usage_status"] = "complete (experimental)" if all(c["complete"] for c in values) else "partial (experimental)"
            r["flags"] = [f for f in r["flags"] if f != "antigravity_conversation_shared_multiple_runs"]
            r["flags"].extend(("antigravity_decoder_experimental", "antigravity_cache_dashboard_discrepancy_unresolved", "antigravity_reasoning_likely", "cache_creation_not_reported"))
        elif len(members) > 1:
            states = {m["cumulative_usage_status"] for m in members}
            r["cumulative_usage_status"] = "complete" if states == {"complete"} else ("unavailable from T3" if states == {"unavailable from T3"} else "partial")
        r["flags"] = sorted(set(r["flags"]))
        maxima = [m.get("observed_max_prompt_input") for m in members if m.get("observed_max_prompt_input") is not None]
        r["observed_max_prompt_input"] = max(maxima, default=None)
        result.append(r)
    return result


def seed_manual(records):
    """Preserve user edits. Append blank dashboard columns only for new runs."""
    path = EVIDENCE / "manual_usage.csv"
    known = set()
    if path.exists():
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != list(MANUAL_COLUMNS):
                raise ValueError("manual_usage.csv has unexpected columns; restore the documented header")
            known = {(r["thread_id"], r["run_id"]) for r in reader}
    new = []
    for r in records:
        key = (r["thread_id"], r["run_id"])
        if key not in known:
            new.append({"thread_id": key[0], "run_id": key[1]})
            known.add(key)
    if new:
        path.parent.mkdir(parents=True, exist_ok=True)
        fresh = not path.exists()
        with path.open("a", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=MANUAL_COLUMNS)
            if fresh:
                writer.writeheader()
            writer.writerows(new)


def manual_usage(path):
    result = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            for field in ("dashboard_total_tokens", "dashboard_cost"):
                value = row.get(field, "").strip()
                row[field] = float(value) if value else None
                if row[field] is not None and (not math.isfinite(row[field]) or row[field] < 0):
                    raise ValueError(f"Invalid nonnegative {field} in manual_usage.csv")
            if row["dashboard_cost"] is not None and not row.get("dashboard_currency", "").strip():
                raise ValueError("dashboard_cost requires dashboard_currency")
            result[(row["thread_id"], row["run_id"])] = row
    return result


def collect(args):
    tags = {key: getattr(args, key) for key in ("experiment", "task", "variant", "role", "quota_account")}
    previous = {(r["thread_id"], r["run_id"]): r for r in latest_records(read_jsonl(EVIDENCE / "runs.jsonl"))}
    records, quota_records = [], []
    with read_db(args.data_dir) as con:
        stamp = now()
        tids = select_threads(con, args)
        for tid in tids:
            batch = thread_records(con, tid, tags, stamp, args.data_dir)
            if args.run:
                batch = [r for r in batch if r["run_id"] in args.run]
            if not batch:
                print(f"Warning: no runs for {tid}", file=sys.stderr)
            for record in batch:
                older = previous.get((record["thread_id"], record["run_id"]), {})
                for key, value in tags.items():
                    if value is None and older.get(key) is not None:
                        record[key] = older[key]
                record["role"] = record.get("role") or "contestant"
                record["quota_account"] = record.get("quota_account") or "default"
                signals, warnings, max_prompt = qt.discover(con, tid, record["provider"], record["model"],
                                                            stamp, record["quota_account"])
                if record["provider"] == "antigravity":
                    signals.extend(qt.conversation_errors(args.data_dir, record.get("antigravity_conversations", []),
                        record["provider"], record["model"], stamp, tid, record["quota_account"]))
                record["quota_snapshots"] = signals
                record["quota_status"] = ", ".join(warnings) or "observed"
                record["observed_max_prompt_input"] = max_prompt
                quota_records.extend(signals)
                record["snapshot_id"] = digest({k: v for k, v in record.items()
                                                if k not in ("elapsed_seconds", "snapshot_id", "collected_at")})
            records.extend(batch)
    missing = set(args.run or []) - {r["run_id"] for r in records}
    if missing:
        raise ValueError("Requested run IDs were not found in selected threads: " + ", ".join(sorted(missing)))
    append_quota(quota_records)
    all_runs = dict(previous)
    all_runs.update({(r["thread_id"], r["run_id"]): r for r in records})
    units = calibration_units(list(all_runs.values()))
    snapshots = read_jsonl(EVIDENCE / "quota_snapshots.jsonl")
    capacities = qt.ledger(units, snapshots)
    with (TOOL_DIR / "prices.toml").open("rb") as handle:
        plans = tomllib.load(handle).get("subscriptions", {})
    for record in records:
        sub = qt.subscription(record, units, snapshots, capacities, plans)
        record["quota_deltas"] = sub["deltas"]
        record["subscription"] = sub
        record["snapshot_id"] = digest({k: v for k, v in record.items()
                                        if k not in ("elapsed_seconds", "snapshot_id", "collected_at")})
    added = append_unique(EVIDENCE / "runs.jsonl", records, "snapshot_id")
    refresh_calibration()
    seed_manual(records)
    print(f"Collected {len(records)} run(s) from {len(tids)} thread(s); appended {added} snapshot(s).")
    for r in records:
        print(canonical({k: r[k] for k in ("run_id", "model", "options", "status", "wall_seconds", "elapsed_seconds", "turn_count", "generation_count", "tokens", "usage_source", "cumulative_usage_status", "context_used_tokens", "context_max_tokens", "context_source", "item_counts", "flags", "snapshot_id")}))


def score(args):
    candidates = [r for r in latest_records(read_jsonl(EVIDENCE / "runs.jsonl"))
                  if r["run_id"] == args.run and (not args.thread or r["thread_id"] == args.thread)]
    if len(candidates) != 1:
        raise ValueError("Run must identify exactly one collected run; add --thread if needed")
    run = candidates[0]
    if not run["is_final"]:
        raise ValueError("Collect the completed run before scoring")
    values = {key: getattr(args, key) for key in RUBRIC}
    record = {"schema_version": 1, "thread_id": run["thread_id"], "run_id": args.run,
              "run_snapshot_id": run["snapshot_id"], "scorer": args.scorer,
              "rubric": values, "notes": args.notes}
    record["score_id"] = digest(record)
    record["scored_at"] = now()
    added = append_unique(EVIDENCE / "scores.jsonl", [record], "score_id")
    print(f"Appended {added} score(s); mean {statistics.mean(values.values()):.2f}/5.")


def estimate_cost(run, prices, allow_partial=False):
    """Input includes cache hits; reasoning is already part of output. No double count."""
    entry = prices.get("models", {}).get(run.get("model"), {})
    if run.get("options", {}).get("fastMode"):
        return None  # Never silently price a provider-specific premium as standard.
    tier = run.get("options", {}).get("serviceTier")
    if tier in (None, "default", "standard"):
        rates = entry
    else:
        rates = entry.get("tiers", {}).get(str(tier), {})
    token = run["tokens"]
    threshold = entry.get("long_context_threshold")
    if threshold is not None:
        # Cumulative input is NOT prompt length. Use historical request-context
        # observations; never multiply every token because an entire run is large.
        maximum = run.get("observed_max_prompt_input")
        if maximum is not None and maximum > threshold:
            return None  # Aggregate usage cannot split short/long requests safely.
        if token.get("input") is None or (token["input"] > threshold and maximum is None):
            return None
    reasons = {"missing_turn_usage", "usage_not_complete", "usage_scope_not_main_agent",
               "usage_has_subagents", "mixed_models", "mixed_run_configuration", "unmapped_thread_turns", "cached_input_exceeds_input"}
    alternate = run.get("usage_source") == "antigravity_gen_metadata"
    if alternate:
        reasons = {"mixed_models", "antigravity_mapping_heuristic_verify_manually", "antigravity_mapping_ambiguous",
                   "antigravity_conversation_shared_multiple_runs", "mixed_run_configuration"}
        if run["cumulative_usage_status"] != "complete (experimental)" and not (
                allow_partial and run["cumulative_usage_status"] == "partial (experimental)"):
            return None
    if reasons.intersection(run["flags"]) or not run["is_final"]:
        return None
    if not alternate and token.get("cache_creation") != 0:
        # No universal cache-write billing semantics. Do not guess.
        return None
    total = 0.0
    for token_key, rate_key in (("uncached_input", "input_per_million"),
                                ("cached_input", "cached_input_per_million"),
                                ("output", "output_per_million")):
        value, rate = token.get(token_key), rates.get(rate_key)
        covered = run["token_coverage"].get(token_key, 0)
        if value is None or (covered != run.get("usage_unit_count", run["turn_count"])
                            and not (alternate and allow_partial and covered > 0)):
            return None
        if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or rate < 0:
            return None
        total += value * rate / 1_000_000
    return total


def average(values):
    return statistics.mean(values) if values else None


def summarize(records, scores, prices, manual=None):
    # One latest review per scorer and run, then average scorers equally per run.
    latest_scores = {}
    for s in scores:
        latest_scores[(s["thread_id"], s["run_id"], s["scorer"])] = s
    groups = defaultdict(list)
    for r in records:
        key = (r.get("experiment"), r.get("task"), r["provider"], r.get("model"), r.get("variant"), canonical(r["options"]), r.get("role") or "contestant")
        groups[key].append(r)
    summaries = []
    for key, group in sorted(groups.items(), key=lambda item: tuple(str(v or "") for v in item[0])):
        completed = [r for r in group if r["is_final"]]
        durations = [r["wall_seconds"] for r in completed if r["wall_seconds"] is not None]
        costs = [c for r in completed if (c := estimate_cost(r, prices)) is not None]
        observed_costs = [c for r in completed if (c := estimate_cost(r, prices, allow_partial=True)) is not None]
        contexts = [r["context_used_tokens"] for r in group if r["context_used_tokens"] is not None]
        context_max = [r["context_max_tokens"] for r in group if r["context_max_tokens"] is not None]
        usage_states = sorted({r["cumulative_usage_status"] for r in group})
        dashboard = []
        for r in completed:
            entries = [(manual or {}).get((m["thread_id"], m["run_id"]), {})
                       for m in r.get("member_runs", [r])]
            token_values = [d["dashboard_total_tokens"] for d in entries if d.get("dashboard_total_tokens") is not None]
            cost_values = [d["dashboard_cost"] for d in entries if d.get("dashboard_cost") is not None]
            currencies = {d["dashboard_currency"] for d in entries if d.get("dashboard_cost") is not None}
            dashboard.append({"dashboard_total_tokens": sum(token_values) if token_values else None,
                              "dashboard_cost": sum(cost_values) if cost_values and len(currencies) == 1 else None,
                              "dashboard_currency": next(iter(currencies)) if len(currencies) == 1 else None})
        dashboard_tokens = [d["dashboard_total_tokens"] for d in dashboard if d.get("dashboard_total_tokens") is not None]
        dashboard_costs = [d["dashboard_cost"] for d in dashboard if d.get("dashboard_cost") is not None]
        dashboard_currencies = {d["dashboard_currency"] for d in dashboard if d.get("dashboard_cost") is not None}
        row = dict(zip(("experiment", "task", "provider", "model", "variant", "options", "role"), key))
        row.update({"count": len(group), "final_count": len(completed),
                    "completed_count": sum(r["status"] == "completed" for r in group),
                    "flagged_count": sum(bool(r["flags"]) for r in group),
                    "duration_n": len(durations), "duration_mean_s": average(durations),
                    "wall_time_total_s": sum(durations) if durations and len(durations) == len(completed) else None,
                    "duration_median_s": statistics.median(durations) if durations else None,
                    "cost_n": len(costs), "cost_mean": average(costs),
                    "cost_total": sum(costs) if costs and len(costs) == len(completed) else None})
        subscriptions = [r.get("subscription", {}) for r in completed]
        sub_costs = [s["cost"] for s in subscriptions if s.get("cost") is not None]
        row.update(api_cost_mean=row["cost_mean"], api_cost_total=row["cost_total"],
                   subscription_cost_n=len(sub_costs), subscription_cost_mean=average(sub_costs),
                   subscription_cost_total=sum(sub_costs) if sub_costs and len(sub_costs) == len(completed) else None,
                   subscription_status="; ".join(sorted({s.get("status", "uncalibrated") for s in subscriptions})) or "uncalibrated",
                   subscription_capacity_lower_bounds=canonical([s.get("capacity_lower_bounds", {}) for s in subscriptions]),
                   subscription_cost_upper_bound_total=sum(s["upper_bound"] if s.get("upper_bound") is not None else s["cost"]
                       for s in subscriptions) if subscriptions and all(s.get("upper_bound") is not None or s.get("cost") is not None for s in subscriptions) else None,
                   quota_deltas=canonical([s.get("deltas", []) for s in subscriptions]))
        unique_conversations = {c["relative_path"]: c for r in group for c in r.get("antigravity_conversations", [])}
        row.update({"cumulative_usage_status": ", ".join(usage_states),
                    "usage_sources": ", ".join(sorted({r.get("usage_source", "t3_turnTokenUsage") for r in group})),
                    "generation_count": sum(c["generation_count"] for c in unique_conversations.values()) if unique_conversations else None,
                    "decoded_generation_count": sum(c["decoded_generation_count"] for c in unique_conversations.values()) if unique_conversations else None,
                    "observed_cost_n": len(observed_costs), "observed_cost_mean": average(observed_costs),
                    "cost_status": "unavailable from T3" if usage_states == ["unavailable from T3"] else
                    ("estimated" if costs and len(costs) == len(completed) else "unknown prices or incomplete usage"),
                    "context_n": len(contexts), "context_used_mean": average(contexts),
                    "context_max_mean": average(context_max),
                    "dashboard_usage_n": len(dashboard_tokens), "dashboard_total_tokens_mean": average(dashboard_tokens),
                    "dashboard_cost_n": len(dashboard_costs),
                    "dashboard_cost_mean": average(dashboard_costs) if len(dashboard_currencies) == 1 else None,
                    "dashboard_currency": ", ".join(sorted(dashboard_currencies)) or None})
        if not costs and any(r["tokens"].get("cache_creation") for r in completed):
            row["cost_status"] = "cache-write TTL breakdown unavailable"
        for field in (*FIELDS, "uncached_input"):
            values = [r["tokens"][field] for r in completed
                      if r.get("usage_unit_count", r["turn_count"]) > 0 and r["token_coverage"][field] == r.get("usage_unit_count", r["turn_count"])
                      and r["tokens"][field] is not None]
            row[field + "_n"] = len(values)
            row[field + "_mean"] = average(values)
            row[field + "_total"] = sum(values) if values and len(values) == len(completed) else None
            observed_values = [r["tokens"][field] for r in completed if r["tokens"][field] is not None]
            row[field + "_observed_n"] = len(observed_values)
            row[field + "_observed_mean"] = average(observed_values)
        quality = []
        for r in completed:
            member_quality = []
            for member in r.get("member_runs", [r]):
                reviews = [s for (tid, rid, _), s in latest_scores.items() if (tid, rid) == (member["thread_id"], member["run_id"])]
                if reviews:
                    member_quality.append({field: average([s["rubric"][field] for s in reviews]) for field in RUBRIC})
            if member_quality:
                quality.append({field: average([q[field] for q in member_quality]) for field in RUBRIC})
        row["quality_n"] = len(quality)
        for field in RUBRIC:
            row[field + "_mean"] = average([q[field] for q in quality])
        row["quality_mean"] = average([statistics.mean(q.values()) for q in quality])
        summaries.append(row)
    return summaries


def display(value):
    if value is None or value == "":
        return "n/a"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value).replace("|", "\\|").replace("\n", " ")


def append_quota(records):
    path = EVIDENCE / "quota_snapshots.jsonl"
    known = {s["snapshot_id"] for s in read_jsonl(path)}
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("a", encoding="utf-8") as handle:
        for item in records:
            if item["snapshot_id"] not in known:
                handle.write(canonical(item) + "\n")
                known.add(item["snapshot_id"])
                count += 1
    return count


def calibration_units(records):
    # Evaluation tags and roles do not change quota. Group without cross-run tag
    # conflicts, but keep shared Antigravity conversations counted once per thread.
    copies = [{**r, "experiment": None, "task": None, "variant": None, "role": None} for r in records]
    return ([r for r in copies if r["provider"] != "antigravity"] +
            thread_metrics([r for r in copies if r["provider"] == "antigravity"])) if copies else []


def refresh_calibration():
    units = calibration_units(latest_records(read_jsonl(EVIDENCE / "runs.jsonl")))
    result = qt.ledger(units, read_jsonl(EVIDENCE / "quota_snapshots.jsonl"))
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "calibration_ledger.json").write_text(canonical({
        "generated_at": now(), "token_measure": "input + output; cache reads included once; reasoning included in output",
        "windows": result}), encoding="utf-8")
    return units, result


def quota(args):
    if args.manual:
        if args.thread and len(args.thread) != 1:
            raise ValueError("A manual observation can name only one thread")
        item = qt.snapshot(args.provider, args.model, args.at or now(), window=args.window,
            used_percent=args.used_percent, remaining_percent=args.remaining_percent,
            reset_at=args.reset_at, window_start=args.window_start, account=args.quota_account,
            event=args.event, thread_id=args.thread[0] if args.thread else None, run_id=args.run,
            phase=args.phase, exclusive=args.exclusive, complete_window=args.complete_window,
            note=args.note)
        records = [item]
    else:
        if not args.thread:
            raise ValueError("Automatic quota discovery requires --thread (repeatable); no whole-database payload scans")
        if args.at:
            raise ValueError("--at is only for manual historical observations")
        records = []
        collected = latest_records(read_jsonl(EVIDENCE / "runs.jsonl"))
        with read_db(args.data_dir) as con:
            for tid in args.thread:
                signals, flags, _ = qt.discover(con, tid, args.provider, args.model, now(), args.quota_account)
                if args.provider == "antigravity":
                    conversations = {c["relative_path"]: c for r in collected if r["thread_id"] == tid
                                     for c in r.get("antigravity_conversations", [])}
                    signals.extend(qt.conversation_errors(args.data_dir, conversations.values(),
                        args.provider, args.model, now(), tid, args.quota_account))
                for item in signals:
                    # Only current projection snapshots can be labelled before/after
                    # at collection time; do not relabel old historical observations.
                    if ":" not in item["source"]:
                        item.update(phase=args.phase, exclusive=args.exclusive)
                        item["snapshot_id"] = digest({k: v for k, v in item.items() if k != "snapshot_id"})
                records.extend(signals or [qt.snapshot(args.provider, args.model, now(),
                    source="T3 scoped state inspection", thread_id=tid, account=args.quota_account,
                    note=", ".join(flags), event="unavailable")])
    count = append_quota(records)
    _, capacities = refresh_calibration()
    print(f"Appended {count} quota snapshot(s); ledger has {len(capacities)} provider/model/window group(s).")
    for item in records:
        print(canonical(item))


def report_totals(summary):
    totals = []
    for role in ("contestant", "overhead"):
        members = [r for r in summary if r["role"] == role]
        if not members:
            continue
        row = {k: None for k in summary[0]}
        row.update(role=role, variant="TOTAL", model="all", experiment=members[0]["experiment"],
                   count=sum(r["count"] for r in members), final_count=sum(r["final_count"] for r in members),
                   subscription_status="See variant coverage; total requires every final unit")
        for field in ("api_cost_total", "cost_total", "subscription_cost_total", "input_total", "cached_input_total", "output_total", "wall_time_total_s"):
            values = [r.get(field) for r in members]
            row[field] = sum(values) if all(v is not None for v in values) else None
        totals.append(row)
    return totals


def report(args):
    records = latest_records(read_jsonl(EVIDENCE / "runs.jsonl"))
    all_units, capacities = refresh_calibration()
    snapshots = read_jsonl(EVIDENCE / "quota_snapshots.jsonl")
    for field in ("experiment", "task", "variant"):
        if getattr(args, field):
            records = [r for r in records if r.get(field) == getattr(args, field)]
    if not records:
        raise ValueError("No collected runs match the report filters")
    if args.unit == "thread":
        records = thread_metrics(records)
    with Path(args.prices).open("rb") as handle:
        prices = tomllib.load(handle)
    for record in records:
        record["subscription"] = qt.subscription(record, all_units, snapshots, capacities, prices.get("subscriptions", {}))
    summary = summarize(records, read_jsonl(EVIDENCE / "scores.jsonl"), prices,
                        manual_usage(EVIDENCE / "manual_usage.csv"))
    totals = report_totals(summary)
    directory = EVIDENCE / "reports"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    base = directory / ("report-" + stamp)
    currency = prices.get("currency", "unspecified")
    columns = ["experiment", "task", "model", "variant", "options", "count", "final_count",
               "duration_median_s", "duration_mean_s", "wall_time_total_s", "context_used_mean", "context_max_mean",
               "usage_sources", "decoded_generation_count", "generation_count", "cumulative_usage_status",
               "input_observed_mean", "cached_input_observed_mean", "output_observed_mean",
               "api_cost_mean", "api_cost_total", "subscription_cost_mean", "subscription_cost_total", "subscription_status",
               "subscription_capacity_lower_bounds", "subscription_cost_upper_bound_total",
               "input_total", "cached_input_total", "output_total", "observed_cost_mean", "cost_status", "dashboard_total_tokens_mean",
               "dashboard_cost_mean", "dashboard_currency", "quality_mean"]
    lines = ["# Agent evaluation", "", f"Generated {now()}. Unit: {args.unit}. Estimated cost currency: {currency}.", "",
             "Latest snapshot per thread/run; options stay in separate groups. Final runs (including failures) feed means; running runs only feed count. "
             "Observed token means include reported counts even when coverage is partial; complete-only means and coverage counts are in CSV. n/a is unknown, never zero. "
             "Context means include current running snapshots and measure occupied context, never cumulative usage. "
             "Coverage and all rubric dimensions are in CSV. Quality averages scorers per run, then runs equally. "
             "Fill evidence/agent-eval/manual_usage.csv from the provider dashboard to populate the dashboard columns; recollection preserves edits.", ""]
    for role in ("contestant", "overhead"):
        members = [row for row in summary + totals if row["role"] == role]
        lines += ["## " + ("Contestants" if role == "contestant" else "Overhead"), ""]
        if not members:
            lines += ["No collected runs tagged with this role.", ""]
            continue
        lines += ["| " + " | ".join(columns) + " |", "| " + " | ".join("---" for _ in columns) + " |"]
        lines.extend("| " + " | ".join(display(row.get(c)) for c in columns) + " |" for row in members)
        lines.append("")
    lines += ["", "Cost = (uncached input × input rate + cached input × cache rate + output × output rate) / 1,000,000. "
              "Reasoning is not added to output. Missing prices, partial/scoped usage, mixed models or nonzero/unknown cache creation yield n/a for full cost. "
              "observed_cost_mean may price only decoded Antigravity generations and is a partial estimate when cumulative status is partial. "
              "Antigravity gen_metadata estimates use decoded f2/f5/f3 without an additional cache-creation charge (not reported); "
              "f9 reasoning meaning is likely, and its cache-read discrepancy with the provider dashboard is unresolved. "
              "OpenAI short-context estimates use maximum observed request-context input from indexed event history; "
              "missing historical samples can hide peaks. Long/mixed-context aggregate usage yields n/a. "
              "Estimates are not invoices; rates must match the provider and service tier. Subscription estimates use "
              "the maximum normalised depletion over 5-hour and weekly constraints, or workload-specific empirical capacity. "
              "Every applicable window must be measured/calibrated; never sum constraint prices. Uncalibrated capacity lower bounds "
              "and conditional cost upper bounds are in separate columns; no synthetic windows are assigned to historical runs. "
              "See calibration_ledger.json and README.md for evidence, assumptions, overlap and coverage requirements.", ""]
    markdown = "\n".join(lines)
    base.with_suffix(".md").write_text(markdown, encoding="utf-8")
    csv_columns = list(summary[0]) + ["currency"]
    with base.with_suffix(".csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=csv_columns)
        writer.writeheader()
        for row in summary + totals:
            writer.writerow({k: "n/a" if v is None else v for k, v in {**row, "currency": currency}.items()})
    print(markdown)
    print(f"Wrote {base.with_suffix('.md').relative_to(WORKSPACE).as_posix()}")
    print(f"Wrote {base.with_suffix('.csv').relative_to(WORKSPACE).as_posix()}")


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    sub = cli.add_subparsers(dest="command", required=True)
    c = sub.add_parser("collect", help="Read selected T3 threads and append changed snapshots")
    c.add_argument("--data-dir", type=Path, default=default_data_dir(), help="T3 userdata directory; default T3_DATA_DIR or home/.t3/userdata")
    c.add_argument("--thread", action="append")
    c.add_argument("--run", action="append", help="Optional exact run IDs within selected threads; repeatable")
    c.add_argument("--parent", action="append", help="Collect direct child threads via indexed subagent links")
    c.add_argument("--recursive", action="store_true", help="Include descendants of --parent")
    c.add_argument("--title-contains", action="append", help="Literal case-insensitive substring; scans thread titles only")
    c.add_argument("--role", choices=("contestant", "overhead"), help="Independent of variant; omitted preserves prior role")
    c.add_argument("--quota-account", help="Non-secret account label shared by all runs using the same quota")
    c.set_defaults(func=collect)
    s = sub.add_parser("score", help="Append a rubric review for a collected final run")
    s.add_argument("--run", required=True, help="Exact run_id from collect output/runs.jsonl")
    s.add_argument("--thread", help="Disambiguate a run ID")
    s.add_argument("--scorer", required=True)
    for field in RUBRIC:
        s.add_argument("--" + field.replace("_", "-"), type=int, choices=range(1, 6), required=True)
    s.add_argument("--notes", default="")
    s.set_defaults(func=score)
    r = sub.add_parser("report", help="Write a Markdown table and CSV from local evidence")
    r.add_argument("--prices", type=Path, default=TOOL_DIR / "prices.toml")
    r.add_argument("--unit", choices=("run", "thread"), default="thread", help="Thread (default) counts shared Antigravity conversations once; run keeps follow-ups separate")
    r.set_defaults(func=report)
    q = sub.add_parser("quota", help="Append quota observation(s) and rebuild empirical calibration ledger")
    q.add_argument("--manual", action="store_true")
    q.add_argument("--data-dir", type=Path, default=default_data_dir())
    q.add_argument("--thread", action="append")
    q.add_argument("--run")
    q.add_argument("--provider", required=True)
    q.add_argument("--model", required=True)
    q.add_argument("--quota-account", default="default", help="Non-secret account label, matching collect")
    q.add_argument("--window", choices=("5h", "weekly", "unknown"), default="5h")
    percents = q.add_mutually_exclusive_group()
    percents.add_argument("--used-percent", type=float)
    percents.add_argument("--remaining-percent", type=float)
    q.add_argument("--reset-at", help="Timezone-aware ISO reset timestamp")
    q.add_argument("--window-start", help="Observed/verified start; never inferred from a rolling reset")
    q.add_argument("--at", help="Actual historical observation time; manual only, never invented")
    q.add_argument("--event", choices=("snapshot", "limit_hit", "reset"), default="snapshot")
    q.add_argument("--phase", choices=("before", "after"))
    q.add_argument("--exclusive", action="store_true", help="Attest no uncollected/account-external usage or paid overage")
    q.add_argument("--complete-window", action="store_true", help="Attest ALL model/account usage collected from fresh reset to actual limit hit")
    q.add_argument("--note", default="")
    q.set_defaults(func=quota)
    for command in (c, r):
        for tag in ("experiment", "task", "variant"):
            command.add_argument("--" + tag)
    return cli


def main(argv=None):
    cli = parser()
    args = cli.parse_args(argv)
    if args.command == "collect" and not (args.thread or args.parent or args.title_contains):
        cli.error("collect requires --thread, --parent or --title-contains")
    try:
        args.func(args)
    except (ValueError, OSError, sqlite3.Error) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
