"""Quickstart for the Parametric memory adapter.

Demonstrates:
1. Constructing ``MemoryCloudParametric`` with and without a broker.
2. Direct parametric write / recall / forget.
3. Bit-exact snapshot → restore round-trip.
4. Graceful degradation when ``mt_lnn.memory_broker`` is not installed.

Run::

    python -m examples.parametric_quickstart
"""

from unittest.mock import MagicMock

import os

from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.parametric import MemoryCloudParametric


def _mock_cloud_client() -> MemoryCloudClient:
    """A mock client so the example runs without a live daemon or cloud."""
    client = MagicMock(spec=MemoryCloudClient)
    client._begin_memory_session = MagicMock(return_value={"session_id": "sess-demo"})
    client.retrieve = MagicMock(return_value={"results": []})
    client.record = MagicMock(return_value={"status": "ok", "events_sent": 1})
    client.insights = MagicMock(return_value={"knowledge_cards": [], "risks": [], "action_items": []})
    return client


def main() -> None:
    # --- Without a broker: graceful degradation, with REAL trace output -----
    # A real client (not a mock) so the F-069 trace writer is real too: set
    # AWARENESS_TRACE_PATH and the broker_unavailable events below land in a
    # file you can inspect — "silently degraded" becomes observable (F-062).
    # Parametric ops never dial HTTP (the dead base_url is a guard), and
    # session_id is passed explicitly so no session bootstrap happens.
    trace_path = os.environ.get("AWARENESS_TRACE_PATH", "")
    real_client = MemoryCloudClient(base_url="http://127.0.0.1:1")
    mc = MemoryCloudParametric(
        client=real_client, memory_id="mem-demo", session_id="sess-demo",
    )
    print(f"broker_available: {mc.broker_available}")
    print(f"source: {mc.source}")
    print(f"session_id: {mc.session_id}")

    # These are no-ops when the broker is absent — no exceptions.
    result = mc.parametric_write("s1", key="color", value="blue")
    print(f"write (no broker): {result}")

    hits = mc.parametric_recall("s1", query="color")
    print(f"recall (no broker): {hits}")

    snap = mc.parametric_snapshot("s1")
    print(f"snapshot (no broker): {snap}")

    if trace_path:
        print(f"\ntrace written to {trace_path} (3× broker_unavailable expected)")
        print(f"inspect with: python scripts/analyze_trace.py {trace_path}")

    # --- With a broker (if mt_lnn.memory_broker is installed) --------------
    if mc.broker_available:
        print("\n--- Broker available: live parametric operations ---")
        mc.parametric_write("s1", key="favorite color", value="blue")
        mc.parametric_write("s1", key="favorite food", value="sushi")

        hits = mc.parametric_recall("s1", query="favorite color", top_k=3)
        print(f"recall 'favorite color': {hits}")

        # Snapshot → restore round-trip (bit-exact)
        snap = mc.parametric_snapshot("s1")
        mc.parametric_forget("s1")  # wipe session
        assert mc.parametric_recall("s1", query="favorite color") == []
        mc.parametric_restore("s1", snap)
        hits_after = mc.parametric_recall("s1", query="favorite color", top_k=3)
        print(f"recall after restore: {hits_after}")

        # Surgical forget of one binding
        mc.parametric_forget("s1", key="favorite color")
        hits_after_forget = mc.parametric_recall("s1", query="favorite color", top_k=3)
        print(f"recall after forget 'favorite color': {hits_after_forget}")
    elif os.environ.get("AWARENESS_USE_DEV_BROKER") == "1":
        # Dev-only path: use the SDK's bundled stub broker to exercise the
        # full integration contract before M1 publishes memory_broker.
        # The stub is a pure-Python mirror of ParametricMemory's 7-method
        # surface; it is NOT a semantic-recall engine and will be deleted
        # once the real broker ships.
        print("\n--- Dev stub broker (AWARENESS_USE_DEV_BROKER=1) ---")
        from memory_cloud._dev_stubs.broker import MemoryBroker as _DevBroker
        stub = _DevBroker(d_mem=64)
        mc = MemoryCloudParametric(
            client=real_client, memory_id="mem-demo", session_id="sess-demo",
            broker=stub,
        )
        print(f"broker_available: {mc.broker_available} (dev stub)")
        mc.parametric_write("s1", key="favorite color", value="blue")
        mc.parametric_write("s1", key="favorite food", value="sushi")
        hits = mc.parametric_recall("s1", query="favorite color", top_k=3)
        print(f"recall 'favorite color': {hits}")
        snap = mc.parametric_snapshot("s1")
        mc.parametric_forget("s1")
        assert mc.parametric_recall("s1", query="favorite color") == []
        mc.parametric_restore("s1", snap)
        print(f"recall after restore: {mc.parametric_recall('s1', query='favorite color', top_k=3)}")
    else:
        print("\nmt_lnn.memory_broker not installed — skipping live operations.")
        print("Install with: pip install 'awareness-memory-cloud[parametric]'")
        print("Or, for dev-only end-to-end demo: AWARENESS_USE_DEV_BROKER=1 python -m examples.parametric_quickstart")

    # --- Shared surface (works with or without broker) ---------------------
    # memory_search dials the daemon/cloud, so a mock keeps this last demo
    # runnable on any machine.
    mock_mc = MemoryCloudParametric(
        client=_mock_cloud_client(), memory_id="mem-demo", session_id="sess-demo",
    )
    tools = mock_mc.get_tool_functions()
    print(f"\ntool functions: {[t['name'] for t in tools]}")
    print(f"memory_search: {mock_mc.memory_search('test query')}")


if __name__ == "__main__":
    main()
