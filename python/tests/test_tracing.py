"""Tests for memory_cloud.tracing (F-069).

Covers:
- Default off (no env, no path) → NullTraceWriter, zero overhead.
- Env var / explicit path activation.
- Envelope integrity: ts / event / channel / session_id in every event.
- Parent dir auto-creation; self-disabling on write failure (never raises).
- hash-only default; full_content opt-in.
- All seven vocabulary events emit their expected fields.
"""

import json
import os
import stat
from unittest.mock import MagicMock

import pytest

from memory_cloud import tracing
from memory_cloud.tracing import (
    NullTraceWriter,
    MemoryTraceWriter,
    resolve_trace_writer,
    log_recall,
    log_write,
    log_forget,
    log_snapshot,
    log_restore,
    log_conflict_forget,
    log_degrade,
    CHANNEL,
)


def _read_lines(path):
    with open(path, encoding="utf-8") as fp:
        return [json.loads(line) for line in fp if line.strip()]


# ------------------------------------------------------------------
# Default off / activation
# ------------------------------------------------------------------


def test_default_off_returns_null_writer(monkeypatch):
    monkeypatch.delenv(tracing.ENV_TRACE_PATH, raising=False)
    w = resolve_trace_writer()
    assert isinstance(w, NullTraceWriter)


def test_env_var_activates_writer(monkeypatch, tmp_path):
    path = str(tmp_path / "trace.jsonl")
    monkeypatch.setenv(tracing.ENV_TRACE_PATH, path)
    w = resolve_trace_writer(session_id="s1")
    assert isinstance(w, MemoryTraceWriter)
    assert w.path == path


def test_explicit_path_wins_over_env(monkeypatch, tmp_path):
    monkeypatch.setenv(tracing.ENV_TRACE_PATH, str(tmp_path / "env.jsonl"))
    w = resolve_trace_writer(trace_path=str(tmp_path / "explicit.jsonl"))
    assert w.path == str(tmp_path / "explicit.jsonl")


def test_null_writer_is_true_noop():
    w = NullTraceWriter()
    w.write("recall", {"anything": 1})  # must not raise
    w.close()


# ------------------------------------------------------------------
# Envelope integrity
# ------------------------------------------------------------------


def test_envelope_fields_present(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, session_id="sess-9")
    w.write("write", {"content_hash": "abc"})
    row = _read_lines(path)[0]
    assert row["channel"] == CHANNEL
    assert row["session_id"] == "sess-9"
    assert row["event"] == "write"
    assert "ts" in row
    assert row["content_hash"] == "abc"


