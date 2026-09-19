# P2-0 · Parametric First-Hop — LongMemEval Non-Regression

## Status

**absolute gate NOT met in reproduction environment — zero-regression proven via same-environment A/B (2026-09-06)**

Full LongMemEval_S (500 questions) run on 2026-09-06, on this branch
(`integration/broker-parametric`) and, as a same-environment control, on
its base (`fork/main` @ `7bf66a9`). Both runs produce **bit-identical
retrieval behaviour**: same hits and misses on every one of the 500
questions at k=1/3/5/10.

| Metric | Published baseline (2026-08) | Base `fork/main` (this env) | This branch (this env) |
|--------|------------------------------|------------------------------|------------------------|
| R@5    | 96.0 (480/500)               | 95.8 (479/500)               | 95.8 (479/500)         |
| R@1    | —                            | 80.6 (403/500)               | 80.6 (403/500)         |
| R@3    | —                            | 92.8 (464/500)               | 92.8 (464/500)         |
| R@10   | —                            | 98.8 (494/500)               | 98.8 (494/500)         |

- **Absolute gate (R@5 ≥ 96.0): not met here** — 95.8 vs 96.0, a gap of
  exactly one question, present in the base run too.
- **Non-regression vs the PR: proven** — the miss sets are identical
  question-by-question between base and branch; the P2-0 default-off
  prepend changes nothing at benchmark scale (F-063 claim validated
  end-to-end, beyond the 12 unit tests that lock the off state).
- The 0.2 pp absolute gap is **environment drift**, not a code
  regression: this reproduction used `@huggingface/transformers` 3.8.1
  (ONNX numeric drift across 3.x minors is enough to flip borderline
  rankings) and node v23.11.0, whereas the published 96.0 was measured
  2026-08 in the Awareness-Market environment. 16 of the 21 misses in
  this environment have gold inside top-10 (borderline ranking, not
  systematic failure). Temporal-reasoning accounts for 10 of 21 misses.

## How to reproduce (this environment)

```bash
# dataset (277MB, gitignored) — download once into this directory:
# https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
#   file: longmemeval_s_cleaned.json  (LongMemEval_S, 500 questions)

cd benchmarks/longmemeval
node run_f053_daemon_path.mjs                    # this branch, full 500

# same-environment control (base without this PR):
git worktree add /tmp/awareness-base fork/main
cp run_f053_daemon_path.mjs longmemeval_s_cleaned.json /tmp/awareness-base/benchmarks/longmemeval/
cd /tmp/awareness-base/local && npm install && cd ../benchmarks/longmemeval
node run_f053_daemon_path.mjs
```

Artifacts (in-repo, GOVERNANCE §7):

- `results_f053_daemon_path_n500_b999000000.json` — this branch, 500Q
- `results_f053_daemon_path_n500_base-forkmain.json` — base control, 500Q

Environment: Apple Silicon macOS (darwin 25.2.0, arm64), node v23.11.0,
`@huggingface/transformers` 3.8.1, `better-sqlite3` 12.8.0, English
model `Xenova/all-MiniLM-L6-v2` (CJK-gated per `MODEL_MAP`), token
budget 999M (unlimited tier), zero errors across 1000 question runs.

Note on the runner: `local/src/benchmark/recall-eval.mjs` is a 20-query
daemon smoke check (its own PASS line is 70%) and cannot produce a
96.0-comparable number; the gate instrument is the f053 daemon-path
runner above (now in-repo; fetched from Awareness-Market, sole change =
SDK path for this repo's layout).

## With first-hop ON — not yet measurable end-to-end

Arming `parametricFirstHop` without a broker is observably identical to
off (the stage no-ops without `_parametricBroker`; locked by the 12
first-hop unit tests). A hit-capable ON run requires the M1
`memory_broker` package, which is **not merged** in `everest-an/M1`
main as of 2026-09-06 (verified; only the internal
`parametric_memory.py` exists, which is out of contract per F-061).
The ON comparison is therefore deferred until broker integration
(F-062/F-063); it cannot be honestly produced today.

## What changed

An optional stage was prepended to `unifiedCascadeSearch` in
`local/src/core/search.mjs`. When all three conditions are met:

1. First hop armed — per-call `opts.parametricFirstHop === true`, or
   process-level `AWARENESS_PARAMETRIC_FIRST_HOP=1` (F-074; any other
   value is off). The env surface lets `run_ab.sh` A/B runs and MCP
   callers flip the switch without code edits.
2. A parametric broker is attached (`setParametricBroker()` or
   `options.parametricBroker` in the constructor)
3. The broker has an active session and returns a non-null hit

…then O(1) parametric exact recall runs first and returns directly,
skipping the E5 + FTS5 cascade. On any miss, absence, or failure, the
existing cascade runs with zero behavioural change. Arming without a
broker is a verified no-op (unit-locked).

The switch defaults **off**. With it off, no broker, or no snapshot,
the cascade is bit-identical to the pre-change code path — now verified
at LongMemEval scale (see A/B above), not only in unit tests.

## What this layer is for

The value of the parametric first-hop is **O(1) hot-zone reads and
exact key→value binding**, not semantic retrieval quality. It is not
expected to improve LongMemEval Recall@5 — the E5 + FTS5 cascade
already handles semantic and keyword recall. The parametric layer
complements it for exact-match scenarios (e.g. "what is the user's
favorite color" → exact binding, no embedding needed).

## Non-regression gate

Before merging any PR that touches `unifiedCascadeSearch`, the
LongMemEval benchmark must be run and **R@5 must not drop below the
96.0 baseline**.

| Metric | Baseline | With first-hop (pending) |
|--------|----------|--------------------------|
| R@5    | 96.0     | pending — not yet run    |

Until the benchmark is run and R@5 ≥ 96.0 is confirmed, this feature
must not be enabled by default.

## What must NOT change

- The E5 embedding channel (`_embeddingSearch`) — not touched.
- The SQLite FTS5 channel (`_ftsSearch`) — not touched.
- The RRF fusion logic (`_rrfFusion`, `_rrfFuseMany`) — not touched.
- The budget-tier shaping (`_shapeByBudgetTier`, `_shapeByRatio`) — not touched.
- The existing `recall()` method — not touched.

The first-hop stage is a **pure prepend**: it either short-circuits
the cascade (on hit) or is invisible (on miss/failure/off).
