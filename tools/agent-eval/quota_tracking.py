"""Bounded, read-only quota discovery and conservative subscription accounting.

No provider RPCs, logs, credentials or configuration files are read here.
"""
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3


WINDOWS = {"5h": 300, "weekly": 10080}
MONTH_MINUTES = 30.4375 * 24 * 60  # Gregorian mean month, an explicit convention.


def timestamp(value):
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = datetime.fromtimestamp(value, timezone.utc).isoformat()
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Quota timestamps require a timezone")
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def snapshot(provider, model, observed_at, *, window="unknown", used_percent=None,
             remaining_percent=None, reset_at=None, window_start=None, source="manual",
             account="default", event="snapshot", thread_id=None, run_id=None,
             phase=None, exclusive=False, complete_window=False, note=""):
    if used_percent is not None and remaining_percent is not None:
        raise ValueError("Supply used OR remaining percent")
    if remaining_percent is not None:
        if not number(remaining_percent) or not 0 <= remaining_percent <= 100:
            raise ValueError("Quota percent must be finite and between 0 and 100")
        used_percent = 100 - remaining_percent
    if used_percent is not None and (not number(used_percent) or not 0 <= used_percent <= 100):
        raise ValueError("Quota percent must be finite and between 0 and 100")
    start, reset, observed = map(timestamp, (window_start, reset_at, observed_at))
    if start and reset and start >= reset:
        raise ValueError("Window start must precede reset")
    if complete_window and (event != "limit_hit" or not exclusive or not start or not reset):
        raise ValueError("--complete-window needs limit_hit, --exclusive, --window-start and --reset-at")
    if complete_window and not start <= observed <= reset:
        raise ValueError("A complete-window hit observation must fall within that window")
    if event == "limit_hit" and used_percent is not None and used_percent != 100:
        raise ValueError("A confirmed limit_hit must have 100% used (or omit an unavailable meter)")
    item = dict(provider=provider, model=model, account=account, observed_at=observed,
                window=window, window_minutes=WINDOWS.get(window),
                used_fraction=used_percent / 100 if used_percent is not None else None,
                remaining_fraction=1 - used_percent / 100 if used_percent is not None else None,
                reset_at=reset, window_start=start, source=source, event=event,
                thread_id=thread_id, run_id=run_id, phase=phase, exclusive=exclusive,
                complete_window=complete_window, note=note)
    item["snapshot_id"] = hashlib.sha256(json.dumps(item, sort_keys=True).encode()).hexdigest()
    return item


def normalize_signal(value, provider, model, stamp, source, tid, account="default", window="unknown"):
    """Only traverse an explicitly selected quota object; export whitelisted scalars."""
    result = []
    if isinstance(value, list):
        for item in value[:100]:
            result.extend(normalize_signal(item, provider, model, stamp, source, tid, account, window))
    elif isinstance(value, dict):
        minutes = value.get("windowDurationMins", value.get("window_duration_mins", value.get("window_duration_minutes")))
        window = next((k for k, v in WINDOWS.items() if v == minutes), window)
        used = value.get("usedPercent", value.get("used_percent"))
        used_fraction = value.get("usedFraction", value.get("used_fraction"))
        if used is None and number(used_fraction):
            used = used_fraction * 100
        remaining = value.get("remainingPercent", value.get("remaining_percent"))
        fraction = value.get("remainingFraction", value.get("remaining_fraction"))
        if remaining is None and number(fraction):
            remaining = fraction * 100
        if used is not None or remaining is not None:
            try:
                result.append(snapshot(provider, value.get("model", model), stamp,
                    window=window, used_percent=used, remaining_percent=remaining if used is None else None,
                    reset_at=value.get("resetsAt", value.get("resetTime", value.get("reset_at"))),
                    window_start=value.get("windowStart"), source=source, thread_id=tid, account=account))
            except (ValueError, OverflowError, TypeError):
                pass  # Unsupported formats remain unknown, never guessed.
        for key, child in value.items():
            if isinstance(child, (dict, list)):
                result.extend(normalize_signal(child, provider, model, stamp, source + "." + key,
                                              tid, account, window))
    return result


