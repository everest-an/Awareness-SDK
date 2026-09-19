"""Stub MemoryBroker that exposes the 7-method contract.

Wraps `_dev_stubs.parametric_memory.ParametricMemory` and exposes:

  - getActiveSessionId() → str | None
  - recall(session_id, query, top_k) → list[{value, score}]
  - write / forget / snapshot / restore
  - policyWrite(session_id, event)  (optional; SDK prefers it when present)

This object has the **same shape** as the M1 broker SDKs will use once
`memory_broker` is published. The SDK code paths under test consume
it via the same `broker=` constructor argument as a real broker would.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from .parametric_memory import ParametricMemory


class MemoryBroker:
    """Stub broker. Same 7-method surface as M1 memory_broker.MemoryBroker."""

    def __init__(self, d_mem: int = 128, active_session_id: Optional[str] = None):
        self._mem = ParametricMemory(d_mem=d_mem)
        self._active_session_id = active_session_id or os.environ.get(
            "AWARENESS_ACTIVE_SESSION_ID"
        )

    def getActiveSessionId(self) -> Optional[str]:
        return self._active_session_id

    def sessions(self) -> List[str]:
        return self._mem.sessions()

    def write(self, session_id: str, key, value, update_rule: Optional[str] = None) -> None:
        self._mem.write(session_id, key=key, value=value, update_rule=update_rule)

    def recall(
        self,
        session_id: str,
        query,
        top_k: int = 5,
        candidates=None,
    ) -> List[Dict[str, Any]]:
        hits = self._mem.recall(session_id, query=query, top_k=top_k, candidates=candidates)
        return [{"value": val, "score": score} for val, score in hits]

    def forget(self, session_id: str, key=None) -> bool:
        return self._mem.forget(session_id, key=key)

    def snapshot(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self._mem.snapshot(session_id)

    def restore(self, session_id: str, snap: Dict[str, Any]) -> None:
        self._mem.restore(session_id, snap)

    def state_bytes(self, session_id: str) -> int:
        return self._mem.state_bytes(session_id)

    def policyWrite(self, session_id: str, event: Dict[str, Any]) -> None:
        """Stub policyWrite: encodes event.category to update_rule if present,
        otherwise defaults to 'sum'. Mirrors what M1's policy_write contract
        is expected to provide (category → write rule dispatch)."""
        rule = "sum"
        if event.get("type") == "knowledge_card":
            rule = "sum"
        elif event.get("type") == "decision":
            rule = "delta"
        self.write(session_id, key=event.get("id") or event.get("title") or "anon",
                    value=event.get("content") or event.get("summary") or "",
                    update_rule=rule)
