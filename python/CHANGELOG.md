# Changelog

## [Unreleased] — F-072 trace phase 2 (adopted 2026-09-08)

### Added
- `transport_error` trace event (vocabulary 7→8, F-072): emitted on FINAL
  transport failure of daemon/cloud HTTP paths (`op`/`route`/
  `error_class` connect|timeout|http_status/`status`/`latency_ms`).
  Content-free; never sampled.
- Min-interval throttling for high-frequency success events (default OFF):
  `min_interval_ms=` param or `AWARENESS_TRACE_MIN_INTERVAL_MS` env;
  suppressed events aggregate into `_suppressed_count` on the next emitted
  event of the same type. Errors/rare events never sampled.
- `analyze_trace.py`: `transport_error` aggregation (by op/route/class/status).
- 15 new tests (tracing 8, analyzer 1, client transport 6). Total: 228 passed.


## [2.7.0] - 2026-09-04

### Added — MemoryCloudParametric adapter (M1 broker integration)
- New `memory_cloud.integrations.parametric.MemoryCloudParametric` adapter
  bridging the SDK to M1's `mt_lnn.memory_broker.MemoryBroker`. Same shape
  as the langchain/crewai/praisonai/autogen adapters (inherits
  `MemoryCloudBaseAdapter`): `wrap_llm`, `wrap_function`,
  `get_tool_functions`, `memory_search`, `memory_write`, `memory_insights`,
  `inject_into_messages`.
- Direct parametric operations: `parametric_write`, `parametric_recall`,
  `parametric_forget`, `parametric_snapshot`, `parametric_restore`,
  `parametric_state_bytes`, `parametric_sessions`.
- Dependency direction SDK→M1 (one-way); only imports
  `mt_lnn.memory_broker` via try/except — silently degrades to logged
  warnings when the package is absent. Daemon channel
  (`localhost:37800`) untouched; broker unavailable → graceful fallback.
- New optional dependency: `pip install 'awareness-memory-cloud[parametric]'`
  (pulls `mt_lnn[memory_broker]` from `git+github.com/everest-an/M1`).
- `examples/parametric_quickstart.py` — runnable demo with and without
  a broker.
- 28 new tests. Total Python SDK: 160 passed, 21 skipped.

### Added — Session migration CLI (export/import)
- New `memory_cloud.session_migrate` module: `export_session()` and
  `import_session()` for cross-process parametric memory transfer via
  `MemoryBroker.snapshot/restore`. Package format reuses the existing
  zip+JSONL convention from `export_reader.py` (manifest.json +
  parametric/snapshot.json + parametric/bindings.jsonl).
- CLI: `python -m memory_cloud.session_migrate export/import
  --session-id <id> --output/--input <path>`.
- `examples/migrate_session.py` — process A writes → snapshot → exit;
  process B restore → recall all bindings (bit-exact), including
  cross-directory migration and corrupt-archive rejection.
- Bit-exactness covers the parametric layer only (F, z tensors + lexicon).
  The SQLite episodic layer is NOT in the guarantee — both layers are
  independently exportable.
- 12 new tests. Total Python SDK: 172 passed, 21 skipped.

### Added — SDK-level trace + governance (F-069)
- New `memory_cloud.tracing`: JSONL trace writer (M1-compatible envelope
  `{ts, event, session_id, channel}`, field naming per OTel GenAI semconv,
  no OTel dependency). Seven events: recall / write / forget / snapshot /
  restore / conflict_forget / broker_unavailable.
- Default off (`trace_path` param or `AWARENESS_TRACE_PATH`); hash-only
  by default (sha256 first-16), `trace_full_content=True` opts in to raw
  text; writer never throws — I/O failure self-disables it.
- Wired: client.record/retrieve (daemon + cloud routes, latency_ms),
  parametric adapter (5 ops + degrade paths), session_migrate
  (optional `trace=` writer param).
- Governance: root `GOVERNANCE.md` (dependency boundary, decision
  ownership, merge gates, defaults policy, claims register),
  `docs/decisions/` MADR-lite ADRs F-061..F-069,
  `.github/PULL_REQUEST_TEMPLATE.md` (M1-style gate checklist).
- 19 new trace tests. Trace-off path covered by full existing suite.

### Added — governance execution infrastructure (F-070)
- `scripts/analyze_trace.py`: aggregate a trace JSONL into the GOVERNANCE §6
  evidence numbers (recall hit-rate by route, `broker_unavailable` frequency
  by op/reason, latency p50/p95). Stdlib only; malformed lines are skipped
  and counted; unknown events degrade to an `other` bucket. 8 tests.