SIGNALS = ("$.rateLimits", "$.rate_limits", "$.quota", "$.quotaInfo", "$.usageLimits",
           "$.nativeMetadata.rateLimits", "$.nativeMetadata.quota", "$.nativeMetadata.quotaInfo")
ERROR_PATHS = ("$.error", "$.lastError", "$.errorInfo", "$.failure")


def discover(con, tid, provider, model, stamp, account="default", limit=2000):
    """Indexed thread queries; JSON projection excludes messages and tool content.

    Supports both event stores. A bounded result includes an explicit truncation flag.
    Current mutable projection values use collection time, never their old update time.
    """
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    result, flags, prompt_inputs = [], [], []
    extracts = ",".join("json_extract(payload_json, '" + p + "')" for p in SIGNALS + ERROR_PATHS)
    for suffix in ("provider_threads", "provider_sessions", "provider_turns"):
        table = "orchestration_v2_projection_" + suffix
        if table not in tables:
            continue
        for row in con.execute(f"SELECT {extracts} FROM {table} WHERE thread_id=? LIMIT ?", (tid, limit)):
            for path, raw in zip(SIGNALS, row[:len(SIGNALS)]):
                if isinstance(raw, str) and raw.lstrip().startswith(("{", "[")):
                    result.extend(normalize_signal(json.loads(raw), provider, model, stamp,
                                                  table + path, tid, account))
            result.extend(error_signals(row[len(SIGNALS):], provider, model, stamp, table, tid, account))
    if "provider_session_runtime" in tables:
        fields = extracts.replace("payload_json", "runtime_payload_json")
        for row in con.execute(f"SELECT {fields} FROM provider_session_runtime WHERE thread_id=? LIMIT 1", (tid,)):
            for path, raw in zip(SIGNALS, row[:len(SIGNALS)]):
                if isinstance(raw, str) and raw.lstrip().startswith(("{", "[")):
                    result.extend(normalize_signal(json.loads(raw), provider, model, stamp,
                                                  "provider_session_runtime" + path, tid, account))
            result.extend(error_signals(row[len(SIGNALS):], provider, model, stamp, "provider_session_runtime", tid, account))
    table = "orchestration_v2_projection_turn_items"
    if table in tables and "payload_json" in {r[1] for r in con.execute(f"PRAGMA table_info({table})")}:
        # Error-type rows only. SQL returns classification, never the raw message.
        checks = " || ' ' || ".join(f"coalesce(json_extract(payload_json,'{p}'),'')" for p in ERROR_PATHS + ("$.message",))
        for (classification,) in con.execute(
                f"SELECT CASE WHEN lower({checks}) LIKE '%usage_limit%' THEN 'usage_limit' "
                f"WHEN lower({checks}) LIKE '%resource%exhausted%' THEN 'resource_exhausted' "
                f"WHEN lower({checks}) LIKE '%quota%' THEN 'quota' END FROM {table} "
                "WHERE thread_id=? AND type='error' LIMIT ?", (tid, limit)):
            if classification:
                result.extend(error_signals([classification], provider, model, stamp, table, tid, account))
    for table in ("orchestration_events", "orchestration_v2_events"):
        if table not in tables:
            continue
        where = "aggregate_kind='thread' AND stream_id=?" if table == "orchestration_events" else "thread_id=?"
        # Only metadata/error events, never turn-item/message payloads.
        query = (f"SELECT event_id, occurred_at, event_type, {extracts}, "
                 "json_extract(payload_json,'$.tokenUsage.inputTokens') "
                 f"FROM {table} WHERE {where} AND (event_type IN "
                 "('provider-thread.updated','provider-session.updated','provider-turn.updated','run-attempt.updated') "
                 "OR event_type LIKE '%quota%' OR event_type LIKE '%limit%' OR event_type LIKE '%error%') "
                 "ORDER BY sequence DESC LIMIT ?")
        found = con.execute(query, (tid, limit + 1)).fetchall()
        if len(found) > limit:
            flags.append("quota_event_scan_truncated:" + table)
        for row in found[:limit]:
            eid, occurred, typ = row[:3]
            values = row[3:3 + len(SIGNALS)]
            for path, raw in zip(SIGNALS, values):
                if isinstance(raw, str) and raw.lstrip().startswith(("{", "[")):
                    result.extend(normalize_signal(json.loads(raw), provider, model, occurred,
                                                  table + ":" + eid + path, tid, account))
            result.extend(error_signals(row[3 + len(SIGNALS):-1], provider, model, occurred,
                                        table + ":" + eid, tid, account, typ))
            if number(row[-1]) and row[-1] >= 0:
                prompt_inputs.append(row[-1])
    if not result:
        flags.append("quota_signal_unavailable_in_scoped_state")
    maximum = None if any("scan_truncated" in f for f in flags) else max(prompt_inputs, default=None)
    return result, flags, maximum


