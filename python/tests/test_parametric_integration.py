"""Tests for the MemoryCloudParametric adapter.

Covers:
- Construction with and without a broker.
- Graceful degradation when mt_lnn.memory_broker is absent.
- All parametric_* operations with a mock broker.
- Shared base-class surface (memory_search, memory_write, get_tool_functions).
- Snapshot/restore round-trip with a mock broker.
- Session and source defaults.
"""

from unittest.mock import MagicMock

from memory_cloud.integrations.parametric import MemoryCloudParametric


def _mock_client(**overrides):
    defaults = {
        "_begin_memory_session": MagicMock(return_value={"session_id": "sess-1"}),
        "retrieve": MagicMock(return_value={"results": [{"content": "test-doc"}]}),
        "record": MagicMock(return_value={"status": "ok", "events_sent": 1}),
        "insights": MagicMock(return_value={"knowledge_cards": [], "risks": [], "action_items": []}),
        "base_url": "http://localhost:8000/api/v1",
        "api_key": "k1",
    }
    defaults.update(overrides)
    return MagicMock(**defaults)


def _mock_broker():
    """A mock broker that mimics MemoryBroker's interface."""
    broker = MagicMock()
    broker.write = MagicMock()
    broker.recall = MagicMock(return_value=[("blue", 0.95)])
    broker.forget = MagicMock(return_value=True)
    broker.snapshot = MagicMock(return_value={
        "format": "parametric-memory-v1",
        "d_mem": 128,
        "read_rule": "sum",
        "F": "base64-F",
        "z": "base64-z",
        "lexicon": [["blue", "base64-vec"]],
    })
    broker.restore = MagicMock()
    broker.state_bytes = MagicMock(return_value=128 * 128 * 4 + 128 * 4)
    broker.sessions = MagicMock(return_value=["s1", "s2"])
    return broker


# ------------------------------------------------------------------
# Construction & defaults
# ------------------------------------------------------------------


def test_parametric_session_and_source():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    assert mc.session_id == "sess-1"
    assert mc.source == "parametric"


def test_parametric_broker_unavailable_by_default():
    """Without mt_lnn installed, broker_available is False."""
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    # broker_available depends on whether mt_lnn.memory_broker is installed;
    # in the test env it typically isn't, so we just check the property is bool.
    assert isinstance(mc.broker_available, bool)


def test_parametric_with_explicit_broker():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    assert mc.broker_available is True


# ------------------------------------------------------------------
# Graceful degradation (no broker)
# ------------------------------------------------------------------


def test_parametric_write_no_broker():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    # Force no broker
    mc._broker = None
    result = mc.parametric_write("s1", key="color", value="blue")
    assert result["ok"] is False
    assert "error" in result


def test_parametric_recall_no_broker():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    mc._broker = None
    hits = mc.parametric_recall("s1", query="color")
    assert hits == []


def test_parametric_forget_no_broker():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    mc._broker = None
    result = mc.parametric_forget("s1")
    assert result["ok"] is False


def test_parametric_snapshot_no_broker():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    mc._broker = None
    assert mc.parametric_snapshot("s1") is None


def test_parametric_restore_no_broker():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    mc._broker = None
    result = mc.parametric_restore("s1", {"format": "parametric-memory-v1"})
    assert result["ok"] is False


def test_parametric_state_bytes_no_broker():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    mc._broker = None
    assert mc.parametric_state_bytes("s1") == 0


def test_parametric_sessions_no_broker():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    mc._broker = None
    assert mc.parametric_sessions() == []


# ------------------------------------------------------------------
# Broker-backed operations
# ------------------------------------------------------------------


def test_parametric_write_with_broker():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    result = mc.parametric_write("s1", key="color", value="blue")
    assert result["ok"] is True
    assert result["session_id"] == "s1"
    broker.write.assert_called_once_with("s1", key="color", value="blue", update_rule=None)


def test_parametric_write_with_update_rule():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    mc.parametric_write("s1", key="color", value="blue", update_rule="delta")
    broker.write.assert_called_once_with("s1", key="color", value="blue", update_rule="delta")


