"""End-to-end trace demo: degraded ops → trace file → analyzer aggregates.

Runs with NO daemon, cloud, or broker — the whole F-069/F-070 evidence path
in one self-verifying script:

1. A real ``MemoryCloudClient`` (dead base_url — parametric ops never dial
   HTTP) + ``MemoryCloudParametric`` adapter; broker absent → graceful
   degradation.
2. Three degraded parametric ops emit ``broker_unavailable`` events into the
   trace file (``AWARENESS_TRACE_PATH`` pointed at a temp file).
3. ``scripts/analyze_trace.py`` aggregates the file; the script asserts the
   expected evidence numbers before printing PASS.

Exit 0 + ``PASS`` line on success — suitable as a CI smoke extension (the
minimal variant lives in ``scripts/ci_trace_smoke.py``).

Run::

    python -m examples.trace_end_to_end
"""

import json
import os
import sys
import tempfile
from pathlib import Path

from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.parametric import MemoryCloudParametric


def main() -> int:
    trace_dir = tempfile.mkdtemp(prefix="trace-e2e-")
    trace_path = os.path.join(trace_dir, "trace.jsonl")
    os.environ["AWARENESS_TRACE_PATH"] = trace_path

    client = MemoryCloudClient(base_url="http://127.0.0.1:1")
    mc = MemoryCloudParametric(
        client=client, memory_id="mem-e2e", session_id="sess-e2e",
    )
    assert mc.broker_available is False, "dev machine should have no broker"

    mc.parametric_write("s1", key="color", value="blue")
    mc.parametric_recall("s1", query="color")
    mc.parametric_snapshot("s1")

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import analyze_trace  # noqa: E402

    with open(trace_path, encoding="utf-8") as fh:
        summary = analyze_trace.analyze(fh)

    assert summary["total_lines"] == 3, summary
    assert summary["broker_unavailable"]["total"] == 3, summary
    assert summary["broker_unavailable"]["by_op"] == {
        "parametric_write": 1,
        "parametric_recall": 1,
        "parametric_snapshot": 1,
    }, summary
    rows = [json.loads(ln) for ln in open(trace_path, encoding="utf-8")]
    assert all("content" not in r for r in rows), "hash-only discipline"
    assert all(r["channel"] == "memory_trace" for r in rows)

    print(analyze_trace.render(summary))
    print(f"\ntrace file: {trace_path}")
    print("PASS: degrade → trace → analyzer evidence chain verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