def test_envelope_carries_schema_version(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    w.write("write", {})
    row = _read_lines(path)[0]
    assert row["v"] == tracing.SCHEMA_VERSION == 1  # ADR-003


def test_writer_creates_parent_dirs(tmp_path):
    path = str(tmp_path / "deep" / "nested" / "trace.jsonl")
    w = MemoryTraceWriter(path)
    w.write("write", {})
    assert os.path.exists(path)


def test_multiple_events_append_in_order(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    with MemoryTraceWriter(path) as w:
        w.write("write", {"n": 1})
        w.write("recall", {"n": 2})
    rows = _read_lines(path)
    assert [r["event"] for r in rows] == ["write", "recall"]


# ------------------------------------------------------------------
# Never-throw / self-disabling
# ------------------------------------------------------------------


def test_unwritable_location_disables_writer_silently(tmp_path):
    # Directory exists but is read-only → open() fails at construction.
    ro_dir = tmp_path / "ro"
    ro_dir.mkdir()
    os.chmod(ro_dir, stat.S_IRUSR | stat.S_IXUSR)
    try:
        w = MemoryTraceWriter(str(ro_dir / "trace.jsonl"))
        assert w.disabled
        w.write("recall", {"x": 1})  # must not raise
    finally:
        os.chmod(ro_dir, stat.S_IRWXU)


def test_io_failure_midlife_disables_writer(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    w.write("write", {"n": 1})
    w._fh.close()  # simulate mid-life I/O breakage
    w.write("write", {"n": 2})  # must not raise
    assert w.disabled
    assert len(_read_lines(path)) == 1  # first event persisted, second dropped


# ------------------------------------------------------------------
# hash-only / full_content
# ------------------------------------------------------------------


def test_log_write_hash_only_by_default(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    log_write(w, content="my secret memory content")
    row = _read_lines(path)[0]
    assert "content" not in row
    assert row["content_bytes"] == len("my secret memory content".encode())
    assert row["content_hash"] == tracing._hash16("my secret memory content")


def test_log_write_full_content_optin(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    log_write(w, content="raw text here", full_content=True)
    row = _read_lines(path)[0]
    assert row["content"] == "raw text here"


def test_hash16_is_stable_and_short():
    h1 = tracing._hash16("stable input")
    h2 = tracing._hash16("stable input")
    assert h1 == h2
    assert len(h1) == 16


# ------------------------------------------------------------------
# Vocabulary events
# ------------------------------------------------------------------


def test_log_recall_fields(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    log_recall(w, trace_id="t1", route="parametric", hit=True,
               n_results=2, latency_ms=0.8123)
    row = _read_lines(path)[0]
    assert row["event"] == "recall"
    assert row["route"] == "parametric"
    assert row["hit"] == 1
    assert row["n_results"] == 2
    assert row["latency_ms"] == 0.812
    assert row["trace_id"] == "t1"
    assert row["gen_ai.operation.name"] == "memory.recall"


def test_log_forget_hashes_key(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    log_forget(w, key="favorite color")
    row = _read_lines(path)[0]
    assert row["event"] == "forget"
    assert row["key_hash"] == tracing._hash16("favorite color")
    assert "key" not in row  # raw key must not leak


def test_log_snapshot_restore(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    log_snapshot(w, binding_count=4, state_bytes=66048)
    log_restore(w, binding_count=4, state_bytes=66048)
    snap, restore = _read_lines(path)
    assert snap["event"] == "snapshot" and snap["binding_count"] == 4
    assert restore["event"] == "restore" and restore["state_bytes"] == 66048


def test_log_conflict_forget_hashes_both_keys(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    log_conflict_forget(w, old_key="old decision", new_key="new decision")
    row = _read_lines(path)[0]
    assert row["event"] == "conflict_forget"
    assert row["old_key_hash"] == tracing._hash16("old decision")
    assert row["new_key_hash"] == tracing._hash16("new decision")
    assert "old_key" not in row and "new_key" not in row


def test_log_degrade(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    log_degrade(w, op="parametric_write", reason="mt_lnn.memory_broker not installed")
    row = _read_lines(path)[0]
    assert row["event"] == "broker_unavailable"
    assert row["op"] == "parametric_write"


def test_helpers_never_raise_on_null_writer():
    w = NullTraceWriter()
    log_recall(w, route="parametric", hit=True)
    log_write(w, content="x")
    log_forget(w, key="k")
    log_snapshot(w)
    log_restore(w)
    log_conflict_forget(w, old_key="o", new_key="n")
    log_degrade(w, op="op", reason="r")  # all no-ops, none raise


def test_helpers_never_raise_on_disabled_writer(tmp_path):
    w = MemoryTraceWriter(str(tmp_path / "trace.jsonl"))
    w._disable()
    log_recall(w, route="cascade")
    log_write(w, content="x")  # all silently dropped, none raise


# ------------------------------------------------------------------
# Rotation (F-070): max_bytes + AWARENESS_TRACE_MAX_BYTES
# ------------------------------------------------------------------

def test_rotation_off_by_default(tmp_path):
    p = tmp_path / "t.jsonl"
    w = MemoryTraceWriter(str(p))
    for _ in range(5):
        w.write("write")
    w.close()
    assert p.exists() and not (tmp_path / "t.jsonl.1").exists()
    assert len(_read_lines(p)) == 5


def test_rotation_on_max_bytes(tmp_path):
    p = tmp_path / "t.jsonl"
    w = MemoryTraceWriter(str(p), max_bytes=120)
    for i in range(8):
        w.write("write", {"i": i})
    assert w.disabled is False, "rotation must not self-disable a healthy writer"
    w.close()
    rotated = tmp_path / "t.jsonl.1"
    assert rotated.exists(), "rotation should have produced <path>.1"
    first = _read_lines(rotated)
    second = _read_lines(p)
    # Single-slot rotation (documented): .1 holds the last rotated file —
    # earlier rotations are replaced, not accumulated.
    assert first and second, "both slots should have content"
    assert all(r["event"] == "write" for r in first + second)


def test_rotation_failure_self_disables_never_raises(tmp_path):
    # os.replace on a path whose parent vanishes mid-flight → rotation fails;
    # the writer must disable itself, never raise.
    p = tmp_path / "t.jsonl"
    w = MemoryTraceWriter(str(p), max_bytes=1)
    w.write("write")  # over 1 byte already, but rotation happens on next write
    # Simulate rotation failure: make the existing file undeletable-replaceable
    # by pointing .1 at a directory (os.replace onto a directory raises).
    (tmp_path / "t.jsonl.1").mkdir()
    w.write("write")  # triggers rotation → replace file onto dir → error → disable
    assert w.disabled is True
    w.write("write")  # no-op, must not raise


def test_env_max_bytes_resolves(monkeypatch, tmp_path):
    monkeypatch.setenv("AWARENESS_TRACE_MAX_BYTES", "not-a-number")
    w = resolve_trace_writer(str(tmp_path / "t.jsonl"))
    assert isinstance(w, MemoryTraceWriter) and w.max_bytes is None
    monkeypatch.setenv("AWARENESS_TRACE_MAX_BYTES", "4096")
    w = resolve_trace_writer(str(tmp_path / "t2.jsonl"))
    assert w.max_bytes == 4096


# ------------------------------------------------------------------
# F-075 · session_id override (real memory session id beats client prefix)
# ------------------------------------------------------------------


def test_log_helpers_session_id_override(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, session_id="sdk")  # client prefix as static
    log_write(w, content="x", session_id="sdk-parametric-m1-20260906-ab12")
    log_recall(w, route="parametric", hit=True, session_id="sess-broker")
    log_degrade(w, op="op", reason="r", session_id="sess-broker")
    rows = _read_lines(path)
    assert rows[0]["session_id"] == "sdk-parametric-m1-20260906-ab12"
    assert rows[1]["session_id"] == "sess-broker"
    assert rows[2]["session_id"] == "sess-broker"


def test_log_helpers_without_session_id_keep_static(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, session_id="sdk")
    log_write(w, content="x")
    row = _read_lines(path)[0]
    assert row["session_id"] == "sdk"


# F-072: transport_error (event 8/8)
# ------------------------------------------------------------------


def test_log_transport_error_fields(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    tracing.log_transport_error(
        w, op="retrieve", route="cloud", error_class="http_status",
        status=503, latency_ms=12.5, trace_id="t-9",
    )
    row = _read_lines(path)[0]
    assert row["event"] == "transport_error"
    assert row["op"] == "retrieve"
    assert row["route"] == "cloud"
    assert row["error_class"] == "http_status"
    assert row["status"] == 503
    assert row["latency_ms"] == 12.5
    assert row["trace_id"] == "t-9"
    assert "gen_ai.operation.name" in row


def test_log_transport_error_content_free(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    tracing.log_transport_error(
        w, op="recall", route="daemon", error_class="connect",
    )
    row = _read_lines(path)[0]
    assert "status" not in row and "latency_ms" not in row
    assert row["error_class"] == "connect"


# ------------------------------------------------------------------
# F-072: min-interval throttling (default off)
# ------------------------------------------------------------------


def test_min_interval_off_by_default(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    for _ in range(5):
        w.write("recall")
    assert len(_read_lines(path)) == 5
    assert w._min_interval == 0.0


def test_min_interval_suppresses_and_carries_count(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, min_interval_ms=60000)
    w.write("recall", {"n": 1})          # emitted, starts the window
    w.write("recall", {"n": 2})          # suppressed
    w.write("recall", {"n": 3})          # suppressed
    w.write("write", {"content_hash": "x"})  # different type — own window
    w.write("write", {"content_hash": "y"})  # suppressed
    rows = _read_lines(path)
    assert len(rows) == 2
    assert rows[0]["event"] == "recall" and "_suppressed_count" not in rows[0]
    assert rows[1]["event"] == "write"  # first of its type starts its own window
    assert "_suppressed_count" not in rows[1]
    assert w._suppressed == {"recall": 2, "write": 1}  # pending, carried on next emit


def test_min_interval_next_emit_carries_accumulated(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, min_interval_ms=60000)
    w.write("recall")            # emitted
    w.write("recall")            # suppressed (1)
    w.write("recall")            # suppressed (2)
    import time
    # origin-independent: step back one window+ε (monotonic() starts near 0 on macOS)
    w._last_emit["recall"] = time.monotonic() - 61.0
    w.write("recall")            # emitted again, carries both
    rows = _read_lines(path)
    assert len(rows) == 2
    assert rows[1]["_suppressed_count"] == 2


def test_min_interval_never_samples_errors(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, min_interval_ms=60000)
    for _ in range(4):
        tracing.log_transport_error(w, op="op", route="cloud", error_class="connect")
        tracing.log_degrade(w, op="op", reason="r")
        tracing.log_forget(w, key="k")
        tracing.log_conflict_forget(w, old_key="o", new_key="n")
    rows = _read_lines(path)
    assert len(rows) == 16  # every error/rare event passes untouched
    assert all("_suppressed_count" not in r for r in rows)


def test_min_interval_snapshot_restore_unaffected(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, min_interval_ms=60000)
    tracing.log_snapshot(w)
    tracing.log_snapshot(w)
    tracing.log_restore(w)
    assert len(_read_lines(path)) == 3


def test_env_min_interval_resolves(monkeypatch, tmp_path):
    monkeypatch.setenv("AWARENESS_TRACE_MIN_INTERVAL_MS", "not-a-number")
    w = resolve_trace_writer(str(tmp_path / "t.jsonl"))
    assert w._min_interval == 0.0
    monkeypatch.setenv("AWARENESS_TRACE_MIN_INTERVAL_MS", "250")
    w = resolve_trace_writer(str(tmp_path / "t2.jsonl"))
    assert w._min_interval == 0.25
    monkeypatch.delenv("AWARENESS_TRACE_MIN_INTERVAL_MS")
    w = resolve_trace_writer(str(tmp_path / "t3.jsonl"), min_interval_ms=1000)
    assert w._min_interval == 1.0


# ------------------------------------------------------------------
# F-072: close() flushes pending suppressed counts
# ------------------------------------------------------------------


def test_close_flushes_pending_suppressed_count(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, min_interval_ms=60000)
    w.write("recall")            # emitted
    w.write("recall")            # suppressed (1)
    w.write("recall")            # suppressed (2)
    w.close()
    rows = _read_lines(path)
    assert len(rows) == 2
    assert rows[1]["_suppressed_count"] == 2


def test_close_flush_bypasses_throttle_window(tmp_path):
    # Regression: a flush row emitted INSIDE the throttle window must not
    # suppress itself (close() bypasses the min-interval gate).
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, min_interval_ms=60000)
    w.write("recall")            # emitted, starts window
    w.write("recall")            # suppressed (1)
    w.close()                    # still inside the 60s window
    rows = _read_lines(path)
    assert len(rows) == 2
    assert rows[1]["_suppressed_count"] == 1


def test_close_flush_idempotent(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path, min_interval_ms=60000)
    w.write("write")
    w.write("write")             # suppressed (1)
    w.close()
    w.close()                    # second close must not append again
    rows = _read_lines(path)
    assert len(rows) == 2
    assert rows[1]["_suppressed_count"] == 1


def test_close_without_pending_writes_nothing(tmp_path):
    path = str(tmp_path / "trace.jsonl")
    w = MemoryTraceWriter(path)
    w.write("recall")
    w.close()
    assert len(_read_lines(path)) == 1  # no flush rows when nothing pending
