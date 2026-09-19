"""SDK-level structured trace for memory operations (F-069).

Produces the runtime evidence consumed by GOVERNANCE.md's direction
review (§5): recall routes/hits/latency, broker degradation frequency,
migration binding counts.

Design:
- Envelope borrowed from M1's ``JsonlMetricWriter`` —
  ``{ts, event, session_id, channel, ...fields}``, one JSON per line —
  so SDK and M1 events can be joined by ``session_id`` when the broker
  lands.  Extended field naming follows OpenTelemetry GenAI semantic
  conventions (``gen_ai.*``) where applicable; a documented mapping
  (below) keeps a future OTel bridge to ~20 lines.  No OTel dependency
  in the core package.
- Default OFF: ``trace_path=None`` (or unset ``AWARENESS_TRACE_PATH``)
  yields a singleton no-op writer with zero overhead.
- hash-only by default: content is recorded as ``content_bytes`` +
  ``content_hash`` (sha256, first 16 hex chars).  ``full_content=True``
  opts in to recording raw text.
- Never throws: any write failure silently disables the writer for the
  rest of its life (same philosophy as the daemon's log-writer).

OTel mapping (documented, not code)::

    event "recall"  -> span "memory recall"    gen_ai.operation.name="memory.recall"
    event "write"   -> span "memory write"     gen_ai.operation.name="memory.write"
    event "forget"  -> span "memory forget"    gen_ai.operation.name="memory.forget"
    session_id      -> gen_ai.session.id (custom, non-standard)
    route           -> memory.route (custom, non-standard)
"""

import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

CHANNEL = "memory_trace"

# ADR-003: envelope schema version. Bump on any vocabulary/field-semantics
# change (which requires an ADR per F-069). Analyzers treat a missing `v`
# as 1 (files written before ADR-003).
SCHEMA_VERSION = 1

ENV_TRACE_PATH = "AWARENESS_TRACE_PATH"
ENV_TRACE_MAX_BYTES = "AWARENESS_TRACE_MAX_BYTES"
ENV_TRACE_MIN_INTERVAL = "AWARENESS_TRACE_MIN_INTERVAL_MS"

# F-072 sampling classes.  min-interval throttling (default OFF) applies ONLY
# to high-frequency success events; errors and rare events are never sampled
# (industry practice: error paths outrank success paths for evidence value).
MIN_INTERVAL_ELIGIBLE = frozenset({"recall", "write"})
NEVER_SAMPLED = frozenset({"broker_unavailable", "transport_error", "forget", "conflict_forget"})


def _hash16(text: str) -> str:
    """sha256 of text, first 16 hex chars — stable, non-reversible."""
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()[:16]


def _content_fields(content: Any, full_content: bool) -> Dict[str, Any]:
    """Content summary fields: bytes + hash always; raw text only on opt-in."""
    text = content if isinstance(content, str) else str(content)
    fields: Dict[str, Any] = {
        "content_bytes": len(text.encode("utf-8", errors="replace")),
        "content_hash": _hash16(text),
    }
    if full_content:
        fields["content"] = text
    return fields


class NullTraceWriter:
    """No-op writer — the default when tracing is off. Zero overhead."""

    def write(self, event: str, fields: Optional[Dict[str, Any]] = None) -> None:
        pass

    def close(self) -> None:
        pass


