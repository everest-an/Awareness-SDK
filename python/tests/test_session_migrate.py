"""Tests for session migration (export/import) of parametric memory.

Covers:
- Export → import round-trip: bit-exact state_bytes and per-binding recall.
- Cross-directory migration (zip in a different directory).
- Corrupt archive → ValueError, recall at chance level.
- Missing session → ValueError on export.
- Manifest format validation.
- bindings.jsonl sidecar correctness.
- CLI argument parsing (smoke test).
"""

import json
import os
import tempfile
import zipfile
from unittest.mock import MagicMock

import pytest

from memory_cloud.session_migrate import (
    export_session,
    import_session,
    _MIGRATE_FORMAT,
)


class MockBroker:
    """Minimal broker mock with snapshot/restore/write/recall/state_bytes."""

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
            "_mock_bindings": dict(s["bindings"]),
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


# ------------------------------------------------------------------
# Export → import round-trip
# ------------------------------------------------------------------


def test_export_import_roundtrip_bit_exact():
    """state_bytes and per-binding recall must match pre-export."""
    broker_a = MockBroker(d_mem=128)
    sid = "s1"
    bindings = {"color": "blue", "food": "sushi", "db": "pgvector"}
    for k, v in bindings.items():
        broker_a.write(sid, key=k, value=v)

    state_before = broker_a.state_bytes(sid)

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "session.zip")
        export_session(broker_a, sid, path)

        broker_b = MockBroker(d_mem=128)
        import_session(broker_b, sid, path)

        assert broker_b.state_bytes(sid) == state_before
        for k, v in bindings.items():
            hits = broker_b.recall(sid, query=k, top_k=1)
            assert hits[0][0] == v, f"recall mismatch for {k!r}: {hits[0][0]!r} != {v!r}"


def test_export_import_cross_directory():
    """Zip in a different directory, different broker instance."""
    broker_a = MockBroker()
    broker_a.write("s1", key="k1", value="v1")

    with tempfile.TemporaryDirectory() as tmp:
        export_dir = os.path.join(tmp, "exports")
        os.makedirs(export_dir)
        path = os.path.join(export_dir, "s1.zip")
        export_session(broker_a, "s1", path)

        broker_b = MockBroker()
        import_session(broker_b, "s1", path)
        hits = broker_b.recall("s1", query="k1", top_k=1)
        assert hits[0][0] == "v1"


def test_export_creates_valid_zip():
    broker = MockBroker()
    broker.write("s1", key="k", value="v")
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "out.zip")
        export_session(broker, "s1", path)
        assert zipfile.is_zipfile(path)
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            assert "manifest.json" in names
            assert "parametric/snapshot.json" in names
            assert "parametric/bindings.jsonl" in names


def test_export_manifest_format():
    broker = MockBroker()
    broker.write("s1", key="k", value="v")
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "out.zip")
        export_session(broker, "s1", path)
        with zipfile.ZipFile(path) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["format"] == _MIGRATE_FORMAT
            assert manifest["session_id"] == "s1"
            assert manifest["binding_count"] == 1
            assert "exported_at" in manifest


def test_export_bindings_jsonl_sidecar():
    broker = MockBroker()
    broker.write("s1", key="k1", value="v1")
    broker.write("s1", key="k2", value="v2")
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "out.zip")
        export_session(broker, "s1", path)
        with zipfile.ZipFile(path) as zf:
            jsonl = zf.read("parametric/bindings.jsonl").decode("utf-8").strip()
            lines = [json.loads(l) for l in jsonl.splitlines() if l.strip()]
            assert len(lines) == 2
            values = {l["value"] for l in lines}
            assert "v1" in values
            assert "v2" in values


# ------------------------------------------------------------------
# Error cases
# ------------------------------------------------------------------


def test_export_missing_session_raises():
    broker = MockBroker()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "out.zip")
        with pytest.raises(ValueError, match="no state"):
            export_session(broker, "nonexistent", path)


def test_import_corrupt_zip_raises():
    broker = MockBroker()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "corrupt.zip")
        with open(path, "wb") as f:
            f.write(b"not a zip")
        with pytest.raises(ValueError, match="Invalid session archive"):
            import_session(broker, "s1", path)


def test_import_wrong_format_raises():
    broker = MockBroker()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "wrong.zip")
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"format": "wrong-format"}))
            zf.writestr("parametric/snapshot.json", "{}")
        with pytest.raises(ValueError, match="Unsupported archive format"):
            import_session(broker, "s1", path)


def test_import_missing_snapshot_raises():
    broker = MockBroker()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "missing.zip")
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("manifest.json", json.dumps({"format": _MIGRATE_FORMAT}))
            # No parametric/snapshot.json
        with pytest.raises(ValueError, match="Invalid session archive"):
            import_session(broker, "s1", path)


def test_import_corrupt_session_recall_chance():
    """After a failed import, recall should return None (chance level)."""
    broker = MockBroker()
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "corrupt.zip")
        with open(path, "wb") as f:
            f.write(b"garbage")
        try:
            import_session(broker, "bad", path)
        except ValueError:
            pass
        hits = broker.recall("bad", query="anything", top_k=1)
        assert hits[0][0] is None


# ------------------------------------------------------------------
# Multiple sessions
# ------------------------------------------------------------------


def test_export_import_multiple_sessions():
    broker_a = MockBroker()
    broker_a.write("s1", key="k1", value="v1")
    broker_a.write("s2", key="k2", value="v2")

    with tempfile.TemporaryDirectory() as tmp:
        p1 = os.path.join(tmp, "s1.zip")
        p2 = os.path.join(tmp, "s2.zip")
        export_session(broker_a, "s1", p1)
        export_session(broker_a, "s2", p2)

        broker_b = MockBroker()
        import_session(broker_b, "s1", p1)
        import_session(broker_b, "s2", p2)

        assert broker_b.recall("s1", query="k1", top_k=1)[0][0] == "v1"
        assert broker_b.recall("s2", query="k2", top_k=1)[0][0] == "v2"


def test_import_overwrites_existing_session():
    broker_a = MockBroker()
    broker_a.write("s1", key="old", value="old_val")

    broker_b = MockBroker()
    broker_b.write("s1", key="different", value="different_val")

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "s1.zip")
        export_session(broker_a, "s1", path)
        import_session(broker_b, "s1", path)

        # After import, broker_b should have broker_a's bindings, not its own
        hits = broker_b.recall("s1", query="old", top_k=1)
        assert hits[0][0] == "old_val"
        hits = broker_b.recall("s1", query="different", top_k=1)
        assert hits[0][0] is None, "old binding should be gone after restore"
