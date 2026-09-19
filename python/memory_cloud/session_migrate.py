"""Session migration for the parametric memory layer.

Exports and imports parametric-memory sessions via ``MemoryBroker``
snapshot/restore, packaged in the same zip+JSONL convention used by
``memory_cloud.export_reader``.

Bit-exactness covers the **parametric layer only** — the (F, z) fast-weight
state and the decode lexicon. The SQLite episodic layer (memories,
knowledge_cards, timeline) is NOT in the guarantee: it is a separate
concern with its own export path (``client.export_memory_package``).
Both layers are independently exportable; this module handles only the
parametric one.

Usage::

    from memory_cloud.session_migrate import export_session, import_session

    # Process A: write → snapshot → exit
    export_session(broker, session_id, "session_A.zip")

    # Process B: restore → recall (all bindings hit)
    import_session(broker, session_id, "session_A.zip")
    hits = broker.recall(session_id, query="favorite color")

CLI::

    python -m memory_cloud.session_migrate export --session-id s1 --output session.zip
    python -m memory_cloud.session_migrate import --session-id s1 --input session.zip
"""

import argparse
import io
import json
import logging
import sys
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from memory_cloud.tracing import log_snapshot, log_restore

logger = logging.getLogger(__name__)

_MIGRATE_FORMAT = "parametric-session-migrate-v1"


def export_session(
    broker: Any,
    session_id: str,
    output_path: str,
    trace: Optional[Any] = None,
) -> str:
    """Export a parametric session to a zip archive.

    The archive contains:
    - ``manifest.json`` — format identifier, session id, timestamp
    - ``parametric/snapshot.json`` — broker.snapshot() output (base64 tensors)
    - ``parametric/bindings.jsonl`` — one JSON line per binding (key, value)
                                      for human inspection and non-binary restore

    Bit-exactness: the snapshot.json payload is the authoritative restore
    source. bindings.jsonl is informational — restore reads snapshot.json.

    Args:
        broker: A MemoryBroker-like object with snapshot() and sessions().
        session_id: The session to export.
        output_path: Where to write the zip file.
        trace: Optional trace writer (e.g. ``client._trace_writer``); a
            ``snapshot`` event is emitted on success (F-069).

    Returns:
        The output path.
    """
    snapshot = broker.snapshot(session_id)
    if snapshot is None:
        raise ValueError(f"Session {session_id!r} has no state to export (never written or forgotten)")

    # Extract bindings for the JSONL sidecar (informational, not restore source).
    bindings = []
    if isinstance(snapshot.get("lexicon"), list):
        for entry in snapshot["lexicon"]:
            if isinstance(entry, list) and len(entry) >= 1:
                bindings.append({"value": entry[0]})

    manifest = {
        "format": _MIGRATE_FORMAT,
        "session_id": session_id,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "d_mem": snapshot.get("d_mem"),
        "read_rule": snapshot.get("read_rule"),
        "binding_count": len(bindings),
    }

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        zf.writestr("parametric/snapshot.json", json.dumps(snapshot, ensure_ascii=False))
        jsonl_lines = "\n".join(json.dumps(b, ensure_ascii=False) for b in bindings)
        zf.writestr("parametric/bindings.jsonl", jsonl_lines + "\n" if jsonl_lines else "")

    if trace is not None:
        try:
            log_snapshot(trace, binding_count=len(bindings), session_id=session_id)
        except Exception:
            pass  # trace must never break migration

    logger.info("Exported session %s to %s (%d bindings)",
                session_id, output_path, len(bindings))
    return output_path