def error_signals(values, provider, model, stamp, source, tid, account, event_type=""):
    text = " ".join(str(v).lower() for v in values if v) + " " + event_type.lower()
    if "reset" in event_type.lower() and any(k in event_type.lower() for k in ("quota", "limit")):
        return [snapshot(provider, model, stamp, source=source, account=account,
                         thread_id=tid, event="reset", note="Observed quota reset event; window unclassified")]
    matched = next((s for s in ("usage_limit", "resource_exhausted", "resource exhausted", "quota", "rate_limit") if s in text), None)
    if not matched:
        return []
    # A generic quota/rate error may be transient RPM or service capacity, not plan exhaustion.
    return [snapshot(provider, model, stamp, source=source, account=account,
                     thread_id=tid, event="limit_candidate", note="error classifier: " + matched)]


def conversation_errors(data_dir, conversations, provider, model, stamp, tid, account="default"):
    """Only mapped UUID DBs, only bounded error_details; no configs/step payloads."""
    root = Path(data_dir).expanduser().resolve()
    result = []
    for conversation in conversations:
        relative = Path(conversation["relative_path"])
        parts = relative.parts
        if (len(parts) != 6 or parts[:2] != ("providers", "antigravity")
                or parts[3:5] != ("antigravity-acp", "conversations")
                or not re.fullmatch(r"[0-9a-fA-F-]{36}\.db", parts[5])):
            continue
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            continue
        con = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)
        try:
            con.execute("PRAGMA query_only=ON")
            columns = {r[1] for r in con.execute("PRAGMA table_info(steps)")}
            if not {"idx", "error_details"} <= columns:
                continue
            for idx, raw in con.execute("SELECT idx,substr(error_details,1,8192) FROM steps WHERE error_details IS NOT NULL ORDER BY idx DESC LIMIT 100"):
                text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
                result.extend(error_signals([text], provider, model, stamp,
                    "mapped Antigravity steps.error_details:" + relative.as_posix() + ":" + str(idx), tid, account))
        finally:
            con.close()
    return result


def total_tokens(run):
    tokens = run["tokens"]
    return tokens["input"] + tokens["output"] if all(number(tokens.get(k)) for k in ("input", "output")) else None


def overlaps(run, runs):
    return any(r["thread_id"] != run["thread_id"] and r["provider"] == run["provider"]
               and r.get("quota_account", "default") == run.get("quota_account", "default")
               and timestamp(r["requested_at"]) < (timestamp(run.get("completed_at")) or "9999")
               and timestamp(run["requested_at"]) < (timestamp(r.get("completed_at")) or "9999") for r in runs)


