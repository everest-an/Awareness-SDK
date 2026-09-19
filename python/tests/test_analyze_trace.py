"""Tests for scripts/analyze_trace.py — GOVERNANCE §6 evidence aggregator."""

import json

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import analyze_trace  # noqa: E402


def _row(event, **fields):
    row = {"ts": "2026-09-06T00:00:00+00:00", "event": event,
           "session_id": "sess-test", "channel": "memory_trace"}
    row.update(fields)
    return json.dumps(row, ensure_ascii=False)


def test_recall_hit_rates_and_latency():
    lines = [
        _row("recall", route="daemon", hit=1, latency_ms=10.0),
        _row("recall", route="daemon", hit=0, latency_ms=30.0),
        _row("recall", route="parametric", hit=1, latency_ms=0.5),
        _row("recall", route="parametric", hit=1),  # no latency → excluded from p50/p95
        _row("recall", route="cloud", hit=0, latency_ms=100.0),
    ]
    s = analyze_trace.analyze(lines)
    assert s["recall"]["total"] == 5
    assert s["recall"]["overall_hit_rate"] == 3 / 5
    daemon = s["recall"]["by_route"]["daemon"]
    assert daemon == {"total": 2, "hits": 1, "hit_rate": 0.5}
    assert s["recall"]["by_route"]["parametric"]["hit_rate"] == 1.0
    lat = s["recall"]["latency_ms"]
    assert lat["count"] == 4
    assert lat["p50"] == 30.0  # sorted [0.5, 10, 30, 100] nearest-rank p50 → 30
    assert lat["p95"] == 100.0


def test_broker_unavailable_grouping():
    lines = [
        _row("broker_unavailable", op="parametric_write", reason="broker_unavailable"),
        _row("broker_unavailable", op="parametric_write", reason="timeout"),
        _row("broker_unavailable", op="parametric_recall", reason="broker_unavailable"),
    ]
    s = analyze_trace.analyze(lines)
    assert s["broker_unavailable"]["total"] == 3
    assert s["broker_unavailable"]["by_op"] == {
        "parametric_write": 2, "parametric_recall": 1}
    assert s["broker_unavailable"]["by_reason"] == {
        "broker_unavailable": 2, "timeout": 1}


def test_counted_events_and_write_bytes():
    lines = [
        _row("write", content_hash="a" * 16, content_bytes=120),
        _row("write", content_hash="b" * 16, content_bytes=80),
        _row("forget", key_hash="c" * 16),
        _row("snapshot", binding_count=3, state_bytes=66000),
        _row("restore", binding_count=3, state_bytes=66000),
        _row("conflict_forget", old_key_hash="d" * 16, new_key_hash="e" * 16),
    ]
    s = analyze_trace.analyze(lines)
    assert s["events"]["write"] == 2
    assert s["events"]["write_content_bytes_total"] == 200
    assert s["events"]["forget"] == 1
    assert s["events"]["snapshot"] == 1
    assert s["events"]["restore"] == 1
    assert s["events"]["conflict_forget"] == 1


def test_malformed_and_unknown_events_degrade_gracefully():
    lines = [
        "not json at all",
        json.dumps({"ts": "x"}),  # missing event key
        _row("future_event_from_new_adr", foo=1),
        _row("recall", route="daemon", hit=1, latency_ms=5.0),
        "",  # blank line
    ]
    s = analyze_trace.analyze(lines)
    assert s["malformed_lines"] == 2
    assert s["events"]["other"] == {"future_event_from_new_adr": 1}
    assert s["recall"]["total"] == 1
    assert s["sessions"] == 1


def test_empty_input_is_all_zero():
    s = analyze_trace.analyze([])
    assert s["total_lines"] == 0
    assert s["recall"]["total"] == 0
    assert s["recall"]["overall_hit_rate"] is None
    assert s["recall"]["latency_ms"]["p50"] is None
    assert s["broker_unavailable"]["total"] == 0


def test_all_malformed_does_not_crash():
    s = analyze_trace.analyze(["garbage", "{oops"])
    assert s["total_lines"] == 2
    assert s["malformed_lines"] == 2
    assert s["recall"]["total"] == 0


def test_cli_file_and_json_mode(tmp_path, capsys):
    trace = tmp_path / "t.jsonl"
    trace.write_text("\n".join([
        _row("recall", route="daemon", hit=1, latency_ms=2.0),
        _row("broker_unavailable", op="parametric_write", reason="broker_unavailable"),
    ]) + "\n", encoding="utf-8")
    rc = analyze_trace.main([str(trace)])
    assert rc == 0
    human = capsys.readouterr().out
    assert "route=daemon" in human

    rc = analyze_trace.main([str(trace), "--json"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["recall"]["total"] == 1
    assert payload["broker_unavailable"]["total"] == 1


def test_cli_missing_file_exit_1(capsys):
    rc = analyze_trace.main(["/nonexistent/trace.jsonl"])
    assert rc == 1
    assert "cannot read" in capsys.readouterr().err


def test_transport_error_aggregation():
    lines = [
        _row("transport_error", op="retrieve", route="cloud",
             error_class="http_status", status=503, latency_ms=120.0),
        _row("transport_error", op="retrieve", route="cloud",
             error_class="timeout"),
        _row("transport_error", op="recall", route="daemon",
             error_class="connect", status=502),
    ]
    s = analyze_trace.analyze(lines)
    te = s["transport_error"]
    assert te["total"] == 3
    assert te["by_op"] == {"recall": 1, "retrieve": 2}
    assert te["by_route"] == {"cloud": 2, "daemon": 1}
    assert te["by_error_class"] == {"connect": 1, "http_status": 1, "timeout": 1}
    assert te["by_status"] == {"502": 1, "503": 1}