class MemoryTraceWriter:
    """Append-only JSONL trace writer. Never raises.

    static fields (channel, session_id) are stamped into every event.
    On any I/O failure the writer disables itself permanently — a broken
    trace must never break memory operations.

    ``max_bytes`` (optional, default off) rotates the file once its size
    reaches the limit: the current file is moved to ``<path>.1`` (replacing
    any previous rotation) and writing continues on a fresh file.  A failed
    rotation counts as an I/O failure — the writer disables itself.

    ``min_interval_ms`` (optional, default off, F-072) throttles the eligible
    success events (``recall``/``write``): within the window, further events
    of the same type are counted and the next emitted event carries the
    accumulated ``_suppressed_count`` — magnitude survives, duplicate density
    does not.  Errors and rare events (NEVER_SAMPLED) always pass.
    ``close()`` flushes any pending suppressed count as a final row, so an
    end-of-run window is never silently dropped.
    """

    def __init__(self, path: str, session_id: str = "default",
                 max_bytes: Optional[int] = None,
                 min_interval_ms: Optional[int] = None):
        self.path = path
        self.session_id = session_id
        self.max_bytes = max_bytes
        self._min_interval = max(0.0, (min_interval_ms or 0) / 1000.0)
        self._static = {"channel": CHANNEL, "session_id": session_id, "v": SCHEMA_VERSION}
        self._lock = threading.Lock()
        self._disabled = False
        self._fh = None
        self._last_emit: Dict[str, float] = {}
        self._suppressed: Dict[str, int] = {}
        try:
            parent = os.path.dirname(os.path.abspath(path))
            if parent:
                os.makedirs(parent, exist_ok=True)
            self._fh = open(path, "a", encoding="utf-8")
        except Exception:
            self._fh = None
            self._disabled = True

    def write(self, event: str, fields: Optional[Dict[str, Any]] = None) -> None:
        if self._disabled or self._fh is None:
            return
        try:
            with self._lock:
                if self._should_suppress_locked(event):
                    return
                row = self._make_row(event, fields)
                suppressed = self._suppressed.pop(event, 0)
                if suppressed:
                    row["_suppressed_count"] = suppressed
                self._emit_row_locked(row)
        except Exception:
            self._disable()

    def _make_row(self, event: str, fields: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        row: Dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **self._static,
        }
        if fields:
            row.update(fields)
        return row

    def _emit_row_locked(self, row: Dict[str, Any]) -> None:
        """Caller holds the lock.  Rotation + append + flush.  Raises on I/O
        failure; write()/close() convert that into self-disable — never throws
        to the caller."""
        if self.max_bytes is not None and self._fh.tell() >= self.max_bytes:
            self._rotate_locked()
            if self._fh is None:
                return
        self._fh.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
        self._fh.flush()

    def _should_suppress_locked(self, event: str) -> bool:
        """F-072 min-interval decision. Caller holds the lock. Off → False."""
        if self._min_interval <= 0.0 or event not in MIN_INTERVAL_ELIGIBLE:
            return False
        now = time.monotonic()
        last = self._last_emit.get(event)
        if last is not None and (now - last) < self._min_interval:
            self._suppressed[event] = self._suppressed.get(event, 0) + 1
            return True
        self._last_emit[event] = now
        return False

    def _rotate_locked(self) -> None:
        """Rotate to <path>.1. Caller holds the lock; raises on I/O failure
        (write() converts that into self-disable — never throws)."""
        assert self._fh is not None
        self._fh.close()
        self._fh = None
        os.replace(self.path, self.path + ".1")
        self._fh = open(self.path, "a", encoding="utf-8")

    def _disable(self) -> None:
        self._disabled = True
        try:
            if self._fh is not None:
                self._fh.close()
        except Exception:
            pass
        self._fh = None

    @property
    def disabled(self) -> bool:
        return self._disabled

    def close(self) -> None:
        """Flush pending suppressed counts (F-072), then disable.

        A run-end window must not lose magnitude information: each event type
        with a pending suppressed count emits one final row carrying it.  The
        flush bypasses the min-interval gate by design (a flush row emitted
        inside its own throttle window would otherwise suppress itself).
        Idempotent; never raises.
        """
        with self._lock:
            pending = list(self._suppressed.items())
            self._suppressed.clear()
            for event, count in pending:
                if not count or self._fh is None:
                    continue
                try:
                    row = self._make_row(event, {"_suppressed_count": count})
                    self._emit_row_locked(row)
                except Exception:
                    self._disable()
                    break
        self._disable()

    def __enter__(self) -> "MemoryTraceWriter":
        return self

    def __exit__(self, *_) -> None:
        self.close()


def resolve_trace_writer(
    trace_path: Optional[str] = None,
    session_id: str = "default",
    max_bytes: Optional[int] = None,
    min_interval_ms: Optional[int] = None,
) -> Any:
    """Return a MemoryTraceWriter when tracing is on, else the Null no-op.

    Precedence: explicit ``trace_path`` > ``AWARENESS_TRACE_PATH`` env > off.
    Rotation limit: explicit ``max_bytes`` > ``AWARENESS_TRACE_MAX_BYTES``
    env (integer) > no rotation.  Min-interval (F-072): explicit
    ``min_interval_ms`` > ``AWARENESS_TRACE_MIN_INTERVAL_MS`` env (integer)
    > off.  Invalid env values are ignored (off).
    """
    path = trace_path or os.environ.get(ENV_TRACE_PATH) or ""
    if not path.strip():
        return NullTraceWriter()
    if max_bytes is None:
        raw = os.environ.get(ENV_TRACE_MAX_BYTES, "")
        try:
            max_bytes = int(raw) if raw.strip() else None
        except ValueError:
            max_bytes = None
    if min_interval_ms is None:
        raw = os.environ.get(ENV_TRACE_MIN_INTERVAL, "")
        try:
            min_interval_ms = int(raw) if raw.strip() else None
        except ValueError:
            min_interval_ms = None
    return MemoryTraceWriter(
        path.strip(), session_id=session_id,
        max_bytes=max_bytes, min_interval_ms=min_interval_ms,
    )


# ---------------------------------------------------------------------------
# Semantic emit helpers — call sites use these instead of raw write() so the
# event vocabulary stays in one place (F-069: vocabulary changes need an ADR).
# ---------------------------------------------------------------------------


