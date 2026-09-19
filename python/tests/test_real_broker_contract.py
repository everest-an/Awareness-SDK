"""End-to-end SDK ↔ broker contract tests (using dev stub).

These tests prove the **7-method interface contract** that M1's
`memory_broker.MemoryBroker` must satisfy. They run against
`memory_cloud._dev_stubs.broker.MemoryBroker`, a pure-Python stub with
the same shape. When M1 publishes the real broker, this test file
should pass unchanged (just swap the import in the `get_broker()`
helper below).

If a contract test fails after the real broker is wired in, either:
- the broker changed its public API → file an issue against M1
- the SDK adapter changed its assumptions → update the adapter
"""

import json
import os
import tempfile
from unittest.mock import MagicMock

import pytest

from memory_cloud.integrations.parametric import MemoryCloudParametric
from memory_cloud.session_migrate import export_session, import_session
from memory_cloud.tracing import resolve_trace_writer, log_recall, log_write


def _mock_cloud_client(**overrides):
    defaults = {
        "_begin_memory_session": MagicMock(return_value={"session_id": "sess-1"}),
        "retrieve": MagicMock(return_value={"results": []}),
        "record": MagicMock(return_value={"status": "ok", "events_sent": 1}),
        "insights": MagicMock(return_value={"knowledge_cards": [], "risks": [], "action_items": []}),
    }
    defaults.update(overrides)
    return MagicMock(**defaults)


def get_broker():
    """Returns a broker-shaped object. Stub today, real M1 package later."""
    from memory_cloud._dev_stubs.broker import MemoryBroker
    return MemoryBroker(d_mem=64)


# ------------------------------------------------------------------
# Contract 1: 7-method surface
# ------------------------------------------------------------------


def test_broker_has_required_methods():
    broker = get_broker()
    for name in ("sessions", "write", "recall", "forget",
                 "snapshot", "restore", "state_bytes"):
        assert callable(getattr(broker, name, None)), f"broker missing method: {name}"
    # Optional but used by SDK when available:
    assert callable(getattr(broker, "getActiveSessionId", None))


def test_broker_recall_returns_list_of_dicts():
    broker = get_broker()
    broker.write("s1", key="color", value="blue")
    out = broker.recall("s1", query="color", top_k=3)
    assert isinstance(out, list)
    assert all(isinstance(h, dict) for h in out)
    valid = [h for h in out if h.get("value") is not None]
    assert valid, "expected at least one hit for an exact key"
    assert valid[0]["value"] == "blue"


# ------------------------------------------------------------------
# Contract 2: SDK adapter end-to-end (no mocking of the broker)
# ------------------------------------------------------------------


def test_adapter_end_to_end_with_real_broker_shape():
    """The whole write→recall round trip through MemoryCloudParametric
    using a real (stub) broker — no mocks anywhere on the broker path."""
    broker = get_broker()
    client = _mock_cloud_client()
    adapter = MemoryCloudParametric(client=client, memory_id="mem-1", broker=broker)

    # Write
    res = adapter.parametric_write("s1", key="favorite color", value="blue")
    assert res["ok"] is True
    assert res["session_id"] == "s1"

    # Recall — exact key
    hits = adapter.parametric_recall("s1", query="favorite color", top_k=1)
    assert hits and hits[0]["value"] == "blue"

    # Forget — surgical
    adapter.parametric_forget("s1", key="favorite color")
    hits = adapter.parametric_recall("s1", query="favorite color", top_k=1)
    assert hits == []


def test_adapter_snapshot_restore_bit_exact_with_real_broker():
    broker_a = get_broker()
    broker_b = get_broker()
    adapter_a = MemoryCloudParametric(client=_mock_cloud_client(), memory_id="m", broker=broker_a)
    adapter_b = MemoryCloudParametric(client=_mock_cloud_client(), memory_id="m", broker=broker_b)

    sid = "s1"
    bindings = {"k1": "v1", "k2": "v2", "k3": "v3"}
    for k, v in bindings.items():
        adapter_a.parametric_write(sid, key=k, value=v)
    state_before = adapter_a.parametric_state_bytes(sid)

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "session.zip")
        export_session(broker_a, sid, path, trace=None)
        import_session(broker_b, sid, path, trace=None)

    assert adapter_b.parametric_state_bytes(sid) == state_before
    for k, v in bindings.items():
        hits = adapter_b.parametric_recall(sid, query=k, top_k=1)
        assert hits and hits[0]["value"] == v


