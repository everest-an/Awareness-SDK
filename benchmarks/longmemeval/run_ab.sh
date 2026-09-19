#!/usr/bin/env bash
#
# run_ab.sh — LongMemEval 门禁的同环境 A/B 复跑一键化（GOVERNANCE §3 执行设施，F-070）。
#
# 动过 unifiedCascadeSearch 的 PR 需要 LongMemEval 非回归产物。实践（2026-09-06，
# PR #1 复测）证明绝对数受环境影响（transformers.js/ONNX 数值漂移），同环境
# A/B —— 当前分支 vs 基线 ref 各跑一遍 f053 daemon-path runner，逐题对比 ——
# 才是零回归的机械判据。本脚本把该流程固化：
#
#   1. git worktree 创建 BASE_REF 基线副本（mktemp，结束自动清理）
#   2. 基线侧 npm install（node_modules 通过 symlink 复用主仓——同机同 node，
#      better-sqlite3 原生模块无需重建）
#   3. 两轮 run_f053_daemon_path.mjs（默认全量 500 题，~17 分钟/轮）
#   4. 内嵌 python3 逐题对比 hits@1/3/5/10，输出 ZERO-DELTA / DELTA 结论
#      与绝对门禁（R@5 ≥ GATE_R5，默认 96.0）检查
#
# 用法:
#   bash run_ab.sh                       # 全量 500 题，基线 = fork/main
#   bash run_ab.sh upstream/main         # 指定基线 ref
#   RUNNER_ARGS="--limit=20" bash run_ab.sh   # 冒烟
#   KEEP_WORKTREE=1 bash run_ab.sh       # 保留基线 worktree 调试
#
# 退出码: ZERO-DELTA → 0；DELTA → 1。
# 绝对门禁 FAIL 只反映在打印（ABSOLUTE-GATE: FAIL），不改变退出码——
# 零回归（同环境 A/B）与绝对数（环境敏感）是两个独立判据，见 FIRST_HOP_NONREGRESSION.md。
#
# 前提: 本目录需有 longmemeval_s_cleaned.json（277MB，gitignored）。
# 下载: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="run_f053_daemon_path.mjs"
DATASET="longmemeval_s_cleaned.json"
GATE_R5="${GATE_R5:-96.0}"
RUNNER_ARGS="${RUNNER_ARGS:-}"

[[ -f "$HERE/$RUNNER" ]] || { echo "error: $RUNNER not found next to this script" >&2; exit 2; }
[[ -f "$HERE/$DATASET" ]] || {
  echo "error: dataset missing: $HERE/$DATASET" >&2
  echo "  download from https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned" >&2
  echo "  (file: longmemeval_s_cleaned.json, LongMemEval_S, 500 questions)" >&2
  exit 2
}

# ---- 基线 ref 解析：fork/main → origin/main → 显式报错 ----------------------
BASE_REF="${1:-}"
if [[ -z "$BASE_REF" ]]; then
  for candidate in fork/main origin/main; do
    if git -C "$HERE/../.." rev-parse --verify --quiet "$candidate" >/dev/null; then
      BASE_REF="$candidate"; break
    fi
  done
fi
[[ -n "$BASE_REF" ]] || { echo "error: no BASE_REF given and neither fork/main nor origin/main resolves" >&2; exit 2; }
git -C "$HERE/../.." rev-parse --verify --quiet "$BASE_REF" >/dev/null \
  || { echo "error: BASE_REF '$BASE_REF' does not resolve" >&2; exit 2; }
echo "A/B gate — branch=$(git -C "$HERE/../.." rev-parse --abbrev-ref HEAD)  base=$BASE_REF  args='${RUNNER_ARGS:-<full 500>}'"

# ---- 基线 worktree ----------------------------------------------------------
WORKROOT="$(mktemp -d /tmp/awareness-ab-XXXXXX)"
BASE_WT="$WORKROOT/base"
cleanup() {
  if [[ "${KEEP_WORKTREE:-0}" != "1" ]]; then
    git -C "$HERE/../.." worktree remove --force "$BASE_WT" 2>/dev/null || rm -rf "$BASE_WT"
    rm -rf "$WORKROOT"
  else
    echo "KEEP_WORKTREE=1 → base worktree left at $BASE_WT"
  fi
}
trap cleanup EXIT

git -C "$HERE/../.." worktree add --detach "$BASE_WT" "$BASE_REF" >/dev/null 2>&1
mkdir -p "$BASE_WT/benchmarks/longmemeval"
cp "$HERE/$RUNNER" "$HERE/$DATASET" "$BASE_WT/benchmarks/longmemeval/"

# node_modules 复用：主仓已构建的原生模块（better-sqlite3）直接软链，省 ~1 分钟
if [[ -d "$HERE/../../local/node_modules" ]]; then
  ln -sfn "$HERE/../../local/node_modules" "$BASE_WT/local/node_modules"
else
  (cd "$BASE_WT/local" && npm install --silent)
fi

# ---- 两轮基准 ----------------------------------------------------------------
echo "running A (current branch)…"
(cd "$HERE" && node "$RUNNER" $RUNNER_ARGS > "$WORKROOT/run_A.log" 2>&1) \
  || { echo "error: branch run failed — see $WORKROOT/run_A.log"; exit 3; }
A_JSON=$(ls -t "$HERE"/results_f053_daemon_path_n*.json | head -1)

echo "running B (base $BASE_REF)…"
(cd "$BASE_WT/benchmarks/longmemeval" && node "$RUNNER" $RUNNER_ARGS > "$WORKROOT/run_B.log" 2>&1) \
  || { echo "error: base run failed — see $WORKROOT/run_B.log"; exit 3; }
B_JSON=$(ls -t "$BASE_WT/benchmarks/longmemeval"/results_f053_daemon_path_n*.json | head -1)

# 重命名产物，避免与 runner 默认名互相覆盖
mv "$A_JSON" "$HERE/results_ab_branch.json"
mv "$B_JSON" "$HERE/results_ab_base.json"
A_JSON="$HERE/results_ab_branch.json"
B_JSON="$HERE/results_ab_base.json"

# ---- 逐题 diff + 结论 --------------------------------------------------------
python3 - "$A_JSON" "$B_JSON" "$GATE_R5" <<'EOF'
import json, sys

a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))
gate = float(sys.argv[3])

def misses(d):
    return {r["qid"] for r in d["details"] if not r["hits"].get("5")}

ma, mb = misses(a), misses(b)
for label, d in (("branch", a), ("base  ", b)):
    r5 = d["recall"]["5"]
    print(f"{label}  R@5={r5*100:.1f}%  R@1={d['recall']['1']*100:.1f}%  R@10={d['recall']['10']*100:.1f}%")
delta = ma.symmetric_difference(mb)
print(f"per-question diff: {len(delta)} differing question(s)")
for qid in sorted(delta):
    side = "branch-miss" if qid in ma else "base-miss"
    print(f"  {qid}  {side}")
if ma == mb:
    print("VERDICT: ZERO-DELTA")
else:
    print(f"VERDICT: DELTA ({len(delta)} questions)")
branch_r5 = a["recall"]["5"] * 100
gate_ok = branch_r5 >= gate
print(f"ABSOLUTE-GATE: R@5={branch_r5:.1f} vs {gate} → {'PASS' if gate_ok else 'FAIL'}")
print("(零回归与绝对门禁是独立判据——FAIL 不改退出码，见脚本头注释)")
sys.exit(0 if ma == mb else 1)
EOF
