"""Parametric memory integration for Awareness Memory Cloud.

Bridges the SDK's session/retrieval/storage surface to M1's ``MemoryBroker``
(git: ``github.com/everest-an/M1``, package ``mt_lnn.memory_broker``).  The
broker wraps ``ParametricMemory`` — a fast-weight associative matrix whose
state IS its parameters: O(1) per-session read/write, surgical ``forget``,
and bit-exact ``snapshot``/``restore``.

Dependency direction is **SDK → M1** (one-way).  This module never imports
M1 source files directly; it goes through the ``mt_lnn.memory_broker`` package
only.  When that package is not installed the adapter still constructs and
operates — every broker call degrades gracefully to a logged warning and the
adapter falls back to the base class's daemon/cloud channel.

Usage::

    from memory_cloud import MemoryCloudClient
    from memory_cloud.integrations.parametric import MemoryCloudParametric

    client = MemoryCloudClient(base_url="...", api_key="...")
    mc = MemoryCloudParametric(client=client, memory_id="mem-xxx")

    # Transparent injection (same as langchain/crewai/… adapters)
    mc.wrap_llm(openai_client)

    # Explicit tools
    tools = mc.get_tool_functions()

    # Direct parametric recall / write
    hits = mc.parametric_recall("session-A", query="favorite color")
    mc.parametric_write("session-A", key="favorite color", value="blue")
"""

import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

