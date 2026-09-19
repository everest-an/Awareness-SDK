#!/usr/bin/env python3
"""Aggregate a SDK trace JSONL into the evidence numbers GOVERNANCE §6 consumes.

GOVERNANCE.md §4 requires every default-flip ADR to cite mechanism-trace
evidence (recall hit-rate, degradation frequency, latency); §6 names the
minimum evidence set: ``recall`` (route/hit/latency) and
``broker_unavailable``.  This script is the mechanical producer of those
numbers — the bridge between ``memory_cloud.tracing``'s JSONL output and
the claims register (§7).

Usage::

    python3 scripts/analyze_trace.py <trace.jsonl> [--json]
    python3 scripts/analyze_trace.py <trace.jsonl> --verbose   # per-route detail

The event vocabulary is fixed by F-069 (changes require an ADR).  Unknown
event values are counted under ``other`` so a vocabulary extension via a
future ADR degrades gracefully instead of crashing the aggregator.
"""

import argparse
import json
import sys
from typing import Any, Dict, Iterable, List, Optional

EVENTS_WITH_COUNTS = ("write", "forget", "snapshot", "restore", "conflict_forget")


def _percentile(sorted_values: List[float], pct: float) -> Optional[float]:
    """Nearest-rank percentile on a pre-sorted list. None for empty input."""
    if not sorted_values:
        return None
    idx = max(0, min(len(sorted_values) - 1, round(pct / 100 * (len(sorted_values) - 1))))
    return sorted_values[idx]


def analyze(lines: Iterable[str]) -> Dict[str, Any]:
    """Aggregate raw JSONL lines into the evidence summary dict.

    Pure function over the file contents so tests can call it directly;
    the CLI below is a thin wrapper.  Malformed lines are skipped and
    counted — a broken trace row must never break the analysis.
    """
    recall_total = 0
    recall_by_route: Dict[str, Dict[str, int]] = {}
    latencies: List[float] = []
    degrade_by_op: Dict[str, int] = {}
    degrade_by_reason: Dict[str, int] = {}
    transport_total = 0
    transport_by_op: Dict[str, int] = {}
    transport_by_route: Dict[str, int] = {}
    transport_by_class: Dict[str, int] = {}
    transport_by_status: Dict[str, int] = {}
    counted: Dict[str, int] = {e: 0 for e in EVENTS_WITH_COUNTS}
    write_bytes_total = 0
    other_events: Dict[str, int] = {}
    sessions: set = set()
    total = 0
    malformed = 0

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        total += 1
        try:
            row = json.loads(line)
            event = row["event"]
        except (json.JSONDecodeError, KeyError, TypeError):
            malformed += 1
            continue

        sessions.add(row.get("session_id"))

        if event == "recall":
            recall_total += 1
            route = str(row.get("route", "unknown"))
            bucket = recall_by_route.setdefault(route, {"total": 0, "hits": 0})
            bucket["total"] += 1
            if row.get("hit") in (1, True):
                bucket["hits"] += 1
            latency = row.get("latency_ms")
            if isinstance(latency, (int, float)):
                latencies.append(float(latency))
        elif event == "broker_unavailable":
            op = str(row.get("op", "unknown"))
            reason = str(row.get("reason", "unknown"))
            degrade_by_op[op] = degrade_by_op.get(op, 0) + 1
            degrade_by_reason[reason] = degrade_by_reason.get(reason, 0) + 1
        elif event == "transport_error":
            transport_total += 1
            op = str(row.get("op", "unknown"))
            route = str(row.get("route", "unknown"))
            err_class = str(row.get("error_class", "unknown"))
            status = row.get("status")
            transport_by_op[op] = transport_by_op.get(op, 0) + 1
            transport_by_route[route] = transport_by_route.get(route, 0) + 1
            transport_by_class[err_class] = transport_by_class.get(err_class, 0) + 1
            if status is not None:
                key = str(status)
                transport_by_status[key] = transport_by_status.get(key, 0) + 1
        elif event == "write":
            counted["write"] += 1
            nbytes = row.get("content_bytes")
            if isinstance(nbytes, int):
                write_bytes_total += nbytes
        elif event in counted:
            counted[event] += 1
        else:
            other_events[event] = other_events.get(event, 0) + 1

    def _hit_rate(bucket: Dict[str, int]) -> Optional[float]:
        return bucket["hits"] / bucket["total"] if bucket["total"] else None

    latencies.sort()
    return {
        "total_lines": total,
        "malformed_lines": malformed,
        "sessions": len(sessions),
        "recall": {
            "total": recall_total,
            "overall_hit_rate": _hit_rate(
                {
                    "total": sum(b["total"] for b in recall_by_route.values()),
                    "hits": sum(b["hits"] for b in recall_by_route.values()),
                }
            ),
            "by_route": {
                route: {**bucket, "hit_rate": _hit_rate(bucket)}
                for route, bucket in sorted(recall_by_route.items())
            },
            "latency_ms": {
                "count": len(latencies),
                "p50": _percentile(latencies, 50),
                "p95": _percentile(latencies, 95),
            },
        },
        "broker_unavailable": {
            "total": sum(degrade_by_op.values()),
            "by_op": dict(sorted(degrade_by_op.items())),
            "by_reason": dict(sorted(degrade_by_reason.items())),
        },
        "transport_error": {
            "total": transport_total,
            "by_op": dict(sorted(transport_by_op.items())),
            "by_route": dict(sorted(transport_by_route.items())),
            "by_error_class": dict(sorted(transport_by_class.items())),
            "by_status": dict(sorted(transport_by_status.items(),
                                     key=lambda kv: kv[0])),
        },
        "events": {
            **{name: cnt for name, cnt in counted.items()},
            "write_content_bytes_total": write_bytes_total,
            "other": dict(sorted(other_events.items())),
        },
    }