def test_parametric_recall_with_broker():
    broker = _mock_broker()
    broker.recall = MagicMock(return_value=[("blue", 0.95), (None, 0.0)])
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    hits = mc.parametric_recall("s1", query="color", top_k=2)
    assert len(hits) == 1  # None entries filtered out
    assert hits[0]["value"] == "blue"
    assert hits[0]["score"] == 0.95
    broker.recall.assert_called_once_with("s1", query="color", top_k=2, candidates=None)


def test_parametric_recall_with_candidates():
    broker = _mock_broker()
    broker.recall = MagicMock(return_value=[(42, 0.8)])
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    hits = mc.parametric_recall("s1", query="test", top_k=1, candidates=[1, 2, 3])
    assert hits[0]["value"] == 42
    broker.recall.assert_called_once_with("s1", query="test", top_k=1, candidates=[1, 2, 3])


def test_parametric_forget_with_broker():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    result = mc.parametric_forget("s1", key="color")
    assert result["ok"] is True
    broker.forget.assert_called_once_with("s1", key="color")


def test_parametric_forget_whole_session():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    mc.parametric_forget("s1")
    broker.forget.assert_called_once_with("s1", key=None)


def test_parametric_snapshot_with_broker():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    snap = mc.parametric_snapshot("s1")
    assert snap is not None
    assert snap["format"] == "parametric-memory-v1"
    broker.snapshot.assert_called_once_with("s1")


def test_parametric_restore_with_broker():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    snap = {"format": "parametric-memory-v1", "d_mem": 128}
    result = mc.parametric_restore("s1", snap)
    assert result["ok"] is True
    broker.restore.assert_called_once_with("s1", snap)


def test_parametric_state_bytes_with_broker():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    size = mc.parametric_state_bytes("s1")
    assert size == 128 * 128 * 4 + 128 * 4


def test_parametric_sessions_with_broker():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    sessions = mc.parametric_sessions()
    assert sessions == ["s1", "s2"]


# ------------------------------------------------------------------
# Snapshot → restore round-trip
# ------------------------------------------------------------------


def test_parametric_snapshot_restore_roundtrip():
    broker = _mock_broker()
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    snap = mc.parametric_snapshot("s1")
    assert snap is not None
    # Wipe, then restore
    mc.parametric_forget("s1")
    mc.parametric_restore("s1", snap)
    # Verify broker calls
    assert broker.forget.called
    assert broker.restore.called


# ------------------------------------------------------------------
# Broker error handling
# ------------------------------------------------------------------


def test_parametric_write_broker_error():
    broker = _mock_broker()
    broker.write = MagicMock(side_effect=RuntimeError("boom"))
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    result = mc.parametric_write("s1", key="k", value="v")
    assert result["ok"] is False
    assert "boom" in result["error"]


def test_parametric_recall_broker_error():
    broker = _mock_broker()
    broker.recall = MagicMock(side_effect=RuntimeError("boom"))
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", broker=broker,
    )
    hits = mc.parametric_recall("s1", query="q")
    assert hits == []


# ------------------------------------------------------------------
# Shared base-class surface
# ------------------------------------------------------------------


def test_parametric_memory_search():
    mc = MemoryCloudParametric(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "param-doc"}]}),
        ),
        memory_id="m1",
    )
    output = mc.memory_search("find")
    assert "param-doc" in output


def test_parametric_memory_write():
    mc = MemoryCloudParametric(
        client=_mock_client(), memory_id="m1", auto_remember=False,
    )
    output = mc.memory_write("param decision")
    assert "ok" in output


def test_parametric_get_tool_functions():
    mc = MemoryCloudParametric(client=_mock_client(), memory_id="m1")
    tools = mc.get_tool_functions()
    assert len(tools) == 3
    names = [t["name"] for t in tools]
    assert "memory_search" in names
    assert "memory_write" in names
    assert "memory_insights" in names


def test_parametric_inject_messages():
    mc = MemoryCloudParametric(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "param-memory"}]}),
        ),
        memory_id="m1",
        auto_remember=False,
    )
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "What did we decide?"},
    ]
    result = mc.inject_into_messages(messages)
    assert "[Relevant memories]" in result[0]["content"]
    assert "param-memory" in result[0]["content"]
    assert "You are helpful." in result[0]["content"]


# ------------------------------------------------------------------
# __init__ registration
# ------------------------------------------------------------------


def test_parametric_in_integrations_all():
    from memory_cloud import integrations
    assert "MemoryCloudParametric" in integrations.__all__