def ledger(runs, snapshots):
    """Runs must already be deduplicated THREAD units (shared conversations count once)."""
    runs = [{**r, **{k: timestamp(r.get(k)) for k in ("requested_at", "completed_at", "collected_at")}} for r in runs]
    groups = defaultdict(list)
    for s in snapshots:
        groups[(s["provider"], s["model"], s.get("account", "default"), s["window"], s.get("reset_at"))].append(s)
    # Unknown windows cannot be assigned a synthetic rolling/fixed boundary.
    for run in runs:
        key = (run["provider"], run["model"], run.get("quota_account", "default"), "unassigned", None)
        groups.setdefault(key, [])
    result = []
    for (provider, model, account, window, reset), observations in sorted(groups.items(), key=lambda pair: str(pair[0])):
        starts = {s["window_start"] for s in observations if s.get("window_start")}
        start = next(iter(starts)) if len(starts) == 1 else None
        members = [r for r in runs if r["provider"] == provider and r["model"] == model
                   and r.get("quota_account", "default") == account
                   and (window == "unassigned" or (start and reset and r["requested_at"] >= start
                        and (r.get("completed_at") or r.get("collected_at"))
                        and (r.get("completed_at") or r["collected_at"]) <= reset))]
        observed = sum(total_tokens(r) or 0 for r in members)
        complete = all(r["is_final"] and r["cumulative_usage_status"].startswith("complete")
                       and total_tokens(r) is not None and not any(f in r["flags"] for f in
                       ("usage_has_subagents", "mixed_run_configuration", "mixed_models", "unmapped_thread_turns",
                        "antigravity_mapping_heuristic_verify_manually")) for r in members)
        safe_bound = not any(any(f in r["flags"] for f in
                         ("usage_has_subagents", "usage_scope_not_main_agent", "mixed_models",
                          "cached_input_exceeds_input", "antigravity_mapping_heuristic_verify_manually")) for r in members)
        hits = [s for s in observations if s["event"] == "limit_hit" and s.get("complete_window")]
        hit = max(hits, key=lambda s: s["observed_at"], default=None)
        # No runs after a hit; no runs straddling boundaries; no other model sharing the pool.
        foreign = any(r["provider"] == provider and r.get("quota_account", "default") == account
                      and start and reset and r["requested_at"] < reset
                      and (r.get("completed_at") or "9999") > start
                      and (r["model"] != model or r not in members) for r in runs)
        configs = {json.dumps(r["options"], sort_keys=True) for r in members}
        calibrated = bool(hit and members and observed > 0 and complete and not foreign and len(configs) == 1
                          and all(r["completed_at"] <= hit["observed_at"] for r in members))
        result.append(dict(provider=provider, model=model, account=account, window=window,
            window_start=start, reset_at=reset, tokens_observed=observed,
            capacity_lower_bound_tokens=observed if start and reset and observed and safe_bound else None,
            capacity_tokens=observed if calibrated else None,
            options=json.loads(next(iter(configs))) if len(configs) == 1 else None,
            status="calibrated (empirical workload)" if calibrated else "uncalibrated",
            all_collected_tokens_only=window == "unassigned",
            run_ids=[r["run_id"] for r in members],
            events=[s for s in observations if s["event"] != "snapshot"],
            snapshot_ids=[s["snapshot_id"] for s in observations],
            assumptions="complete-window/exclusive attestation; input+output, cached included once; workload-specific; no paid overage"))
    return result


