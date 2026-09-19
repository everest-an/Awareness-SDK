# F-070 · 治理与 trace 的工程化执行设施（CI / 分析器 / A/B 一键化 / 主张校验）

- **状态**: Accepted
- **日期**: 2026-09-06

## 背景

F-069 设立了治理体系（GOVERNANCE.md）与机制 trace（tracing.py），但 2026-09-06
的工程化审计（PR #1 门禁复测会话）发现闭环断在两端：

1. **无 CI**：`.github/workflows/` 仅 publish 手动流水线；§3 门禁"全量测试绿"
   全靠 PR 作者本地自报（PR 模板声称沿用 M1 门禁纪律，但 M1 有 ci.yml，本仓没有）。
2. **trace 只写不读**：§6 最低证据集（recall 的 route/hit/latency、
   broker_unavailable）有产出端、无聚合端——§4 要求翻转 ADR"引用 trace 证据
   （命中率、降级频率、latency）"，但从 JSONL 到这些数字之间没有工具。
3. **门禁基准复跑手工化**：LongMemEval 同环境 A/B（worktree + 两跑 + 逐题
   diff）是零回归的机械判据（2026-09-06 PR #1 复测首次实践），但流程是手工的。
4. **主张登记簿无机械校验**：§7"本文件为准"纪律只靠人眼。
5. **示例层观测盲区**：quickstart 用 MagicMock client，AWARENESS_TRACE_PATH
   永不被消费——"可观测的静默"（F-062）恰恰在自带示例里演示不出来。

## 决策

建立五件执行设施（不改任何治理规则本身，只给既有规则装执行器）：

1. **CI**（`.github/workflows/ci.yml`）：Python 全量测试 + import/trace 冒烟 +
   主张校验 + JS 两层（PR 相关 50 例为阻塞门禁；全量套件存在上游 sync 缺口的
   ~23 个存量失败，以非阻塞方式持续暴露，不静默跳过，修复责任在上游 sync）。
2. **trace 分析器**（`python/scripts/analyze_trace.py` + 测试）：JSONL →
   按 route 命中率 / 降级频率（按 op/reason）/ latency p50/p95，§4 翻转 ADR 的
   证据生成器。
3. **A/B 门禁一键化**（`benchmarks/longmemeval/run_ab.sh`）：基线 worktree +
   双跑 + 逐题 diff，输出 ZERO-DELTA/DELTA 与绝对门禁两个独立判据。
4. **主张校验**（`scripts/check_claims.py`）：扫描对外 README 的数字主张，
   未登记于 §7（或其指向产物）且无出处 → exit 1，挂 CI。
5. **示例可观测修复**：quickstart 降级演示改用真实 client（trace 真实落盘）；
   tracing.py 增加可选 `max_bytes` 轮转（默认关）；python/README 补 trace 章节。

## 后果

- §3 门禁第 1 条（全量测试绿）与第 3 条（无未实测主张）从荣誉制变为机械制；
  PR 模板 checklist 与 CI 互为印证。
- §4 的三次默认值翻转评估（待 M1 联调）从此有了现成的证据管线：联调 trace →
  analyze_trace.py → ADR 引用数字 → §7 登记。
- 绝对门禁（96.0）与零回归（A/B ZERO-DELTA）在本决策中明确为**两个独立判据**：
  前者环境敏感（2026-09-06 复测 95.8，差 1 题，对照同 95.8），后者机械可判定。
  是否修订 §3 的门禁表述属治理决策，本决策不代行——上游复跑裁决（见 PR #1 报告）。
- 全量 JS 套件的 ~23 个存量失败（publish-agent SSOT 模板缺失、guard-detector、
  CLI daemon、sessions CRUD 等，均为 Awareness-Market sync 缺口）由 CI 的非阻塞
  层持续暴露；修复需上游补齐 `_shared/prompts/` 与 sync 脚本，本仓不代行。
- 事件词表（F-069）与本决策均未改动任何治理规则文本；后续规则修订仍须走 ADR。
