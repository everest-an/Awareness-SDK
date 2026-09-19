"""Development stubs for testing without the real M1 memory_broker package.

**Purpose**: let end-to-end flows (quickstart, migrate_session, hooks)
exercise a real ParametricMemory-shaped object before M1 publishes
`mt_lnn.memory_broker` and before users install torch.

**Lifecycle**: this stub is **temporary** — it exists only so the SDK
can prove the integration contract end-to-end with mock-free Python.
When M1 publishes `memory_broker`:

1. The stub is deleted.
2. The fallback import in `parametric.py` /
   `parametric_hooks.mjs` (see parametric-hooks.mjs for the JS side)
   swaps to the real package.
3. Tests in `test_real_broker_contract.py` must continue to pass
   unchanged against the real broker (it has the same 7-method shape).

**Not a production object**: this is a hash-based feature-hashing
implementation mirroring `mt_lnn/parametric_memory.py`'s default text
encoder (which itself is exact-match only, no semantic recall). Real
brokers may differ in recall semantics; this stub only proves the
**contract** (the 7-method signature) is correctly consumed.
"""
