"""The trace end-to-end example must pass self-verifying assertions.

Runs ``python -m examples.trace_end_to_end`` (no daemon/cloud/broker needed)
and checks the exit code + PASS marker — CI-grade proof that the
degrade → trace → analyzer evidence chain works end to end (F-069/F-070).
"""

import subprocess
import sys
from pathlib import Path

PY_ROOT = Path(__file__).resolve().parents[1]


def test_trace_end_to_end_example_passes():
    result = subprocess.run(
        [sys.executable, "-m", "examples.trace_end_to_end"],
        cwd=PY_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, (
        f"example failed\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    assert "PASS: degrade → trace → analyzer evidence chain verified" in result.stdout