def import_session(
    broker: Any,
    session_id: str,
    input_path: str,
    trace: Optional[Any] = None,
) -> Dict[str, Any]:
    """Import a parametric session from a zip archive.

    Reads ``parametric/snapshot.json`` from the archive and calls
    ``broker.restore(session_id, snapshot)``. After restore, the session's
    state_bytes and per-binding recall are bit-exact with the pre-export state.

    On corrupt/invalid archive: raises ValueError with a descriptive message.
    The caller should expect recall to return chance-level results after a
    failed import (the session will have no state or garbage state).

    Args:
        broker: A MemoryBroker-like object with restore().
        session_id: The session id to restore into.
        input_path: Path to the zip archive.
        trace: Optional trace writer; a ``restore`` event is emitted on
            success (F-069).

    Returns:
        A dict with ``ok``, ``session_id``, ``binding_count``, and ``manifest``.
    """
    try:
        with zipfile.ZipFile(input_path, "r") as zf:
            manifest_bytes = zf.read("manifest.json")
            snapshot_bytes = zf.read("parametric/snapshot.json")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ValueError(f"Invalid session archive {input_path!r}: {exc}") from exc

    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"Corrupt manifest in {input_path!r}: {exc}") from exc

    if not isinstance(manifest, dict) or manifest.get("format") != _MIGRATE_FORMAT:
        raise ValueError(
            f"Unsupported archive format: expected {_MIGRATE_FORMAT!r}, "
            f"got {manifest.get('format') if isinstance(manifest, dict) else 'invalid'}"
        )

    try:
        snapshot = json.loads(snapshot_bytes.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"Corrupt snapshot in {input_path!r}: {exc}") from exc

    if not isinstance(snapshot, dict):
        raise ValueError(f"Snapshot payload is not a JSON object in {input_path!r}")

    broker.restore(session_id, snapshot)

    binding_count = manifest.get("binding_count", 0)
    if trace is not None:
        try:
            log_restore(trace, binding_count=binding_count, session_id=session_id)
        except Exception:
            pass  # trace must never break migration

    logger.info("Imported session %s from %s (%d bindings)",
                session_id, input_path, binding_count)

    return {
        "ok": True,
        "session_id": session_id,
        "binding_count": binding_count,
        "manifest": manifest,
    }


def _main() -> int:
    """CLI entry point: python -m memory_cloud.session_migrate export/import."""
    parser = argparse.ArgumentParser(
        prog="memory_cloud.session_migrate",
        description="Export/import parametric memory sessions.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_export = sub.add_parser("export", help="Export a session to a zip archive.")
    p_export.add_argument("--session-id", required=True, help="Session id to export.")
    p_export.add_argument("--output", required=True, help="Output zip file path.")
    p_export.add_argument("--broker-config", default=None, help="JSON string with broker config.")

    p_import = sub.add_parser("import", help="Import a session from a zip archive.")
    p_import.add_argument("--session-id", required=True, help="Session id to restore into.")
    p_import.add_argument("--input", required=True, help="Input zip file path.")
    p_import.add_argument("--broker-config", default=None, help="JSON string with broker config.")

    args = parser.parse_args()

    # Try to import the broker; degrade gracefully.
    try:
        from mt_lnn.memory_broker import MemoryBroker
    except ImportError:
        print("Error: mt_lnn.memory_broker is not installed. "
              "Install with: pip install 'awareness-memory-cloud[parametric]'",
              file=sys.stderr)
        return 1

    broker_config = {}
    if args.broker_config:
        try:
            broker_config = json.loads(args.broker_config)
        except json.JSONDecodeError as exc:
            print(f"Error: invalid --broker-config JSON: {exc}", file=sys.stderr)
            return 1

    broker = MemoryBroker(**broker_config)

    if args.command == "export":
        try:
            path = export_session(broker, args.session_id, args.output)
            print(f"Exported session {args.session_id} to {path}")
            return 0
        except (ValueError, KeyError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
    elif args.command == "import":
        try:
            result = import_session(broker, args.session_id, args.input)
            print(f"Imported session {result['session_id']} "
                  f"({result['binding_count']} bindings)")
            return 0
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1

    return 1


if __name__ == "__main__":
    sys.exit(_main())
