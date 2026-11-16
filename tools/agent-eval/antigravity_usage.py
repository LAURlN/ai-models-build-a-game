"""Experimental Antigravity gen_metadata decoder; no credentials or network."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3

UUID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
MODEL = re.compile(rb"gemini-[A-Za-z0-9._-]+")


def varint(data, offset):
    value = 0
    for shift in range(0, 70, 7):
        if offset >= len(data):
            raise ValueError("truncated protobuf varint")
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
    raise ValueError("protobuf varint exceeds 10 bytes")


def fields(data):
    offset = 0
    while offset < len(data):
        key, offset = varint(data, offset)
        number, wire = key >> 3, key & 7
        if number == 0:
            raise ValueError("protobuf field zero")
        if wire == 0:
            value, offset = varint(data, offset)
        elif wire in (1, 2, 5):
            if wire == 2:
                length, offset = varint(data, offset)
            else:
                length = 8 if wire == 1 else 4
            if offset + length > len(data):
                raise ValueError("truncated protobuf field")
            value = data[offset:offset + length]
            offset += length
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")
        yield number, wire, value


def decode_generation(blob):
    messages = [value for number, wire, value in fields(blob) if number == 1 and wire == 2]
    usages = [value for message in messages for number, wire, value in fields(message)
              if number == 4 and wire == 2]
    if len(usages) != 1:
        raise ValueError("expected exactly one top.f1.f4 usage message")
    values = {number: value for number, wire, value in fields(usages[0]) if wire == 0}
    if 2 not in values and 3 not in values:
        raise ValueError("usage message has neither input nor output counters")
    # Omitted protobuf scalar fields default to zero. f9/f10 meanings are inferred.
    uncached, cached, output = (values.get(n, 0) for n in (2, 5, 3))
    return {"input": uncached + cached, "uncached_input": uncached,
            "cached_input": cached, "output": output,
            "reasoning": values.get(9, 0), "visible_output_likely": values.get(10, 0),
            "output_split_matches": values.get(9, 0) + values.get(10, 0) == output,
            "models_found": sorted({m.decode("ascii") for m in MODEL.findall(blob)})}


def read_conversation(path, data_dir):
    result = {"conversation_id": path.stem,
              "relative_path": path.relative_to(data_dir).as_posix(),
              "generation_count": 0, "decoded_generation_count": 0,
              "tokens": dict.fromkeys(("input", "uncached_input", "cached_input", "output", "reasoning"), 0),
              "visible_output_likely": 0, "output_split_mismatches": 0,
              "models_found": [], "errors": []}
    models = set()
    con = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5.0)
    try:
        con.execute("PRAGMA query_only=ON")
        con.execute("BEGIN")
        # This DB is already scoped to ONE selected conversation. No global scans.
        for idx, blob in con.execute("SELECT idx, data FROM gen_metadata ORDER BY idx"):
            result["generation_count"] += 1
            try:
                decoded = decode_generation(blob)
            except (ValueError, TypeError) as exc:
                result["errors"].append({"idx": idx, "error": str(exc)})
                continue
            result["decoded_generation_count"] += 1
            for field in result["tokens"]:
                result["tokens"][field] += decoded[field]
            result["visible_output_likely"] += decoded["visible_output_likely"]
            result["output_split_mismatches"] += not decoded["output_split_matches"]
            models.update(decoded["models_found"])
    finally:
        con.rollback()
        con.close()
    result["models_found"] = sorted(models)
    result["complete"] = result["generation_count"] > 0 and not result["errors"]
    return result


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def normalized_cwd(value):
    # The observed .meta sometimes contains double backslashes in its cwd value.
    return os.path.normcase(os.path.normpath(value.replace("\\\\", "\\")))


def conversation_usage(data_dir, provider_payloads, turn_payloads, sessions, start, end):
    """Exact native IDs first; unique cwd/birth-time fallback is explicitly flagged."""
    data_dir = Path(data_dir).expanduser().resolve()
    directory = data_dir / "providers" / "antigravity"
    candidates = set()
    for payload in provider_payloads + turn_payloads + sessions:
        # Whitelisted metadata only; never inspect auth config, logs or secrets.
        for key in ("nativeThreadRef", "nativeTurnRef", "nativeConversationHeadRef", "nativeMetadata"):
            for value in strings(payload.get(key)):
                candidates.update(m.lower() for m in UUID.findall(value))
    paths = set()
    for candidate in candidates:
        paths.update(directory.glob(f"*/antigravity-acp/conversations/{candidate}.db"))
    mapping = "native_uuid"
    warnings = []
    if not paths:
        mapping = "cwd_birth_time_heuristic"
        cwds = {normalized_cwd(s["cwd"]) for s in sessions if isinstance(s.get("cwd"), str)}
        if cwds and start:
            lower = datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp() - 120
            upper = datetime.fromisoformat(end.replace("Z", "+00:00")).timestamp() + 120
            matches = []
            for meta in directory.glob("*/antigravity-acp/conversations/*.meta"):
                if not UUID.fullmatch(meta.stem):
                    continue
                db = meta.with_suffix(".db")
                if not db.is_file():
                    continue
                stat = db.stat()
                # Windows birth time, NOT mtime (which changes while generating).
                birth = getattr(stat, "st_birthtime", stat.st_ctime if os.name == "nt" else None)
                if birth is None or not lower <= birth <= upper:
                    continue
                try:
                    value = json.loads(meta.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                cwd = value.get("cwd") if isinstance(value, dict) else None
                if isinstance(cwd, str) and normalized_cwd(cwd) in cwds:
                    matches.append(db)
            if len(matches) == 1:
                paths.add(matches[0])
                warnings.append("antigravity_mapping_heuristic_verify_manually")
            elif matches:
                warnings.append("antigravity_mapping_ambiguous")
    # Same UUID in multiple account hashes is ambiguous, never sum duplicates.
    if len({p.stem for p in paths}) != len(paths):
        return [], ["antigravity_mapping_ambiguous"]
    results = []
    for path in sorted(paths):
        try:
            result = read_conversation(path, data_dir)
            result["mapping"] = mapping
            results.append(result)
        except (sqlite3.Error, OSError) as exc:
            warnings.append("antigravity_conversation_read_error:" + type(exc).__name__)
    if not results:
        warnings.append("antigravity_conversation_usage_unavailable")
    return results, warnings
