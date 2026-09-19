"""SDK↔M1 parity: identical scenarios on the dev stub and the real M1 broker.

F-061 direction check: this test imports ``mt_lnn.memory_broker`` (the
contract face) — the ONLY M1 surface the SDK may ever touch — from the local
M1 iteration worktree when present.  It is the dress rehearsal for real
integration: the same scenarios must behave identically on the dev stub and
on M1's broker.

Skips (never fails) when the worktree or torch is absent — CI and other
machines run the stub-only contract tests instead
(``test_real_broker_contract.py``).

Run locally: ``<M1 venv>/python -m pytest tests/test_m1_parity_local.py``
from ``python/`` (needs numpy + torch, e.g. M1's venv).
"""

import sys
from pathlib import Path

import pytest

PY_ROOT = Path(__file__).resolve().parents[1]
M1_WORKTREE = Path.home() / "Projects" / "M1-iteration"

_worktree_ready = (M1_WORKTREE / "mt_lnn" / "memory_broker.py").is_file()
try:
    import torch  # noqa: F401

    _torch_ok = True
except Exception:  # noqa: BLE001 — torch is heavy and optional here
    _torch_ok = False

pytestmark = pytest.mark.skipif(
    not (_worktree_ready and _torch_ok),
    reason="M1 iteration worktree + torch required for the parity run",
)

if _worktree_ready and _torch_ok:
    sys.path.insert(0, str(M1_WORKTREE))  # mt_lnn.memory_broker (contract face)
    sys.path.insert(0, str(PY_ROOT))  # memory_cloud._dev_stubs

    from mt_lnn.memory_broker import MemoryBroker as M1Broker  # noqa: E402

    from memory_cloud._dev_stubs.broker import MemoryBroker as StubBroker  # noqa: E402


def _hits(broker, session, query, top_k=3):
    """Normalize both recall shapes to [(value, score), ...] (SDK duck-typing)."""
    out = []
    for h in broker.recall(session, query=query, top_k=top_k):
        if isinstance(h, dict):
            out.append((h.get("value"), h.get("score")))
        else:
            out.append((h[0], h[1]))
    return out


SCENARIOS = ["stub", "m1"]


def _make(kind):
    if kind == "stub":
        return StubBroker(d_mem=16, active_session_id=None)
    return M1Broker(d_mem=16, vocab_size=64)


@pytest.mark.parametrize("kind", SCENARIOS)
def test_write_recall_forget_snapshot_lifecycle(kind):
    broker = _make(kind)
    broker.write("s1", key="color", value="blue")
    hits = _hits(broker, "s1", query="color")
    assert hits[0][0] == "blue"
    assert hits[0][1] > 0.0

    removed = broker.forget("s1", key="color")
    assert removed
    hits = _hits(broker, "s1", query="color")
    assert all(v is None for v, _s in hits), "F-064: forget -> no memory"


@pytest.mark.parametrize("kind", SCENARIOS)
def test_snapshot_restore_roundtrip(kind):
    broker = _make(kind)
    broker.write("s1", key="color", value="blue")
    broker.write("s1", key="food", value="sushi")
    snap = broker.snapshot("s1")
    assert snap is not None

    other = _make(kind)
    other.restore("s1", snap)
    assert _hits(other, "s1", query="color")[0][0] == "blue"
    assert _hits(other, "s1", query="food")[0][0] == "sushi"


@pytest.mark.parametrize("kind", SCENARIOS)
def test_never_written_session_is_no_memory(kind):
    broker = _make(kind)
    hits = _hits(broker, "ghost", query="anything")
    assert all(v is None for v, _s in hits)
