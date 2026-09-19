"""Pure-Python stub mirroring `mt_lnn.parametric_memory.ParametricMemory`.

Mirrors the **7-method interface** that `MemoryBroker` (M1) exposes
(see `parametric.py`'s import contract):

  sessions()          → list[str]
  write(sid, key, value, update_rule=None)
  recall(sid, query, top_k=1, candidates=None) → [(value, score), ...]
  forget(sid, key=None) → bool
  snapshot(sid) → Optional[dict]   (format 'parametric-memory-v1')
  restore(sid, snap)
  state_bytes(sid) → int

This is NOT a semantic-recall engine — it uses deterministic feature
hashing (sha256 buckets) like M1's default text encoder. Exact-match
only. It exists to prove the **integration contract** is correct; when
M1 publishes `memory_broker`, this stub is replaced and tests in
`tests/test_real_broker_contract.py` should pass unchanged.
"""

from __future__ import annotations

import base64
import hashlib
from collections import OrderedDict
from typing import Dict, List, Optional, Sequence, Tuple, Union

import numpy as np

MemoryValue = Union[int, str]
_SNAP_FORMAT = "parametric-memory-v1"
_EPS = 1e-8


def _hash_vec(text: str, dim: int) -> np.ndarray:
    """sha256-bucketed unit vector. Same construction as M1's _hash_vec."""
    v = np.zeros(dim, dtype=np.float32)
    for i in range(max(dim, 32)):
        h = hashlib.sha256(f"{text}:{i}".encode()).digest()
        idx = int.from_bytes(h[:4], "big") % dim
        v[idx] += 1.0 if h[4] & 1 else -1.0
    norm = np.linalg.norm(v)
    if norm < 1e-6:
        return v
    return v / norm


class _Session:
    __slots__ = ("F", "z", "lex", "read_rule")

    def __init__(self, d: int):
        self.F = np.zeros((d, d), dtype=np.float32)
        self.z = np.zeros(d, dtype=np.float32)
        self.lex: "OrderedDict[str, np.ndarray]" = OrderedDict()
        self.read_rule: Optional[str] = None