def subscription(run, all_runs, snapshots, capacities, plans):
    """Maximum normalised window depletion, never add concurrent constraint prices."""
    run = {**run, "requested_at": timestamp(run["requested_at"]), "completed_at": timestamp(run.get("completed_at"))}
    plan = plans.get(run["provider"], {})
    price = plan.get("monthly_usd")
    result = dict(cost=None, status="uncalibrated: missing quota/window evidence", deltas=[],
                  capacity_lower_bounds={}, upper_bound=None)
    known_price = number(price) and price > 0
    if not known_price:
        price = 1  # Compute raw deltas regardless of plan selection; never export this cost.
    if not run["is_final"]:
        result["status"] = "uncalibrated: run not final"
        return result
    if overlaps(run, all_runs):
        result["status"] = "uncalibrated: concurrent provider runs share quota"
        return result
    account = run.get("quota_account", "default")
    candidates = [s for s in snapshots if s["provider"] == run["provider"]
                  and s["model"] in (run["model"], "*") and s.get("account", "default") == account]
    costs, bounds = [], []
    windows = plan.get("windows", ["5h", "weekly"])
    for window in windows:
        if window not in WINDOWS:
            result["status"] = "uncalibrated: unsupported model-specific window"
            return result
        before = [s for s in candidates if s["window"] == window and s.get("thread_id") == run["thread_id"]
                  and s.get("run_id") in (None, run["run_id"]) and s.get("phase") == "before"
                  and s["observed_at"] <= run["requested_at"]]
        after = [s for s in candidates if s["window"] == window and s.get("thread_id") == run["thread_id"]
                 and s.get("run_id") in (None, run["run_id"]) and s.get("phase") == "after"
                 and s["observed_at"] >= run["completed_at"]]
        b = max(before, key=lambda s: s["observed_at"], default=None)
        a = min(after, key=lambda s: s["observed_at"], default=None)
        if (b and a and a.get("exclusive") and b.get("exclusive") and b.get("reset_at")
                and b["reset_at"] == a.get("reset_at") and a["observed_at"] < a["reset_at"]
                and number(a["used_fraction"]) and number(b["used_fraction"])
                and a["used_fraction"] >= b["used_fraction"]
                and (datetime.fromisoformat(run["requested_at"].replace("Z", "+00:00")) -
                     datetime.fromisoformat(b["observed_at"].replace("Z", "+00:00"))).total_seconds() <= 300
                and (datetime.fromisoformat(a["observed_at"].replace("Z", "+00:00")) -
                     datetime.fromisoformat(run["completed_at"].replace("Z", "+00:00"))).total_seconds() <= 300):
            delta = a["used_fraction"] - b["used_fraction"]
            result["deltas"].append(dict(window=window, used_fraction_delta=delta,
                                          before=b["snapshot_id"], after=a["snapshot_id"]))
            costs.append(delta * price * WINDOWS[window] / MONTH_MINUTES)
            continue
        entries = [c for c in capacities if c["provider"] == run["provider"] and c["model"] == run["model"]
                   and c["account"] == account and c["window"] == window and c.get("options") == run["options"]
                   and (not plan.get("calibration_since") or c["reset_at"] >= timestamp(plan["calibration_since"]))]
        lowers = [c["capacity_lower_bound_tokens"] for c in entries if c["capacity_lower_bound_tokens"]]
        if lowers:
            result["capacity_lower_bounds"][window] = max(lowers)
        calibrated = [c for c in entries if c["capacity_tokens"]]
        tokens = total_tokens(run)
        if tokens is not None and run["cumulative_usage_status"].startswith("complete"):
            if calibrated:
                # Latest measurement, avoiding cherry-picking the largest capacity.
                cap = max(calibrated, key=lambda c: c["reset_at"])["capacity_tokens"]
                costs.append(tokens * price * WINDOWS[window] / (MONTH_MINUTES * cap))
            elif lowers:
                bounds.append(tokens * price * WINDOWS[window] / (MONTH_MINUTES * max(lowers)))
    if len(costs) == len(windows):
        result.update(cost=max(costs), status="estimated: " + ("quota delta" if len(result["deltas"]) == len(windows) else "empirical workload calibration"))
    elif len(costs) + len(bounds) == len(windows):
        result["upper_bound"] = max(costs + bounds)
    if not known_price:
        result.update(cost=None, upper_bound=None, status="uncalibrated: select/verify subscription plan price")
    return result