- `MemoryTraceWriter` optional `max_bytes` rotation (single `<path>.1` slot,
  default off, `AWARENESS_TRACE_MAX_BYTES` env supported). Rotation failure
  follows the never-throw self-disable path. 4 new rotation tests.
- `scripts/check_claims.py`: mechanical GOVERNANCE §7 claims-register check —
  README number claims must be registered (or in a §7-pointed artifact) or
  carry a visible source; wired into CI.
- `.github/workflows/ci.yml`: Python full suite + import/trace smoke +
  claims check as blocking jobs; JS two-tier (PR-relevant 50 blocking,
  full suite non-blocking while upstream sync gaps are open).
- `benchmarks/longmemeval/run_f053_daemon_path.mjs` now lives in-repo
  (previously only in Awareness-Market; sole change = SDK path for this
  layout) plus `run_ab.sh`, a same-environment A/B gate rerun helper
  (base worktree + dual run + per-question diff).

### Fixed
- `examples/parametric_quickstart.py`: the no-broker demo used a MagicMock
  client, so `AWARENESS_TRACE_PATH` was never consumed and the demo could
  not show trace output. It now uses a real client (parametric ops never
  dial HTTP) — graceful degradation is observable: broker_unavailable
  events land in the trace file, with an `analyze_trace.py` hint printed.

## [2.6.0] - 2026-04-19

### Added — F-059 skill fields + F-060 client-side HyDE
- `Skill` type (TypedDict) now carries optional `pitfalls`, `verification`,
  and `growth_stage: Literal["seedling","budding","evergreen"]`.
- `client.retrieve(hyde_hint=...)` — pass a pre-synthesized hypothetical
  answer so the daemon embeds it as the query vector.
- New `client.retrieve_with_hyde(memory_id, query, llm_complete)` helper
  — user plugs in their own LLM completion callable; graceful fallback on error.
- 6 new hyde tests. Total Python SDK: 132 passed, 21 skipped.

### Fixed — pre-existing test failures (3)
- `client.record()` now hoists `extraction_request` to top-level result
  (was nested under `ingest`) — matches TS SDK contract.
- `test_export_reader` updated to use current `_build_record_events` API
  after `_coerce_history_to_events` was removed in v2.0.0.

## [2.5.0] - 2026-04-18

### Changed — local daemon bridge uses F-053 single-parameter surface
- `retrieve().daemon_args` now sends `{query, limit}` (+ optional `token_budget`
  from `custom_kwargs`, + `agent_role` when set). Legacy fields
  (`keyword_query`, `scope`, `recall_mode`, `detail`, `ids`) are only
  forwarded when the caller explicitly passed them — `retrieve(query=...)`
  alone now produces a clean F-053 single-parameter daemon call.
- **Why**: before this release, the Python SDK sent the pre-F-053 multi-
  parameter shape to `@awareness-sdk/local`, which tolerated it via the
  legacy branch but logged `[deprecated param used]` warnings AND skipped
  Phase 3 query-type auto-routing, recency channel, and budget-tier bucket
  shaping. Users got worse recall than Claude Code / OpenClaw users.
- User-facing `retrieve(memory_id=..., query="...", limit=...)` signature
  unchanged. Only the internal daemon call shape changed.

### Added — developer simulation harness
- `tests/sdk-simulation/developer_simulation.py` exercises the full path:
  boot isolated daemon → SDK record → Vercel AI Gateway LLM-rewrite user
  question → SDK `retrieve()` → assert F-053 daemon_args shape + correct
  memory in top-3. Passes end-to-end against qwen-3-14b.

### Compatibility
- Requires `@awareness-sdk/local@0.8.0+` for full Phase 3 quality (recency
  channel + budget-tier shaping). Older daemons still work via the legacy
  `recall_mode`/`scope`/`detail` forwarding path — callers that still pass
  these explicitly keep working unchanged.

## [2.4.4] - 2026-04-15

### Changed
- **LongMemEval benchmark README**: Enriched documentation with full benchmark methodology, competitive analysis, and ASCII art visualizations. R@5=95.6% vs 61.2% baseline, verified on 500-question LongMemEval-Omni subset.

## [2.4.3] - 2026-04-11

