"""Tiny synthetic SQLite fixture; never opens the real T3 database."""
from contextlib import closing, redirect_stdout
from datetime import datetime, timezone
import csv
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import agent_eval as ae
import antigravity_usage as ag
import quota_tracking as qt


def proto_varint(value):
    data = bytearray()
    while value > 127:
        data.append((value & 127) | 128)
        value >>= 7
    return bytes(data) + bytes([value])


def proto_message(number, value):
    return proto_varint(number * 8 + 2) + proto_varint(len(value)) + value


class AgentEvalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fixture-", dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / "userdata"
        self.data.mkdir()
        self.evidence = self.root / "evidence"
        self.patch = patch.object(ae, "EVIDENCE", self.evidence)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        con = sqlite3.connect(self.data / "statev2.sqlite")
        self.addCleanup(con.close)
        self.writer = con
        con.execute("PRAGMA synchronous=OFF")  # Disposable synthetic fixture only.
        schemas = {
            "threads": "thread_id TEXT PRIMARY KEY,project_id,title,default_provider,created_at,updated_at,payload_json",
            "runs": "run_id TEXT PRIMARY KEY,thread_id,ordinal INTEGER,provider,provider_thread_id,status,requested_at,completed_at,payload_json,provider_instance_id",
            "run_attempts": "attempt_id TEXT PRIMARY KEY,thread_id,run_id,root_node_id",
            "provider_turns": "provider_turn_id TEXT PRIMARY KEY,thread_id,provider_thread_id,node_id,run_attempt_id,ordinal INTEGER,status,started_at,completed_at,payload_json",
            "provider_threads": "provider_thread_id TEXT PRIMARY KEY,thread_id,updated_at,payload_json",
            "provider_sessions": "provider_session_id TEXT PRIMARY KEY,thread_id,payload_json",
            "turn_items": "turn_item_id TEXT PRIMARY KEY,thread_id,run_id,type",
            "nodes": "node_id TEXT PRIMARY KEY,thread_id,run_id",
            "subagents": "subagent_id TEXT PRIMARY KEY,thread_id,child_thread_id",
        }
        for name, columns in schemas.items():
            con.execute(f"CREATE TABLE {ae.PREFIX}{name} ({columns})")
            con.execute(f"CREATE INDEX {name}_tid ON {ae.PREFIX}{name}(thread_id)")
        con.execute(f"CREATE INDEX child_tid ON {ae.PREFIX}subagents(child_thread_id)")
        con.execute("CREATE TABLE projection_threads(thread_id TEXT PRIMARY KEY,model_selection_json)")
        self.selection = {"model": "fixture-sol", "options": [{"id": "reasoningEffort", "value": "xhigh"}, {"id": "serviceTier", "value": "priority"}]}
        for tid, provider in (("sol", "codex"), ("gem", "antigravity")):
            selection = self.selection if tid == "sol" else {"model": "fixture-gem"}
            meta = {"modelSelection": selection, "lineage": {"parentThreadId": "parent", "relationshipToParent": "subagent"}}
            self.insert("threads", (tid, "project", "Paired " + tid, provider, "2026-11-14T10:00:00Z", "2026-11-14T10:01:00Z", json.dumps(meta)))
            run = {"modelSelection": selection, "rootNodeId": "node-" + tid, "startedAt": "2026-11-14T10:00:01Z"}
            self.insert("runs", ("r-" + tid, tid, 1, provider, "pt-" + tid, "completed" if tid == "sol" else "running", "2026-11-14T10:00:00Z", "2026-11-14T10:01:00Z" if tid == "sol" else None, json.dumps(run), provider))
            self.insert("run_attempts", ("a-" + tid, tid, "r-" + tid, "node-" + tid))
            self.insert("subagents", ("s-" + tid, "parent", tid))
        usage = {"usageScope": "main_agent", "hasSubagents": False, "usageStatus": "complete", "models": ["fixture-sol"], "inputTokens": 1000, "cachedInputTokens": 900, "outputTokens": 100, "reasoningTokens": 30, "cacheCreationTokens": 0}
        for i in (1, 2):
            p = {"turnTokenUsage": usage, "tokenUsage": {"usedTokens": 120 + i, "maxTokens": 200}, "model": "fixture-sol"}
            self.insert("provider_turns", ("t-sol-" + str(i), "sol", "pt-sol", "node-sol", "a-sol", i, "completed", f"2026-11-14T10:00:{i}0Z", f"2026-11-14T10:00:{i}9Z", json.dumps(p)))
        self.insert("provider_turns", ("t-gem", "gem", "pt-gem", "node-gem", "a-gem", 1, "running", "2026-11-14T10:00:02Z", None, json.dumps({"turnTokenUsage": {"usageScope": "main_agent", "hasSubagents": False, "usageStatus": "unavailable"}, "tokenUsage": None})))
        for tid, context in (("sol", None), ("gem", {"usedTokens": 189134, "maxTokens": 1048576})):
            self.insert("provider_threads", ("pt-" + tid, tid, "2026-11-14T10:01:00Z", json.dumps({"contextUsage": context})))
        for i in range(3):
            self.insert("turn_items", (str(i), "sol", "r-sol", "command_execution" if i < 2 else "reasoning"))
        con.commit()
        self.tags = {"experiment": "paired", "task": "one", "variant": "fast"}

    def insert(self, table, values):
        self.writer.execute(f"INSERT INTO {ae.PREFIX}{table} VALUES ({','.join('?' for _ in values)})", values)

    def records(self, tid="sol", stamp="2026-11-14T10:02:00Z"):
        with ae.read_db(self.data) as con:
            return ae.thread_records(con, tid, self.tags, stamp, self.data)

    def test_read_only_and_missing_db(self):
        with ae.read_db(self.data) as con:
            with self.assertRaises(sqlite3.OperationalError):
                con.execute(f"DELETE FROM {ae.PREFIX}runs")
        with self.assertRaises(ValueError):
            with ae.read_db(self.root / "missing"):
                pass
        self.assertFalse((self.root / "missing").exists())

    def test_live_wal_visible(self):
        self.writer.execute("PRAGMA journal_mode=WAL")
        self.writer.execute(f"UPDATE {ae.PREFIX}threads SET title='WAL title' WHERE thread_id='sol'")
        self.writer.commit()
        self.assertEqual(self.records()[0]["title"], "WAL title")

    def test_cumulative_turn_totals_not_context_meter(self):
        r = self.records()[0]
        self.assertEqual(r["tokens"], {"input": 2000, "cached_input": 1800, "uncached_input": 200, "output": 200, "reasoning": 60, "cache_creation": 0})
        self.assertEqual(r["context_used_tokens"], 122)
        self.assertEqual(r["turn_usage"][0]["context_usage"]["used_tokens"], 121)
        self.assertEqual(r["context_source"], "provider_turn.tokenUsage")
        self.assertEqual(r["wall_seconds"], 60)
        self.assertEqual(r["execution_seconds"], 59)
        self.assertEqual(r["item_counts"]["command_execution"], 2)
        self.assertEqual(r["options"]["serviceTier"], "priority")
        self.assertEqual(r["parent_thread_id"], "parent")

    def test_gemini_context_and_unknown_totals(self):
        r = self.records("gem")[0]
        self.assertEqual(r["context_used_tokens"], 189134)
        self.assertEqual(r["context_max_tokens"], 1048576)
        self.assertEqual(r["context_source"], "provider_thread.contextUsage")
        self.assertEqual(r["cumulative_usage_status"], "unavailable from T3")
        self.assertTrue(all(v is None for v in r["tokens"].values()))
        self.assertIsNone(r["wall_seconds"])
        self.assertEqual(r["elapsed_seconds"], 120)
        self.assertIsNone(ae.estimate_cost(r, {}))

    def test_selectors_literal_and_recursive(self):
        self.insert("subagents", ("nested", "sol", "grandchild"))
        self.writer.commit()
        with ae.read_db(self.data) as con:
            args = ae.parser().parse_args(["collect", "--parent", "parent"])
            self.assertEqual(ae.select_threads(con, args), ["gem", "sol"])
            args.recursive = True
            self.assertEqual(ae.select_threads(con, args), ["gem", "grandchild", "sol"])
            args = ae.parser().parse_args(["collect", "--title-contains", "PAIRED sol", "--thread", "gem"])
            self.assertEqual(ae.select_threads(con, args), ["gem", "sol"])
            args = ae.parser().parse_args(["collect", "--title-contains", "%"])
            with self.assertRaises(ValueError):
                ae.select_threads(con, args)

    def test_dedup_and_latest_snapshot(self):
        one = self.records()
        two = self.records(stamp="2026-11-14T10:03:00Z")
        path = self.evidence / "runs.jsonl"
        self.assertEqual(ae.append_unique(path, one, "snapshot_id"), 1)
        self.assertEqual(ae.append_unique(path, two, "snapshot_id"), 0)
        first = self.records("gem")
        later = self.records("gem", stamp="2026-11-14T10:03:00Z")
        self.assertEqual(first[0]["snapshot_id"], later[0]["snapshot_id"])
        self.writer.execute(f"UPDATE {ae.PREFIX}runs SET status='completed',completed_at='2026-11-14T10:04:00Z' WHERE thread_id='gem'")
        self.writer.commit()
        final = self.records("gem")
        self.assertNotEqual(first[0]["snapshot_id"], final[0]["snapshot_id"])
        self.assertEqual(len(ae.latest_records(first + final)), 1)

    def test_changed_record_can_revert_to_previous_content(self):
        path = self.evidence / "scores.jsonl"
        base = {"thread_id": "sol", "run_id": "r-sol", "scorer": "fixture", "score_id": "first"}
        changed = {**base, "score_id": "second"}
        self.assertEqual(ae.append_unique(path, [base], "score_id"), 1)
        self.assertEqual(ae.append_unique(path, [changed], "score_id"), 1)
        self.assertEqual(ae.append_unique(path, [base], "score_id"), 1)
        self.assertEqual(ae.read_jsonl(path)[-1]["score_id"], "first")

    def test_cost_pricing_no_double_count_and_tier(self):
        r = self.records()[0]
        rates = {"input_per_million": 2, "cached_input_per_million": 0.2, "output_per_million": 10}
        rates["tiers"] = {"priority": dict(rates)}
        prices = {"models": {"fixture-sol": rates}}
        self.assertAlmostEqual(ae.estimate_cost(r, prices), 0.00276)
        self.assertIsNone(ae.estimate_cost(r, {}))
        rates["tiers"] = {"priority": {"input_per_million": ""}}
        self.assertIsNone(ae.estimate_cost(r, prices))
        del rates["tiers"]
        r["tokens"]["cache_creation"] = 1
        self.assertIsNone(ae.estimate_cost(r, prices))

    def test_partial_missing_cache_is_not_zero(self):
        payload = {"turnTokenUsage": {"usageScope": "main_agent", "usageStatus": "complete", "inputTokens": 50, "outputTokens": 10}}
        self.writer.execute(f"UPDATE {ae.PREFIX}provider_turns SET payload_json=? WHERE provider_turn_id='t-sol-2'", (json.dumps(payload),))
        self.writer.commit()
        r = self.records()[0]
        self.assertEqual(r["tokens"]["input"], 1050)
        self.assertEqual(r["tokens"]["cached_input"], 900)
        self.assertEqual(r["token_coverage"]["cached_input"], 1)
        self.assertEqual(r["cumulative_usage_status"], "partial")
        self.assertIsNone(ae.estimate_cost(r, {"models": {"fixture-sol": {"input_per_million": 1, "cached_input_per_million": 1, "output_per_million": 1}}}))

    def test_provider_context_not_misattributed_to_earlier_run(self):
        self.insert("runs", ("r-gem2", "gem", 2, "antigravity", "pt-gem", "running", "2026-11-14T10:02:00Z", None, json.dumps({"modelSelection": {"model": "fixture-gem"}}), "antigravity"))
        self.writer.commit()
        old, new = self.records("gem")
        self.assertIsNone(old["context_used_tokens"])
        self.assertFalse(old["provider_thread_contexts"][0]["belongs_to_latest_run"])
        self.assertEqual(new["context_used_tokens"], 189134)

    def test_manual_columns_preserved_and_report_quality(self):
        r = self.records()[0]
        ae.seed_manual([r])
        path = self.evidence / "manual_usage.csv"
        manual = {**{k: "" for k in ae.MANUAL_COLUMNS}, "thread_id": "sol", "run_id": "r-sol", "dashboard_total_tokens": "2222", "dashboard_cost": "0.01", "dashboard_currency": "USD", "source": "dashboard"}
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=ae.MANUAL_COLUMNS)
            writer.writeheader()
            writer.writerow(manual)
        before = path.read_bytes()
        ae.seed_manual([r])
        self.assertEqual(path.read_bytes(), before)
        scores = [{"thread_id": "sol", "run_id": "r-sol", "scorer": scorer, "rubric": dict.fromkeys(ae.RUBRIC, value)} for scorer, value in (("a", 1), ("a", 5), ("b", 3))]
        result = ae.summarize([r], scores, {}, ae.manual_usage(path))[0]
        self.assertEqual(result["quality_mean"], 4)
        self.assertEqual(result["dashboard_total_tokens_mean"], 2222)
        self.assertEqual(result["dashboard_cost_mean"], 0.01)
        self.assertIsNone(result["cost_mean"])

    def test_cli_collect_score_report_fixture_only(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(ae.main(["collect", "--data-dir", str(self.data), "--parent", "parent", "--experiment", "paired"]), 0)
            command = ["score", "--run", "r-sol", "--scorer", "fixture"]
            for field in ae.RUBRIC:
                command += ["--" + field.replace("_", "-"), "4"]
            self.assertEqual(ae.main(command), 0)
            self.assertEqual(ae.main(command), 0)
            with patch.object(ae, "WORKSPACE", self.root):
                self.assertEqual(ae.main(["report", "--experiment", "paired"]), 0)
        self.assertEqual(len(ae.read_jsonl(self.evidence / "scores.jsonl")), 1)
        files = list((self.evidence / "reports").glob("*.csv"))
        self.assertEqual(len(files), 1)
        with files[0].open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 3)  # Two variants plus contestant TOTAL.
        gem = next(r for r in rows if r["model"] == "fixture-gem")
        self.assertEqual(gem["cost_status"], "unavailable from T3")
        self.assertEqual(gem["input_mean"], "n/a")

    def conversation(self, malformed=False):
        uuid = "00000000-0000-4000-8000-000000000001"
        directory = self.data / "providers" / "antigravity" / "fixture" / "antigravity-acp" / "conversations"
        directory.mkdir(parents=True)
        path = directory / (uuid + ".db")
        with closing(sqlite3.connect(path)) as con:
            con.execute("CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB,size INTEGER)")
            usage = b"".join(proto_varint(k * 8) + proto_varint(v) for k, v in ((2, 6559), (5, 228164), (3, 5750), (9, 3625), (10, 2125)))
            blob = proto_message(1, proto_message(4, usage)) + proto_message(20, b"gemini-4-hydrogen-high")
            con.execute("INSERT INTO gen_metadata VALUES(0,?,?)", (blob, len(blob)))
            if malformed:
                con.execute("INSERT INTO gen_metadata VALUES(1,?,1)", (b"\x0a",))
            con.commit()
        payload = json.dumps({"nativeThreadRef": {"nativeId": uuid}, "contextUsage": {"usedTokens": 189134, "maxTokens": 1048576}})
        self.writer.execute(f"UPDATE {ae.PREFIX}provider_threads SET payload_json=? WHERE thread_id='gem'", (payload,))
        self.writer.execute(f"UPDATE {ae.PREFIX}runs SET status='completed',completed_at='2026-11-14T10:01:00Z' WHERE thread_id='gem'")
        self.writer.commit()
        return path

    def test_antigravity_uuid_decoder_and_cost(self):
        path = self.conversation()
        before = path.read_bytes()
        r = self.records("gem")[0]
        self.assertEqual(r["usage_source"], "antigravity_gen_metadata")
        self.assertEqual(r["generation_count"], 1)
        self.assertEqual(r["tokens"]["input"], 234723)
        self.assertEqual(r["tokens"]["uncached_input"], 6559)
        self.assertEqual(r["tokens"]["cached_input"], 228164)
        self.assertEqual(r["tokens"]["output"], 5750)
        self.assertEqual(r["tokens"]["reasoning"], 3625)
        self.assertEqual(r["antigravity_conversations"][0]["mapping"], "native_uuid")
        rates = {"models": {"fixture-gem": {"input_per_million": 1, "cached_input_per_million": 0.1, "output_per_million": 5}}}
        self.assertAlmostEqual(ae.estimate_cost(r, rates), (6559 + 22816.4 + 28750) / 1000000)
        self.assertEqual(path.read_bytes(), before)

    def test_antigravity_malformed_generation_is_partial(self):
        self.conversation(malformed=True)
        r = self.records("gem")[0]
        self.assertEqual(r["generation_count"], 2)
        self.assertEqual(r["cumulative_usage_status"], "partial (experimental)")
        self.assertIn("truncated protobuf varint", r["antigravity_conversations"][0]["errors"][0]["error"])
        self.assertIsNone(ae.estimate_cost(r, {}))

    def test_antigravity_absent_scalar_defaults_and_truncated_fields(self):
        usage = proto_varint(2 * 8) + proto_varint(9) + proto_varint(3 * 8) + proto_varint(4)
        decoded = ag.decode_generation(proto_message(1, proto_message(4, usage)))
        self.assertEqual(decoded["cached_input"], 0)
        self.assertEqual(decoded["input"], 9)
        with self.assertRaisesRegex(ValueError, "truncated protobuf field"):
            list(ag.fields(b"\x0a\x05x"))

    def test_antigravity_fallback_unique_then_ambiguous(self):
        path = self.conversation()
        path.with_suffix(".meta").write_text(json.dumps({"cwd": "fixture-cwd"}), encoding="utf-8")
        stamp = datetime.now(timezone.utc).isoformat()
        results, flags = ag.conversation_usage(self.data, [], [], [{"cwd": "fixture-cwd"}], stamp, stamp)
        if not hasattr(path.stat(), "st_birthtime") and ag.os.name != "nt":
            self.assertFalse(results)
            return
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["mapping"], "cwd_birth_time_heuristic")
        self.assertIn("antigravity_mapping_heuristic_verify_manually", flags)
        other = path.with_name("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.db")
        other.touch()
        other.with_suffix(".meta").write_text(json.dumps({"cwd": "fixture-cwd"}), encoding="utf-8")
        results, flags = ag.conversation_usage(self.data, [], [], [{"cwd": "fixture-cwd"}], stamp, stamp)
        self.assertFalse(results)
        self.assertIn("antigravity_mapping_ambiguous", flags)

    def test_antigravity_shared_conversation_not_double_counted(self):
        self.conversation()
        self.insert("runs", ("r-gem2", "gem", 2, "antigravity", "pt-gem", "running", "2026-11-14T10:02:00Z", None, json.dumps({"modelSelection": {"model": "fixture-gem"}}), "antigravity"))
        self.writer.commit()
        for r in self.records("gem"):
            self.assertIn("antigravity_conversation_shared_multiple_runs", r["flags"])
            self.assertNotEqual(r["usage_source"], "antigravity_gen_metadata")
            self.assertIsNone(r["tokens"]["input"])
        summary = ae.thread_metrics(self.records("gem"))[0]
        self.assertEqual(summary["generation_count"], 1)
        self.assertEqual(summary["tokens"]["output"], 5750)
        self.assertEqual(summary["tokens"]["input"], 234723)
        self.assertEqual(summary["run_count"], 2)
        self.assertNotIn("antigravity_conversation_shared_multiple_runs", summary["flags"])

    def test_partial_generation_observed_metrics_and_cost_are_separate(self):
        self.conversation(malformed=True)
        run = self.records("gem")[0]
        rates = {"models": {"fixture-gem": {"input_per_million": 1, "cached_input_per_million": 0.1, "output_per_million": 5}}}
        self.assertIsNone(ae.estimate_cost(run, rates))
        self.assertIsNotNone(ae.estimate_cost(run, rates, allow_partial=True))
        row = ae.summarize([run], [], rates)[0]
        self.assertEqual(row["input_observed_mean"], 234723)
        self.assertIsNone(row["input_mean"])
        self.assertIsNone(row["cost_mean"])
        self.assertIsNotNone(row["observed_cost_mean"])

    def quota_pair(self, window, used_after=20, reset="2026-11-15T00:00:00Z"):
        common = dict(window=window, reset_at=reset, thread_id="sol", exclusive=True)
        return [qt.snapshot("codex", "fixture-sol", "2026-11-14T09:59:59Z", used_percent=10, phase="before", **common),
                qt.snapshot("codex", "fixture-sol", "2026-11-14T10:01:01Z", used_percent=used_after, phase="after", **common)]

    def test_subscription_binding_window_not_sum_or_reasoning_double_count(self):
        r = self.records()[0]
        samples = self.quota_pair("5h") + self.quota_pair("weekly")
        plans = {"codex": {"monthly_usd": 20, "windows": ["5h", "weekly"]}}
        result = qt.subscription(r, [r], samples, [], plans)
        self.assertAlmostEqual(result["cost"], .1 * 20 * 10080 / qt.MONTH_MINUTES)
        self.assertEqual(len(result["deltas"]), 2)
        self.assertEqual(qt.total_tokens(r), 2200)  # Cached/reasoning already included.

    def test_subscription_rejects_missing_window_reset_rollback_overlap_and_external_usage(self):
        r = self.records()[0]
        plans = {"codex": {"monthly_usd": 20, "windows": ["weekly"]}}
        for samples in ([], self.quota_pair("weekly", 5)):
            self.assertIsNone(qt.subscription(r, [r], samples, [], plans)["cost"])
        samples = self.quota_pair("weekly")
        samples[1]["reset_at"] = "2026-11-16T00:00:00Z"
        self.assertIsNone(qt.subscription(r, [r], samples, [], plans)["cost"])
        samples = self.quota_pair("weekly")
        samples[1]["exclusive"] = False
        self.assertIsNone(qt.subscription(r, [r], samples, [], plans)["cost"])
        other = {**r, "thread_id": "parallel", "model": "other-model"}
        result = qt.subscription(r, [r, other], self.quota_pair("weekly"), [], plans)
        self.assertIsNone(result["cost"])
        self.assertIn("concurrent", result["status"])
        missing_week = {"codex": {"monthly_usd": 20, "windows": ["5h", "weekly"]}}
        self.assertIsNone(qt.subscription(r, [r], self.quota_pair("5h"), [], missing_week)["cost"])

    def test_quota_calibration_requires_actual_complete_window_hit(self):
        r = self.records()[0]
        common = dict(window="weekly", window_start="2026-11-14T09:00:00Z", reset_at="2026-11-21T09:00:00Z")
        observed = qt.snapshot("codex", "fixture-sol", "2026-11-14T10:02:00Z", **common)
        ledger = qt.ledger([r], [observed])
        entry = next(c for c in ledger if c["window"] == "weekly")
        self.assertIsNone(entry["capacity_tokens"])
        self.assertEqual(entry["capacity_lower_bound_tokens"], 2200)
        plans = {"codex": {"monthly_usd": 20, "windows": ["weekly"]}}
        cost = qt.subscription(r, [r], [], ledger, plans)
        self.assertIsNone(cost["cost"])
        self.assertAlmostEqual(cost["upper_bound"], 20 * 10080 / qt.MONTH_MINUTES)
        hit = qt.snapshot("codex", "fixture-sol", "2026-11-14T10:02:00Z", event="limit_hit",
                          exclusive=True, complete_window=True, **common)
        ledger = qt.ledger([r], [observed, hit])
        entry = next(c for c in ledger if c["window"] == "weekly")
        self.assertEqual(entry["capacity_tokens"], 2200)
        self.assertEqual(len(entry["events"]), 1)
        self.assertAlmostEqual(qt.subscription(r, [r], [], ledger, plans)["cost"], 20 * 10080 / qt.MONTH_MINUTES)
        changed_plan = {"codex": {**plans["codex"], "calibration_since": "2026-11-22T00:00:00Z"}}
        self.assertIsNone(qt.subscription(r, [r], [], ledger, changed_plan)["cost"])
        partial = {**r, "cumulative_usage_status": "partial"}
        self.assertIsNone(next(c for c in qt.ledger([partial], [hit]) if c["window"] == "weekly")["capacity_tokens"])
        foreign = {**r, "thread_id": "other", "model": "another"}
        self.assertIsNone(next(c for c in qt.ledger([r, foreign], [hit]) if c["model"] == r["model"] and c["window"] == "weekly")["capacity_tokens"])

    def test_quota_unknown_windows_never_create_capacity(self):
        r = self.records()[0]
        result = qt.ledger([r], [])
        self.assertEqual(result[0]["tokens_observed"], 2200)
        self.assertIsNone(result[0]["capacity_lower_bound_tokens"])
        self.assertIsNone(result[0]["capacity_tokens"])

    def test_quota_snapshot_validation_and_normalization(self):
        for value in (-1, 101, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                qt.snapshot("p", "m", "2026-11-14T10:00:00Z", used_percent=value)
        with self.assertRaises(ValueError):
            qt.snapshot("p", "m", "2026-11-14T10:00:00")
        with self.assertRaises(ValueError):
            qt.snapshot("p", "m", "2026-11-14T10:00:00Z", complete_window=True)
        samples = qt.normalize_signal({"primary": {"usedPercent": 25, "windowDurationMins": 300,
                       "resetsAt": 1794654000}, "secondary": {"remainingFraction": .5, "windowDurationMins": 10080}},
                       "codex", "fixture-sol", "2026-11-14T10:00:00Z", "fixture", "sol")
        self.assertEqual([s["window"] for s in samples], ["5h", "weekly"])
        self.assertEqual([s["used_fraction"] for s in samples], [.25, .5])

    def test_scoped_quota_discovery_excludes_raw_text_and_classifies_errors(self):
        self.writer.execute("CREATE TABLE orchestration_events(sequence INTEGER PRIMARY KEY,event_id,aggregate_kind,stream_id,event_type,occurred_at,payload_json)")
        self.writer.execute("CREATE INDEX event_scope ON orchestration_events(aggregate_kind,stream_id,sequence)")
        for seq, tid, typ, payload in [
            (1, "sol", "provider-turn.updated", {"rateLimits": {"primary": {"usedPercent": 5, "windowDurationMins": 300}}, "tokenUsage": {"inputTokens": 123}}),
            (2, "sol", "provider-session.updated", {"lastError": {"message": "RESOURCE_EXHAUSTED quota private-error-text"}}),
            (3, "unselected", "provider-turn.updated", {"rateLimits": {"usedPercent": 99}}),
            (4, "sol", "message.updated", {"error": "quota prompt-text-must-stay-private"}),
        ]:
            self.writer.execute("INSERT INTO orchestration_events VALUES(?,?,?,?,?,?,?)", (seq, str(seq), "thread", tid, typ, "2026-11-14T10:00:00Z", json.dumps(payload)))
        self.writer.commit()
        with ae.read_db(self.data) as con:
            signals, flags, max_prompt = qt.discover(con, "sol", "codex", "fixture-sol", "2026-11-14T11:00:00Z")
        self.assertEqual(max_prompt, 123)
        self.assertEqual(len(signals), 2)
        self.assertEqual(signals[1]["used_fraction"], .05)
        self.assertEqual(signals[0]["event"], "limit_candidate")
        self.assertNotIn("private", json.dumps(signals))
        self.assertNotIn(.99, [s["used_fraction"] for s in signals])

    def test_manual_quota_cli_appends_and_validates_without_opening_db(self):
        command = ["quota", "--manual", "--provider", "antigravity", "--model", "gemini-4-hydrogen-high", "--used-percent", "17", "--note", "UI observation"]
        with redirect_stdout(io.StringIO()), patch.object(ae, "read_db", side_effect=AssertionError("must not open database")):
            self.assertEqual(ae.main(command), 0)
            self.assertEqual(ae.main(command), 0)
        observations = ae.read_jsonl(self.evidence / "quota_snapshots.jsonl")
        self.assertGreaterEqual(len(observations), 1)
        self.assertEqual(observations[0]["used_fraction"], .17)
        self.assertTrue((self.evidence / "calibration_ledger.json").exists())

    def test_overhead_tag_independent_of_variant_and_totals(self):
        with redirect_stdout(io.StringIO()):
            self.assertEqual(ae.main(["collect", "--data-dir", str(self.data), "--thread", "sol", "--role", "overhead"]), 0)
            self.assertEqual(ae.main(["collect", "--data-dir", str(self.data), "--thread", "sol"]), 0)
        records = ae.latest_records(ae.read_jsonl(self.evidence / "runs.jsonl"))
        self.assertEqual(records[0]["role"], "overhead")
        row = ae.summarize(records, [], {})[0]
        self.assertEqual(row["role"], "overhead")
        self.assertIsNone(row["variant"])
        self.assertEqual(ae.report_totals([row])[0]["role"], "overhead")

    def test_api_unknown_service_tier_and_long_context_aggregate(self):
        r = self.records()[0]
        rates = {"input_per_million": 2, "cached_input_per_million": .1, "output_per_million": 10,
                 "long_context_threshold": 1500}
        prices = {"models": {"fixture-sol": rates}}
        r["options"] = {"serviceTier": "default"}
        self.assertIsNone(ae.estimate_cost(r, prices))  # Cumulative > threshold without request observations.
        r["observed_max_prompt_input"] = 1000
        self.assertIsNotNone(ae.estimate_cost(r, prices))
        r["observed_max_prompt_input"] = 1501
        self.assertIsNone(ae.estimate_cost(r, prices))
        r["observed_max_prompt_input"] = 1000
        r["options"] = {"serviceTier": "unpublished"}
        self.assertIsNone(ae.estimate_cost(r, prices))
        r["options"] = {"serviceTier": "default", "fastMode": True}
        self.assertIsNone(ae.estimate_cost(r, prices))

    def test_calibration_keeps_codex_runs_separate_and_antigravity_conversation_once(self):
        first = self.records()[0]
        second = {**first, "run_id": "follow-up", "run_ordinal": 2,
                  "requested_at": "2026-11-21T10:00:00Z", "completed_at": "2026-11-21T10:01:00Z"}
        units = ae.calibration_units([first, second])
        self.assertEqual(len(units), 2)
        hit = qt.snapshot("codex", "fixture-sol", "2026-11-14T10:02:00Z", window="weekly",
            window_start="2026-11-14T09:00:00Z", reset_at="2026-11-21T09:00:00Z",
            event="limit_hit", complete_window=True, exclusive=True)
        entry = next(c for c in qt.ledger(units, [hit]) if c["window"] == "weekly")
        self.assertEqual(entry["capacity_tokens"], 2200)
        self.conversation()
        gem = self.records("gem")[0]
        followup = {**gem, "run_id": "gem-followup", "run_ordinal": 2}
        units = ae.calibration_units([gem, followup])
        self.assertEqual(len(units), 1)
        self.assertEqual(units[0]["tokens"]["input"], 234723)

    def test_mapped_conversation_errors_never_open_arbitrary_paths(self):
        self.conversation()
        r = self.records("gem")[0]
        conversation = r["antigravity_conversations"][0]
        path = self.data / conversation["relative_path"]
        with closing(sqlite3.connect(path)) as con:
            con.execute("CREATE TABLE steps(idx INTEGER PRIMARY KEY,error_details BLOB)")
            con.execute("INSERT INTO steps VALUES(1,?)", (b'quota RESOURCE_EXHAUSTED private-error',))
            con.commit()
        signals = qt.conversation_errors(self.data, [conversation], "antigravity", "fixture-gem", "2026-11-14T10:03:00Z", "gem")
        self.assertEqual(signals[0]["event"], "limit_candidate")
        self.assertNotIn("private-error", json.dumps(signals))
        self.assertEqual(qt.conversation_errors(self.data, [{"relative_path": "acp_token.json"}],
                         "antigravity", "fixture-gem", "2026-11-14T10:03:00Z", "gem"), [])

    def test_collect_exact_run_filter_rejects_unknown_before_writing(self):
        with redirect_stdout(io.StringIO()), patch("sys.stderr", new=io.StringIO()):
            self.assertEqual(ae.main(["collect", "--data-dir", str(self.data), "--thread", "sol", "--run", "missing"]), 1)
            self.assertFalse((self.evidence / "runs.jsonl").exists())
            self.assertEqual(ae.main(["collect", "--data-dir", str(self.data), "--thread", "sol", "--run", "r-sol"]), 0)
        self.assertEqual(len(ae.read_jsonl(self.evidence / "runs.jsonl")), 1)


if __name__ == "__main__":
    unittest.main()