class ParametricMemory:
    """Mirror of M1 ParametricMemory API. See module docstring."""

    def __init__(
        self,
        d_mem: int = 128,
        decay: float = 1.0,
        eta: float = 0.5,
        seed: int = 0,
        lexicon_capacity: int = 1024,
    ):
        if not 0.0 < decay <= 1.0:
            raise ValueError(f"decay must be in (0,1], got {decay}")
        if not 0.0 < eta <= 1.0:
            raise ValueError(f"eta must be in (0,1], got {eta}")
        self.d_mem = d_mem
        self.decay = decay
        self.eta = eta
        self.lexicon_capacity = lexicon_capacity
        self._sessions: Dict[str, _Session] = {}

    def sessions(self) -> List[str]:
        return list(self._sessions.keys())

    def _session(self, session_id: str) -> _Session:
        s = self._sessions.get(session_id)
        if s is None:
            s = _Session(self.d_mem)
            self._sessions[session_id] = s
        return s

    def _embed(self, key) -> np.ndarray:
        if isinstance(key, bool):
            raise TypeError("bool is not a memory key")
        if isinstance(key, int):
            # Deterministic unit vector for int via binary expansion
            v = np.zeros(self.d_mem, dtype=np.float32)
            for bit in range(min(self.d_mem, 32)):
                v[bit] = 1.0 if (key >> bit) & 1 else -1.0
            return v / np.linalg.norm(v).clip(min=1e-6)
        if isinstance(key, str):
            return _hash_vec(key, self.d_mem)
        raise TypeError(f"memory key must be int or str, got {type(key)}")

    def write(
        self,
        session_id: str,
        key,
        value,
        update_rule: Optional[str] = None,
    ) -> None:
        rule = update_rule or "sum"
        if rule not in ("sum", "delta"):
            raise ValueError(f"update_rule must be 'sum' or 'delta', got {rule!r}")
        k = self._embed(key)
        v = self._embed(value)
        s = self._session(session_id)
        if rule == "sum":
            s.F = self.decay * s.F + np.outer(k, v)
            s.z = self.decay * s.z + k
        else:
            pred = k @ s.F
            s.F = self.decay * s.F - self.eta * np.outer(k, pred - v)
        s.read_rule = rule
        if isinstance(value, str):
            s.lex[value] = v
            s.lex.move_to_end(value)
            while len(s.lex) > self.lexicon_capacity:
                s.lex.popitem(last=False)

    def recall(
        self,
        session_id: str,
        query,
        top_k: int = 1,
        candidates: Optional[Sequence[int]] = None,
    ) -> List[Tuple[Optional[MemoryValue], float]]:
        s = self._sessions.get(session_id)
        if s is None or s.read_rule is None:
            return [(None, 0.0)] * top_k
        q = self._embed(query)
        qF = q @ s.F
        # M1's relative-zero threshold
        if float(np.linalg.norm(qF)) <= 1e-5 * float(np.linalg.norm(s.F).clip(min=1.0)):
            return [(None, 0.0)] * top_k
        if s.read_rule == "sum":
            r = qF / (q @ s.z).clip(min=_EPS)
        else:
            r = qF
        r = r / np.linalg.norm(r).clip(min=_EPS)
        if s.lex:
            labels = list(s.lex.keys())
            rows = np.stack(list(s.lex.values()))
        else:
            labels = None
            return [(None, 0.0)] * top_k
        scores = rows @ r
        k = min(top_k, scores.shape[0])
        idx = np.argsort(scores)[::-1][:k]
        out: List[Tuple[Optional[MemoryValue], float]] = []
        for i in idx:
            out.append((labels[i], float(scores[i])))
        while len(out) < top_k:
            out.append((None, 0.0))
        return out

    def forget(self, session_id: str, key=None) -> bool:
        s = self._sessions.get(session_id)
        if s is None:
            return False
        if key is None:
            s.F[:] = 0.0
            s.z[:] = 0.0
            s.lex.clear()
            s.read_rule = None
            return True
        k = self._embed(key)
        s.F = s.F - np.outer(k, k @ s.F)
        s.z = s.z - k
        return True

    def snapshot(self, session_id: str) -> Optional[dict]:
        s = self._sessions.get(session_id)
        if s is None:
            return None
        return {
            "format": _SNAP_FORMAT,
            "d_mem": self.d_mem,
            "read_rule": s.read_rule,
            "F": base64.b64encode(s.F.tobytes()).decode("ascii"),
            "z": base64.b64encode(s.z.tobytes()).decode("ascii"),
            "lexicon": [
                [val, base64.b64encode(vec.tobytes()).decode("ascii")]
                for val, vec in s.lex.items()
            ],
        }

    def restore(self, session_id: str, snap: dict) -> None:
        if snap.get("format") != _SNAP_FORMAT:
            raise ValueError(f"unknown snapshot format {snap.get('format')!r}")
        s = self._session(session_id)
        s.F = np.frombuffer(
            base64.b64decode(snap["F"]), dtype=np.float32
        ).reshape(self.d_mem, self.d_mem).copy()
        s.z = np.frombuffer(
            base64.b64decode(snap["z"]), dtype=np.float32
        ).copy()
        s.read_rule = snap["read_rule"]
        s.lex.clear()
        for val, vec_b64 in snap["lexicon"]:
            s.lex[val] = np.frombuffer(
                base64.b64decode(vec_b64), dtype=np.float32
            ).copy()

    def state_bytes(self, session_id: str) -> int:
        s = self._sessions.get(session_id)
        if s is None:
            return 0
        return self.d_mem * self.d_mem * 4 + self.d_mem * 4