### Fixed (real local-mode bridge — supersedes the v2.4.2 default-port "fix")
- **`mode="local"` now actually talks to the local daemon**: v2.4.0–v2.4.2 all
  pretended local mode existed but pointed at non-existent ports. v2.4.2 changed
  the default to `http://localhost:8000/api/v1` (a self-hosted Awareness backend),
  which still didn't match what users mean when they say "local mode" — i.e. the
  `@awareness-sdk/local` daemon (single-tenant, port 37800). v2.4.3 makes
  `mode="local"` route the four daemon-supported MCP tools (`awareness_init`,
  `awareness_recall`, `awareness_record`, `awareness_lookup`) through the daemon's
  `/mcp` JSON-RPC endpoint at `http://localhost:37800`. This is a real, end-to-end
  tested integration — verified live against a running daemon.
- **`mode="cloud"` default base URL is now the public Awareness Cloud**:
  `https://awareness.market/api/v1`. `base_url` is now optional (defaulting to
  this value) instead of being a required positional arg.
- **`local_url` default is `http://localhost:37800`** (the daemon root, not an
  `/api/v1` REST path). The bridge talks JSON-RPC at `${local_url}/mcp`.

### Added
- **MCP-bridged methods (work in `mode="local"` or `mode="auto"`)**:
  - `record()` → `awareness_record` (string → `remember`, list → `remember_batch`)
  - `retrieve()` → `awareness_recall` (markdown summary parsed into structured items)
  - `get_session_context()` → `awareness_init`
  - `get_knowledge_base()` → `awareness_lookup` `type=knowledge`
  - `get_pending_tasks()` → `awareness_lookup` `type=tasks`
- **`call_local_daemon(tool_name, args)`** — public escape hatch for direct MCP
  tool calls; raises `MemoryCloudError("LOCAL_NOT_SUPPORTED", ...)` for non-allow-
  listed tools. The four supported tools are exported via `DAEMON_SUPPORTED_TOOLS`.
- **Markdown recall parser**: `awareness_recall` returns a markdown summary on the
  daemon side; the SDK now parses it into `{id, type, title, snippet, score}`
  items so `retrieve()` returns a stable shape across cloud and local.
- **Hard guards**: cloud-only methods (`create_memory`, `list_memories`) raise
  `LOCAL_NOT_SUPPORTED` instead of silently 404ing against the daemon.

### Compatibility
- `base_url` is now optional. Existing positional callers still work; explicit
  `base_url` keeps the old behavior of pointing at a custom REST host.
- Anyone passing `local_url` explicitly is unaffected.
- Anyone relying on `mode="local"` previously would have always seen connection
  errors (port 8765 / port 8000), so no real workflow can break.

## [2.4.2] - 2026-04-11

### Fixed
- **`local_url` default port was wrong (vaporware)**: Default `local_url` was
  `http://localhost:8765`, but no Awareness component has ever served port 8765 —
  the cloud backend serves 8000 (docker-compose) and the local daemon serves 37800.
  So `mode="local"` and `mode="auto"` **never worked** against any real deployment.
  Default is now `http://localhost:8000/api/v1` (matches `docker-compose up`).
- **`mode="auto"` health probe was wrong path**: when `local_url` ended in `/api/v1`,
  the auto-mode probe hit `/api/v1/health` (404), so auto fallback to cloud always fired.
  Probe now strips the `/api/v1` suffix and pings `/health` at the host root.
- **Docstring clarified**: `mode="local"` means a self-hosted Awareness backend
  (same REST shape as cloud). It is **NOT** the `@awareness-sdk/local` daemon
  (port 37800) — that has a different REST shape (single-tenant, `/api/v1/topics`,
  `/api/v1/perceptions`, …) and should be consumed via the daemon's own client or
  `@awareness.market/openclaw-memory`.

### Compatibility
- Pure default-value change. Anyone passing `local_url` explicitly is unaffected.
- Anyone relying on the broken 8765 default would have always seen connection errors,
  so no real workflow can break.

## [2.4.1] - 2026-04-11

### Added
- **`SkillCrystallizationHint` TypedDict** — describes the F-034 hint shape returned in
  `IngestResult._skill_crystallization_hint` when ≥3 similar knowledge cards have
  accumulated. Agents should synthesize the listed `similar_cards` into a skill via
  `record(insights={"skills": [{"name", "summary", "methods", "trigger_conditions",
  "tags", "source_card_ids"}]})`.
- **`IngestResult._skill_crystallization_hint`** — new optional field on the ingest
  response for type-safe access to the hint.
