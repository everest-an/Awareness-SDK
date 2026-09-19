# LOOP TOOLS — 循环与门禁工具索引（先复用，后新写；新工具必回写）

## 循环工具（scripts/loop/，移植自 Physic）

| 工具 | 用途 | 入口 |
|---|---|---|
| `goal_check` | **目标校验路由器**（每轮心跳第一步）：三 lint 门禁红 → GATE-RED(4)；队首 check_cmd → ACHIEVED(0, 弹出晋升)/NOT-Achieved(1)；队列空 → QUEUE-EMPTY(2)。空 check_cmd 假阳性防护内建 | `./scripts/loop/goal_check` |
| `marathon_guard` | 单马拉松锁检查（.loop-lock 新鲜度 TTL 100min）；exit 0=放行 / 1=已有活会话让位 | `./scripts/loop/marathon_guard` |
| `iteration` | 迭代总开关（GOALS mode ON/OFF 的 CLI）：start [goal] / stop / status | `./scripts/loop/iteration start` |

## 门禁与验证工具（既有，循环每轮消费）

| 工具 | 用途 | 入口 |
|---|---|---|
| `scripts/check_claims.py` | 主张登记机械校验（§7+CLAIMS 双登记一致性、撤回复活检测、90 天时效） | `python3 scripts/check_claims.py [--verbose]` |
| `scripts/check_adr_index.py` | ADR 索引↔文件存在性+状态一致性 lint | `python3 scripts/check_adr_index.py` |
| `scripts/check_version_sync.py` | 包版本 ↔ CHANGELOG 最新发布一致性 lint（六包） | `python3 scripts/check_version_sync.py` |
| `python/scripts/analyze_trace.py` | trace JSONL → §6 证据聚合（route 命中率/降级/transport_error/p50/p95） | `python scripts/analyze_trace.py <trace.jsonl>` |
| `benchmarks/longmemeval/run_ab.sh` | LongMemEval 同环境 A/B 门禁复跑一键化 | `bash run_ab.sh <base_ref>` |
| `python/scripts/ci_trace_smoke.py` | CI import+trace 冒烟（writer 解析/发射/hash-only 落盘断言） | `python scripts/ci_trace_smoke.py` |
| `.github/workflows/benchmark.yml` | 按需 LongMemEval 基准（workflow_dispatch，single/ab 双模式，数据集 sha256 校验） | Actions 页或 `gh workflow run benchmark` |
| `python/tests/test_loop_scripts.py` | goal_check 路由与 marathon_guard 锁的回归测试 | `pytest tests/test_loop_scripts.py`（python/ 下） |

## 约定

- 新工具写完必须回写本表（一句话用途 + 入口）；带测试的标测试入口。
- 结果类产物落 `benchmarks/`（门禁证据 JSON 不 gitignore）；循环元状态
  只在 `docs/loop/`，判读只在 LOOP-LOG.md。