def test_adapter_broker_unavailable_returns_degraded_result():
    adapter = MemoryCloudParametric(client=_mock_cloud_client(), memory_id="m")  # no broker
    assert adapter.broker_available is False
    res = adapter.parametric_write("s", key="k", value="v")
    assert res["ok"] is False
    assert "broker_unavailable" in res["error"]
    assert adapter.parametric_recall("s", query="k") == []
    assert adapter.parametric_snapshot("s") is None


def test_adapter_recall_emits_trace_when_enabled():
    broker = get_broker()
    broker.write("s1", key="color", value="blue")
    with tempfile.TemporaryDirectory() as tmp:
        trace_path = os.path.join(tmp, "trace.jsonl")
        os.environ["AWARENESS_TRACE_PATH"] = trace_path
        try:
            client = _mock_cloud_client()
            client._trace_writer = resolve_trace_writer()
            adapter = MemoryCloudParametric(client=client, memory_id="m", broker=broker)
            adapter.parametric_recall("s1", query="color", top_k=1)
            # Allow async flush
            client._trace_writer.close()
            with open(trace_path) as fp:
                events = [json.loads(l) for l in fp if l.strip()]
            recall_events = [e for e in events if e["event"] == "recall"]
            assert recall_events, "expected at least one recall event"
            e = recall_events[-1]
            assert e["route"] == "parametric"
            assert e["hit"] == 1
        finally:
            del os.environ["AWARENESS_TRACE_PATH"]


def test_adapter_degrade_emits_trace_event():
    with tempfile.TemporaryDirectory() as tmp:
        trace_path = os.path.join(tmp, "trace.jsonl")
        os.environ["AWARENESS_TRACE_PATH"] = trace_path
        try:
            client = _mock_cloud_client()
            client._trace_writer = resolve_trace_writer()
            adapter = MemoryCloudParametric(client=client, memory_id="m")  # no broker
            adapter.parametric_write("s", key="k", value="v")
            client._trace_writer.close()
            with open(trace_path) as fp:
                events = [json.loads(l) for l in fp if l.strip()]
            degrade = [e for e in events if e["event"] == "broker_unavailable"]
            assert degrade, "expected broker_unavailable event"
            assert degrade[-1]["op"] == "parametric_write"
        finally:
            del os.environ["AWARENESS_TRACE_PATH"]


# ------------------------------------------------------------------
# Contract 3: policyWrite (when present) is preferred over plain write
# ------------------------------------------------------------------


def test_adapter_uses_policy_write_when_available():
    """Verify SDK's parametric-hooks.mjs path: when broker exposes
    policyWrite, write/forget logic uses it (not direct write)."""
    from memory_cloud._dev_stubs.broker import MemoryBroker
    broker = MemoryBroker(d_mem=64)
    policy_calls = []
    original_policy = broker.policyWrite
    broker.policyWrite = lambda sid, event: (policy_calls.append(event), original_policy(sid, event))[1]

    client = _mock_cloud_client()
    client._trace_writer = resolve_trace_writer()  # null writer (default)
    adapter = MemoryCloudParametric(client=client, memory_id="m", broker=broker)

    # Direct write goes through .write (not policyWrite)
    adapter.parametric_write("s", key="color", value="blue")
    assert policy_calls == [], "direct write must NOT use policyWrite"

    # But integration hook on_record_success uses policyWrite if present
    # — exercised via parametric-hooks.mjs (separate test file).
    # This test just confirms the contract is discoverable.
    assert hasattr(broker, "policyWrite")


def test_adapter_accepts_attribute_style_hits():
    """feat/consolidation-policy 的 RecallHit 是属性式命中对象（.value/.score），
    无 tuple/dict 协议——SDK 的 duck-typing 必须吃下它（联调前置条件，
    见 M1-iteration/docs/consolidation-policy-branch-intel.md §3）。"""
    class _RecallHit:
        def __init__(self, value, score):
            self.value, self.score = value, score

    class _AttrBroker:
        """recall 返回属性式命中对象的 broker（不走 _dev_stubs）。"""

        def recall(self, session_id, query=None, top_k=5, candidates=None):
            return [_RecallHit("blue", 0.9), _RecallHit(None, 0.2)]

    adapter = MemoryCloudParametric(
        client=_mock_cloud_client(), memory_id="m", broker=_AttrBroker(),
    )
    out = adapter.parametric_recall("s1", query="color", top_k=2)
    assert [h["value"] for h in out] == ["blue"], "None 值过滤生效"
    assert out[0]["score"] == 0.9