from memory_cloud.integrations._base import MemoryCloudBaseAdapter
from memory_cloud.tracing import (
    log_recall,
    log_write,
    log_forget,
    log_snapshot,
    log_restore,
    log_degrade,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Broker import — optional, degrades gracefully when mt_lnn is absent.
# ---------------------------------------------------------------------------

try:
    from mt_lnn.memory_broker import MemoryBroker  # type: ignore[import-not-found]
    _BROKER_AVAILABLE = True
except Exception:
    MemoryBroker = None  # type: ignore[assignment, misc]
    _BROKER_AVAILABLE = False


class MemoryCloudParametric(MemoryCloudBaseAdapter):
    """Parametric-memory adapter for Awareness Memory Cloud.

    Provides the same surface as the langchain/crewai/praisonai/autogen
    adapters (wrap_llm, wrap_function, get_tool_functions, memory_search,
    memory_write, memory_insights) plus direct parametric operations:

    - ``parametric_write``: bind key → value into a broker session
    - ``parametric_recall``: O(1) exact recall from a broker session
    - ``parametric_forget``: surgically erase one binding or a whole session
    - ``parametric_snapshot`` / ``parametric_restore``: bit-exact session
      migration (used by the session-migration CLI)

    When ``mt_lnn.memory_broker`` is not installed, every parametric_* call
    logs a warning and returns an empty/chance result.  The inherited
    daemon/cloud retrieval path (``client.py`` at ``localhost:37800``) is
    untouched and remains the primary search channel.
    """

    _default_source = "parametric"

    def __init__(
        self,
        client: Any,
        memory_id: str,
        *,
        broker: Optional[Any] = None,
        broker_config: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Initialise the parametric adapter.

        Args:
            client: A ``MemoryCloudClient`` instance (daemon/cloud channel).
            memory_id: Target memory id.
            broker: Pre-constructed ``MemoryBroker`` instance.  If omitted
                and ``mt_lnn.memory_broker`` is installed, one is created
                from ``broker_config``.
            broker_config: kwargs forwarded to ``MemoryBroker()`` when
                ``broker`` is None (e.g. ``d_mem``, ``update_rule``,
                ``decay``, ``eta``).
            **kwargs: Forwarded to ``MemoryCloudBaseAdapter.__init__``.
        """
        super().__init__(client, memory_id, **kwargs)

        if broker is not None:
            self._broker = broker
        elif _BROKER_AVAILABLE:
            try:
                self._broker = MemoryBroker(**(broker_config or {}))
            except Exception as exc:
                logger.warning(
                    "MemoryBroker construction failed (%s); "
                    "parametric operations will degrade to no-ops.",
                    exc,
                )
                self._broker = None
        else:
            self._broker = None
            logger.debug(
                "mt_lnn.memory_broker not installed; "
                "parametric operations will degrade to no-ops."
            )

    # ------------------------------------------------------------------
    # Broker availability
    # ------------------------------------------------------------------

    @property
    def broker_available(self) -> bool:
        """True when a live ``MemoryBroker`` instance is attached."""
        return self._broker is not None

    def _trace(self) -> Any:
        """The client's trace writer (NullTraceWriter when tracing is off)."""
        return getattr(self.client, "_trace_writer", None)

    def _require_broker(self) -> Any:
        """Return the broker or log a warning and return None."""
        if self._broker is None:
            logger.warning(
                "Parametric operation requested but MemoryBroker is not "
                "available (mt_lnn.memory_broker not installed or "
                "construction failed). Returning degraded result."
            )
        return self._broker

    # ------------------------------------------------------------------
    # Framework injection (same shape as the other four adapters)
    # ------------------------------------------------------------------

    def wrap_llm(self, llm_client: Any) -> None:
        """Wrap an OpenAI/Anthropic client for transparent memory injection."""
        from memory_cloud.interceptor import AwarenessInterceptor

        interceptor = AwarenessInterceptor(
            client=self.client,
            memory_id=self.memory_id,
            source=self.source,
            session_id=self._session_id,
            user_id=self.user_id,
            agent_role=self.agent_role,
            retrieve_limit=self.retrieve_limit,
            max_context_chars=self.max_context_chars,
            auto_remember=self.auto_remember,
            enable_extraction=self.enable_extraction,
            on_error=self.on_error,
        )

        client_type = type(llm_client).__module__
        if "openai" in client_type:
            interceptor.wrap_openai(llm_client)
        elif "anthropic" in client_type:
            interceptor.wrap_anthropic(llm_client)
        else:
            logger.warning(
                f"Unknown LLM client type: {type(llm_client).__name__}. "
                f"Attempting OpenAI-compatible wrapping."
            )
            interceptor.wrap_openai(llm_client)

    def wrap_function(self, fn: Callable) -> Callable:
        """Wrap a completion function for transparent memory injection."""
        from memory_cloud.interceptor import AwarenessInterceptor

        interceptor = AwarenessInterceptor(
            client=self.client,
            memory_id=self.memory_id,
            source=self.source,
            session_id=self._session_id,
            user_id=self.user_id,
            agent_role=self.agent_role,
            retrieve_limit=self.retrieve_limit,
            max_context_chars=self.max_context_chars,
            auto_remember=self.auto_remember,
            enable_extraction=self.enable_extraction,
            on_error=self.on_error,
        )
        return interceptor.register_function(fn)

    # ------------------------------------------------------------------
    # Direct parametric operations (broker-backed)
    # ------------------------------------------------------------------

    def parametric_write(
        self,
        session_id: str,
        key: Any,
        value: Any,
        update_rule: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Bind ``key → value`` into a broker session.

        Returns a dict with ``ok`` and ``session_id``.  When the broker is
        unavailable, ``ok`` is False and no exception is raised.
        """
        broker = self._require_broker()
        if broker is None:
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_write", reason="broker_unavailable", session_id=session_id)
            return {"ok": False, "session_id": session_id, "error": "broker_unavailable"}
        try:
            broker.write(session_id, key=key, value=value, update_rule=update_rule)
            tw = self._trace()
            if tw is not None:
                log_write(tw, content=str(value), session_id=session_id)
            return {"ok": True, "session_id": session_id}
        except Exception as exc:
            logger.warning("parametric_write failed: %s", exc)
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_write", reason=str(exc), session_id=session_id)
            return {"ok": False, "session_id": session_id, "error": str(exc)}

    def parametric_recall(
        self,
        session_id: str,
        query: Any,
        top_k: int = 5,
        candidates: Optional[List[int]] = None,
    ) -> List[Dict[str, Any]]:
        """O(1) exact recall from a broker session.

        Returns a list of ``{value, score}`` dicts (best first).  When the
        broker is unavailable or the session has no state, returns an empty
        list — never raises.
        """
        broker = self._require_broker()
        if broker is None:
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_recall", reason="broker_unavailable", session_id=session_id)
            return []
        try:
            hits = broker.recall(
                session_id, query=query, top_k=top_k, candidates=candidates,
            )
            # Duck-type the broker's recall return shape:
            # - M1's ParametricMemory returns List[Tuple[value, score]]
            # - Friendly brokers may return List[{"value": ..., "score": ...}]
            # - Structured hit objects (e.g. the feat/consolidation-policy
            #   RecallHit) expose .value/.score attributes
            # All must work — SDK does not pin a shape, only the per-item
            # fields {value, score} (or their tuple positions).
            valid: List[Dict[str, Any]] = []
            for h in hits:
                if isinstance(h, dict):
                    val, score = h.get("value"), h.get("score")
                elif isinstance(h, (tuple, list)):
                    val, score = h[0], h[1]
                else:
                    val, score = getattr(h, "value", None), getattr(h, "score", None)
                if val is not None:
                    valid.append({"value": val, "score": score})
            tw = self._trace()
            if tw is not None:
                log_recall(tw, route="parametric", hit=bool(valid),
                           n_results=len(valid), session_id=session_id)
            return valid
        except Exception as exc:
            logger.warning("parametric_recall failed: %s", exc)
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_recall", reason=str(exc), session_id=session_id)
            return []

    def parametric_forget(
        self,
        session_id: str,
        key: Any = None,
    ) -> Dict[str, Any]:
        """Erase one binding (``key`` given) or a whole session (``key=None``).

        Returns ``{"ok": True/False, "session_id": ...}``.
        """
        broker = self._require_broker()
        if broker is None:
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_forget", reason="broker_unavailable", session_id=session_id)
            return {"ok": False, "session_id": session_id, "error": "broker_unavailable"}
        try:
            removed = broker.forget(session_id, key=key)
            tw = self._trace()
            if tw is not None:
                log_forget(tw, key=key, session_id=session_id)
            return {"ok": removed, "session_id": session_id}
        except Exception as exc:
            logger.warning("parametric_forget failed: %s", exc)
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_forget", reason=str(exc), session_id=session_id)
            return {"ok": False, "session_id": session_id, "error": str(exc)}

    def parametric_snapshot(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Bit-exact session snapshot (base64 tensors + lexicon).

        Returns None when the broker is unavailable or the session does not
        exist.
        """
        broker = self._require_broker()
        if broker is None:
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_snapshot", reason="broker_unavailable", session_id=session_id)
            return None
        try:
            snap = broker.snapshot(session_id)
            tw = self._trace()
            if tw is not None and snap is not None:
                log_snapshot(
                    tw,
                    binding_count=len(snap.get("lexicon") or []),
                    session_id=session_id,
                )
            return snap
        except Exception as exc:
            logger.warning("parametric_snapshot failed: %s", exc)
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_snapshot", reason=str(exc), session_id=session_id)
            return None

    def parametric_restore(
        self,
        session_id: str,
        snapshot: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Restore a session from a snapshot dict (inverse of snapshot)."""
        broker = self._require_broker()
        if broker is None:
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_restore", reason="broker_unavailable", session_id=session_id)
            return {"ok": False, "session_id": session_id, "error": "broker_unavailable"}
        try:
            broker.restore(session_id, snapshot)
            tw = self._trace()
            if tw is not None:
                log_restore(
                    tw,
                    binding_count=len(snapshot.get("lexicon") or []),
                    session_id=session_id,
                )
            return {"ok": True, "session_id": session_id}
        except Exception as exc:
            logger.warning("parametric_restore failed: %s", exc)
            tw = self._trace()
            if tw is not None:
                log_degrade(tw, op="parametric_restore", reason=str(exc), session_id=session_id)
            return {"ok": False, "session_id": session_id, "error": str(exc)}

    def parametric_state_bytes(self, session_id: str) -> int:
        """Bytes of the session's (F, z) tensors — constant in #writes."""
        broker = self._require_broker()
        if broker is None:
            return 0
        try:
            return broker.state_bytes(session_id)
        except Exception:
            return 0

    def parametric_sessions(self) -> List[str]:
        """List broker session ids."""
        broker = self._require_broker()
        if broker is None:
            return []
        try:
            return broker.sessions()
        except Exception:
            return []
