# CLAIMS.md — 主张-证据显式映射（机读登记）

> F-073（2026-09-08 采纳）：本文件是 GOVERNANCE §7 主张登记簿的**机读证据映射**
> ——每条对外数字主张一行，声明式映射到证据锚点，由 `scripts/check_claims.py`
> lint 并挂 CI。对标 eslint 仓库 CLAIMS.md 模式（含撤回审计轨迹与 90 天时效纪律）。
> §7 保留为人读的治理登记簿（决策记录用）；两者以 claim-id 对账，数字集合必须一致
> （lint 强制）。

## 规则

1. **先登记后引用**：对外 README 出现的数字主张，必须同时登记于 §7（治理视角）
   与本文件 Active 区（机读视角）；只改其一 → `check_claims.py` exit 1。
2. **等价声明**：同一主张的多种数字写法（如 `95.8%` 与 `479/500`）写在同一行的
   数字列（用 `=` 显式连接），lint 按数值等价集合匹配。
3. **撤回纪律**：被撤回的主张移入 Withdrawn 区保留审计轨迹（对标 M1 RESULTS.md
   RETRACTED）。撤回行的数字再出现在任何对外 README → exit 1（无论是否带出处）。
4. **时效纪律**（对标 eslint 90 天规则）：Active 主张的「最后核实」超过 90 天
   → lint 打印 stale 警告，主张在下次引用前必须复跑复现命令刷新。
5. **诚实负结果**：实测输给对比目标的负向结果，必须登记于 Active 区（状态照常）
   或 Withdrawn 区（撤回时），不得只字不提。
6. 证据锚点格式：`文件路径`（整体）或 `文件路径#锚点`（文件内小节/表格）；锚点
   为 markdown 标题小写连字符形式。

## Active

| claim-id | 主张文案 | 数字（等价写法） | 证据锚点 | 复现命令 | 状态 | 登记日期 | 最后核实 |
|---|---|---|---|---|---|---|---|
| C-001 | LongMemEval R@5 同环境基线（关闭首跳）：本环境 95.8%，fork/main 同环境同值，0.2pp 差为环境漂移（transformers.js 版本差） | 95.8% = 479/500 = 0.2pp | benchmarks/longmemeval/FIRST_HOP_NONREGRESSION.md#how-to-reproduce + results_f053_daemon_path_n500_base-forkmain.json | `node run_f053_daemon_path.mjs`（benchmarks/longmemeval/，500Q） | active | 2026-09-06 | 2026-09-06 |
| C-002 | Published 基线 96.0%（480/500）为 Awareness-Market 标准环境（2026-08）参考目标——跨环境数字不作绝对门禁（F-071） | 96.0% = 480/500 | benchmarks/longmemeval/FIRST_HOP_NONREGRESSION.md | 须在 Awareness-Market 标准环境复测 | active | 2026-09-06 | 2026-09-06 |
| C-003 | 首跳开启后 R@5 ≥ 同环境基线 AND PR 零回归：已通过（F-071 双条件）——本环境 95.8 与同环境 fork/main 500 题逐题 bit-identical miss set；PR #1 维持 Ready | 95.8% = 479/500 = 500 | results_f053_daemon_path_n500_b999000000.json（分支）+ results_f053_daemon_path_n500_base-forkmain.json（对照） | 命令见 benchmarks/longmemeval/FIRST_HOP_NONREGRESSION.md "How to reproduce" | active | 2026-09-06 | 2026-09-06 |
| C-004 | 参数化层 O(1) 热区读取、精确绑定——设计主张，非本仓实测，引用须注明出处 M1 | （无数字的定位主张） | M1 docs/PARAMETRIC_MEMORY.md | —（本仓未独立复测） | active | 2026-09-06 | 2026-09-06 |
| C-005 | 会话迁移 bit-exact——单测级验证（mock broker），真实 broker 联调后升级 | （无数字的等价性主张） | python/tests/test_session_migrate.py | `pytest tests/test_session_migrate.py`（python/ 下） | active | 2026-09-06 | 2026-09-06 |

## Withdrawn

<!-- 撤回主张保留审计轨迹；本区行的数字在对外 README 复现 = exit 1 -->

| claim-id | 主张文案 | 数字（等价写法） | 撤回原因 | 撤回日期 |
|---|---|---|---|---|
| （暂无） | | | | |

## Superseded

<!-- 被后续主张取代的行；数字不再受 Active allowlist 保护，亦不得复活 -->

| claim-id | 取代者 | 原文案 | 数字 | 日期 |
|---|---|---|---|---|
| （暂无） | | | | |
