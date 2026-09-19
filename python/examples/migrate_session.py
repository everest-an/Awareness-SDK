"""Session migration example: cross-process parametric memory transfer.

Demonstrates:
1. Process A: write bindings → snapshot → export to zip → exit.
2. Process B: import from zip → restore → recall all bindings (exact hits).
3. Cross-directory migration (zip file lives in a different directory).
4. Bit-exactness: state_bytes and per-binding recall match pre-export.

This example uses a mock broker so it runs without mt_lnn installed.
In production, replace MockBroker with mt_lnn.memory_broker.MemoryBroker.

Run::

    python -m examples.migrate_session
"""

import json
import os
import tempfile

from memory_cloud.session_migrate import export_session, import_session


class MockBroker:
    """Minimal broker mock that supports snapshot/restore/write/recall/state_bytes.

    Mimics the interface of mt_lnn.memory_broker.MemoryBroker for demonstration.
    """

    _SNAP_FORMAT = "parametric-memory-v1"

    def __init__(self, d_mem=128):
        self.d_mem = d_mem
        self._sessions = {}

    def write(self, session_id, key, value, update_rule=None):
        if session_id not in self._sessions:
            self._sessions[session_id] = {"bindings": {}, "read_rule": "sum"}
        self._sessions[session_id]["bindings"][key] = value
        self._sessions[session_id]["read_rule"] = update_rule or "sum"

    def recall(self, session_id, query, top_k=5, candidates=None):
        s = self._sessions.get(session_id)
        if s is None:
            return [(None, 0.0)] * top_k
        bindings = s["bindings"]
        if query in bindings:
            return [(bindings[query], 1.0)] + [(None, 0.0)] * (top_k - 1)
        return [(None, 0.0)] * top_k

    def forget(self, session_id, key=None):
        s = self._sessions.get(session_id)
        if s is None:
            return False
        if key is None:
            s["bindings"].clear()
            s["read_rule"] = None
        else:
            s["bindings"].pop(key, None)
        return True

    def snapshot(self, session_id):
        s = self._sessions.get(session_id)
        if s is None:
            return None
        return {
            "format": self._SNAP_FORMAT,
            "d_mem": self.d_mem,
            "read_rule": s["read_rule"],
            "F": "base64-F-data",
            "z": "base64-z-data",
            "lexicon": [[v, f"base64-vec-{i}"] for i, v in enumerate(s["bindings"].values())],
            "_mock_bindings": s["bindings"],  # mock-only: preserve bindings for restore
        }

    def restore(self, session_id, snap):
        if snap.get("format") != self._SNAP_FORMAT:
            raise ValueError(f"unknown snapshot format {snap.get('format')!r}")
        self._sessions[session_id] = {
            "bindings": dict(snap.get("_mock_bindings", {})),
            "read_rule": snap.get("read_rule"),
        }

    def state_bytes(self, session_id):
        s = self._sessions.get(session_id)
        if s is None:
            return 0
        return self.d_mem * self.d_mem * 4 + self.d_mem * 4

    def sessions(self):
        return list(self._sessions.keys())


def main():
    with tempfile.TemporaryDirectory() as tmpdir:
        # --- Process A: write → snapshot → export → exit -------------------
        print("=== Process A: writing bindings ===")
        broker_a = MockBroker(d_mem=128)
        session_id = "session-cross-process"

        bindings = {
            "favorite color": "blue",
            "favorite food": "sushi",
            "project name": "Awareness SDK",
            "database choice": "pgvector",
        }
        for key, value in bindings.items():
            broker_a.write(session_id, key=key, value=value)

        # Verify all bindings are recallable before export
        for key, expected in bindings.items():
            hits = broker_a.recall(session_id, query=key, top_k=1)
            assert hits[0][0] == expected, f"pre-export recall failed for {key!r}"
        print(f"  Pre-export: {len(bindings)} bindings verified")

        state_before = broker_a.state_bytes(session_id)
        print(f"  state_bytes before export: {state_before}")

        # Export to a zip in a DIFFERENT directory (cross-directory migration)
        export_dir = os.path.join(tmpdir, "exports")
        os.makedirs(export_dir, exist_ok=True)
        export_path = os.path.join(export_dir, f"{session_id}.zip")
        export_session(broker_a, session_id, export_path)
        print(f"  Exported to: {export_path}")

        # Process A exits — broker_a is garbage collected
        del broker_a

        # --- Process B: import → restore → recall all ----------------------
        print("\n=== Process B: importing and recalling ===")
        broker_b = MockBroker(d_mem=128)

        # Before import, session doesn't exist → recall returns None
        hits = broker_b.recall(session_id, query="favorite color", top_k=1)
        assert hits[0][0] is None, "should have no memory before import"
        print("  Pre-import recall: None (expected)")

        # Import from the cross-directory zip
        result = import_session(broker_b, session_id, export_path)
        print(f"  Imported: {result['binding_count']} bindings")

        # Verify state_bytes matches
        state_after = broker_b.state_bytes(session_id)
        assert state_after == state_before, \
            f"state_bytes mismatch: {state_after} != {state_before}"
        print(f"  state_bytes after import: {state_after} (bit-exact ✓)")

        # Verify ALL bindings are recallable after import
        all_hit = True
        for key, expected in bindings.items():
            hits = broker_b.recall(session_id, query=key, top_k=1)
            if hits[0][0] != expected:
                print(f"  ✗ Recall failed for {key!r}: got {hits[0][0]!r}")
                all_hit = False
            else:
                print(f"  ✓ {key!r} → {hits[0][0]!r}")

        assert all_hit, "Not all bindings were recalled after import"
        print(f"\n  All {len(bindings)} bindings recalled successfully (bit-exact)")

        # --- Error case: corrupt archive → chance-level recall ------------
        print("\n=== Error case: corrupt archive ===")
        corrupt_path = os.path.join(tmpdir, "corrupt.zip")
        with open(corrupt_path, "wb") as f:
            f.write(b"not a zip file")

        broker_c = MockBroker(d_mem=128)
        try:
            import_session(broker_c, "bad-session", corrupt_path)
            print("  ERROR: should have raised ValueError")
        except ValueError as exc:
            print(f"  Correctly rejected corrupt archive: {exc}")
            # Recall on the failed-import session should be chance level
            hits = broker_c.recall("bad-session", query="anything", top_k=1)
            assert hits[0][0] is None, "should return None after failed import"
            print("  Recall after failed import: None (chance level ✓)")

    print("\n=== All migration checks passed ===")


if __name__ == "__main__":
    main()