def log_recall(
    writer: Any,
    *,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    route: str = "cascade",
    hit: bool = False,
    n_results: int = 0,
    latency_ms: Optional[float] = None,
) -> None:
    """route: parametric | cascade | daemon | cloud."""
    fields: Dict[str, Any] = {
        "gen_ai.operation.name": "memory.recall",
        "route": route,
        "hit": 1 if hit else 0,
        "n_results": n_results,
    }
    if trace_id:
        fields["trace_id"] = trace_id
    if latency_ms is not None:
        fields["latency_ms"] = round(latency_ms, 3)
    if session_id:
        fields["session_id"] = session_id  # override client-prefix static
    writer.write("recall", fields)


def log_write(
    writer: Any,
    *,
    session_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    content: Any = "",
    full_content: bool = False,
) -> None:
    fields: Dict[str, Any] = {"gen_ai.operation.name": "memory.write"}
    fields.update(_content_fields(content, full_content))
    if trace_id:
        fields["trace_id"] = trace_id
    if session_id:
        fields["session_id"] = session_id  # override client-prefix static
    writer.write("write", fields)


def log_forget(writer: Any, *, key: Any = None,
               session_id: Optional[str] = None) -> None:
    fields: Dict[str, Any] = {"gen_ai.operation.name": "memory.forget"}
    if key is not None:
        fields["key_hash"] = _hash16(str(key))
    if session_id:
        fields["session_id"] = session_id  # override client-prefix static
    writer.write("forget", fields)


def log_snapshot(
    writer: Any,
    *,
    session_id: Optional[str] = None,
    binding_count: Optional[int] = None,
    state_bytes: Optional[int] = None,
) -> None:
    fields: Dict[str, Any] = {"gen_ai.operation.name": "memory.snapshot"}
    if binding_count is not None:
        fields["binding_count"] = binding_count
    if state_bytes is not None:
        fields["state_bytes"] = state_bytes
    if session_id:
        fields["session_id"] = session_id  # override client-prefix static
    writer.write("snapshot", fields)


def log_restore(
    writer: Any,
    *,
    session_id: Optional[str] = None,
    binding_count: Optional[int] = None,
    state_bytes: Optional[int] = None,
) -> None:
    fields: Dict[str, Any] = {"gen_ai.operation.name": "memory.restore"}
    if binding_count is not None:
        fields["binding_count"] = binding_count
    if state_bytes is not None:
        fields["state_bytes"] = state_bytes
    if session_id:
        fields["session_id"] = session_id  # override client-prefix static
    writer.write("restore", fields)


def log_conflict_forget(
    writer: Any,
    *,
    session_id: Optional[str] = None,
    old_key: Any = None,
    new_key: Any = None,
) -> None:
    """Emitted when a conflict decision (this repo's card-evolution, F-066)
    executes forget(old)+write(new) at the parametric layer.

    Note: the current emitter for this event is the future JS↔Python broker
    bridge (the conflict decision lives in the daemon, F-066); the Python
    vocabulary slot is reserved so the bridge can use it without an ADR.
    """
    fields: Dict[str, Any] = {"gen_ai.operation.name": "memory.conflict_forget"}
    if old_key is not None:
        fields["old_key_hash"] = _hash16(str(old_key))
    if new_key is not None:
        fields["new_key_hash"] = _hash16(str(new_key))
    if session_id:
        fields["session_id"] = session_id  # override client-prefix static
    writer.write("conflict_forget", fields)


def log_degrade(writer: Any, *, op: str, reason: str,
                session_id: Optional[str] = None) -> None:
    """Any silent-degradation path emits this — degradation must be observable."""
    fields = {"op": op, "reason": reason}
    if session_id:
        fields["session_id"] = session_id  # override client-prefix static
    writer.write("broker_unavailable", fields)


def log_transport_error(
    writer: Any,
    *,
    op: str,
    route: str,
    error_class: str,
    status: Optional[int] = None,
    latency_ms: Optional[float] = None,
    trace_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> None:
    """HTTP transport failure on the daemon/cloud path (F-072, event 8/8).

    error_class: connect | timeout | http_status | other.  ``status`` is the
    HTTP status code for http_status.  Content-free by design (hash-only
    discipline); error events are never sampled (NEVER_SAMPLED).
    """
    fields: Dict[str, Any] = {
        "gen_ai.operation.name": "memory.transport_error",
        "op": op,
        "route": route,
        "error_class": error_class,
    }
    if status is not None:
        fields["status"] = status
    if latency_ms is not None:
        fields["latency_ms"] = round(latency_ms, 3)
    if trace_id:
        fields["trace_id"] = trace_id
    if session_id:
        fields["session_id"] = session_id  # override client-prefix static
    writer.write("transport_error", fields)