def _fmt_pct(value: Optional[float]) -> str:
    return f"{value * 100:.1f}%" if value is not None else "n/a"


def _fmt_ms(value: Optional[float]) -> str:
    return f"{value:.1f}ms" if value is not None else "n/a"


def render(summary: Dict[str, Any], verbose: bool = False) -> str:
    """Human-readable report for one trace file."""
    out: List[str] = []
    rec = summary["recall"]
    out.append(f"Trace summary — {summary['total_lines']} events, "
               f"{summary['sessions']} session(s), "
               f"{summary['malformed_lines']} malformed line(s) skipped")
    out.append("")
    out.append("— recall (GOVERNANCE §6 minimum evidence set) —")
    out.append(f"  overall: {_fmt_pct(rec['overall_hit_rate'])} "
               f"({rec['total']} recall events)")
    for route, bucket in rec["by_route"].items():
        line = (f"  route={route:<12} hit={_fmt_pct(bucket['hit_rate'])} "
                f"({bucket['hits']}/{bucket['total']})")
        out.append(line)
    lat = rec["latency_ms"]
    out.append(f"  latency: p50={_fmt_ms(lat['p50'])}  p95={_fmt_ms(lat['p95'])}  "
               f"(n={lat['count']})")
    deg = summary["broker_unavailable"]
    out.append("")
    out.append("— broker_unavailable (observable degradation, F-062) —")
    out.append(f"  total: {deg['total']}")
    for op, cnt in deg["by_op"].items():
        out.append(f"  op={op:<20} {cnt}")
    if verbose:
        for reason, cnt in deg["by_reason"].items():
            out.append(f"  reason={reason:<30} {cnt}")
    te = summary["transport_error"]
    out.append("")
    out.append("— transport_error (HTTP failure evidence, F-072) —")
    out.append(f"  total: {te['total']}")
    for route, cnt in te["by_route"].items():
        out.append(f"  route={route:<12} {cnt}")
    for err_class, cnt in te["by_error_class"].items():
        out.append(f"  class={err_class:<12} {cnt}")
    if verbose:
        for op, cnt in te["by_op"].items():
            out.append(f"  op={op:<20} {cnt}")
        for status, cnt in te["by_status"].items():
            out.append(f"  http_status={status:<10} {cnt}")
    out.append("")
    out.append("— other events —")
    ev = summary["events"]
    for name in EVENTS_WITH_COUNTS:
        suffix = f" (content_bytes total {ev['write_content_bytes_total']})" if name == "write" else ""
        out.append(f"  {name:<18} {ev[name]}{suffix}")
    if ev["other"]:
        out.append("  unrecognized events (vocabulary extension? see F-069):")
        for name, cnt in ev["other"].items():
            out.append(f"  {name:<18} {cnt}")
    return "\n".join(out)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("trace_path", help="JSONL trace file (memory_cloud.tracing output)")
    parser.add_argument("--json", action="store_true", help="emit the summary as JSON")
    parser.add_argument("--verbose", action="store_true", help="per-reason / detail rows")
    args = parser.parse_args(argv)

    try:
        with open(args.trace_path, encoding="utf-8") as fh:
            summary = analyze(fh)
    except OSError as exc:
        print(f"error: cannot read {args.trace_path}: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(render(summary, verbose=args.verbose))
    return 0


if __name__ == "__main__":
    sys.exit(main())