- **`PerceptionSignal.type`** docstring now lists `"guard"` (highest-priority pitfall
  warning) and `"crystallization"` (synthetic signal carrying the F-034 hint).
- **`PerceptionSignal` lifecycle fields** — `signal_id`, `state`, `exposure_count`,
  `current_weight`. Mirrors the local daemon's perception lifecycle so cloud SDK
  consumers can implement matching exposure-cap / decay UX.
- **`ActiveSkill.id` / `decay_score` / `usage_count`** — additional fields returned by
  the cloud `/skills` endpoint, useful for displaying skill freshness in custom UIs.

### Documentation
- `KnowledgeCard.category` comment now marks `skill` as **DEPRECATED (F-032)** — skills
  live in the dedicated `skills` table since v2.4.0.

### Compatibility
- Pure type-additive change. No runtime behavior changed. Drop-in compatible with v2.4.0.
- 119 of 122 unit tests pass (3 pre-existing failures unrelated to this change).

## [2.4.0] - 2026-04-10

### Added
- `get_skills()` — List skills for a memory with filtering and sorting
- `mark_skill_used()` — Mark a skill as used, resetting decay timer
- `Skill`, `SkillMethod`, `SkillTrigger`, `SkillListResponse`, `SkillUpdateInput` types
- Skill system support for F-032 (Hermes Agent-style auto-extracted skills)

## [2.0.0] - 2026-03-22

### Breaking Changes

The following deprecated methods have been **removed**. Update your code before upgrading:

| Removed | Replace with |
|---------|-------------|
| `remember_step(memory_id, text, ...)` | `record(memory_id, content=text, ...)` |
| `remember_batch(memory_id, steps, ...)` | `record(memory_id, content=steps, ...)` |
| `ingest_content(memory_id, content, ...)` | `record(memory_id, content=content, scope="knowledge")` |
| `backfill_conversation_history(memory_id, messages, ...)` | `record(memory_id, content=messages, scope="timeline")` |

The following methods are now **private** (prefixed with `_`). Use `record()` instead for new code:

| Now private | Replacement |
|------------|-------------|
| `submit_insights()` → `_submit_insights()` | `record(memory_id, insights={...})` |
| `begin_memory_session()` → `_begin_memory_session()` | Session is now managed automatically by `record()` |

### Added

- `mode` parameter on `MemoryCloudClient.__init__`: `"cloud"` (default) | `"local"` | `"auto"`
  - `mode="local"` — connect to a local Awareness daemon instead of the cloud API
  - `mode="auto"` — try local daemon first, fall back to cloud if unavailable
- `local_url` parameter on `MemoryCloudClient.__init__`: local daemon URL (default: `http://localhost:8765`)

```python
# Connect to local daemon
client = MemoryCloudClient(mode="local")

# Auto-detect (local first, cloud fallback)
client = MemoryCloudClient(
    mode="auto",
    local_url="http://localhost:8765",
    base_url="https://api.awareness.market",
    api_key="sk-...",
)
```

## [0.2.8] - 2026-03-22

### Added
- `detail` and `ids` parameters on `retrieve()` and `recall_for_task()` for progressive disclosure

## [0.2.2] - 2026-03-16

### Added
- `ActiveSkill` type (`title`, `summary`, `methods`) for reusable procedure prompts
- `active_skills` field on `SessionContextResult` — pre-loaded at session start for token efficiency
- `skill` as a new knowledge card category (reusable procedure done 2+ times)

## [0.2.1] - 2026-03-14

### Fixed
- Corrected example file references in README (removed non-existent files, added `injected_conversation_demo.py`)

## [0.2.0] - 2026-03-09

### Added
- `user_id` parameter on all write and read methods for multi-user memory
- `agent_role` parameter for role-filtered recall
- `reconstruct_chunks` and `max_stitched_chars` on `retrieve()` and `recall_for_task()`
- `multi_level` and `cluster_expand` parameters for broader context and topic-based retrieval
- 13 knowledge card categories (6 engineering + 7 personal)

### Changed
- Default `retrieve()` limit: 10 → 12
- Default `recall_for_task()` limit: 8 → 12, max: 20 → 30
- `recall_for_task()` now uses `use_hybrid_search=True` by default

## [0.1.0] - 2026-02-15

### Added
- Initial release
- `MemoryCloudClient` with CRUD operations
- `retrieve()` and `recall_for_task()` for semantic search
- `ingest()` for bulk content import
- OpenAI, Anthropic, LangChain, CrewAI, AutoGen integrations
