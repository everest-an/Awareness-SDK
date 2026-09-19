#!/usr/bin/env python3
"""CI import + trace smoke (F-070): writer resolves, emits, hash-only lands.

Exercises the F-069 runtime path end-to-end without any daemon/broker:
resolve the writer from AWARENESS_TRACE_PATH, emit a recall + a degradation
event, then assert the file really contains them.  Exits non-zero on any
failure so CI red is meaningful.
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from memory_cloud.tracing import resolve_trace_writer, log_recall, log_degrade  # noqa: E402


def main() -> int:
    path = os.path.join(tempfile.mkdtemp(), "trace.jsonl")
    os.environ["AWARENESS_TRACE_PATH"] = path
    w = resolve_trace_writer()
    log_recall(w, route="cascade", hit=False, n_results=0, latency_ms=1.0)
    log_degrade(w, op="smoke", reason="ci")
    rows = [ln for ln in open(path, encoding="utf-8").read().splitlines() if ln]
    assert len(rows) == 2, f"expected 2 trace events, got {len(rows)}: {rows}"
    assert '"event": "recall"' in rows[0] and '"event": "broker_unavailable"' in rows[1]
    assert "content" not in rows[0], "recall row must stay hash-only"
    print(f"trace smoke ok: {len(rows)} events written to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
