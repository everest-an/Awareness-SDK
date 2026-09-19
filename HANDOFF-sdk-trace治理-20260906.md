# HANDOFF

## 目标（Objective）
- 要达成的结果：完成 Awareness-SDK 参数化集成线（P1-0~P2-2）+ SDK 级 trace（F-069）+ 治理体系，并推进 PR #1 从 Draft 到 Ready / 合入。
- 验收标准 / "完成"的定义：
  1. LongMemEval 非回归验证通过：R@5 ≥ 96.0（动过 `unifiedCascadeSearch`，GOVERNANCE §3 门禁）；
  2. M1 `memory_broker` / `consolidation_policy` 合并后真实联调通过；
  3. 联调通过后按 GOVERNANCE §4 流程评估翻转三个开关默认值（每次翻转须立新 ADR）。

## 当前状态
- 项目目录：`/Users/aricredemption/Projects/Awareness-SDK`
- Branch：`integration/broker-parametric`
- Worktree：主 worktree（另有无关 worktree `projects/time-workbench`，codex 分支，勿动）
- Git 状态：**工作区干净**，9 个提交全部已推送到 fork（`AricRedemption/Awareness-SDK`）
- PR：https://github.com/everest-an/Awareness-SDK/pull/1 （**Draft, open**，fork 分支 `AricRedemption:integration/broker-parametric` → 上游 `main`）
- 上游写权限：本机账号 `AricRedemption` 对 `everest-an/Awareness-SDK` **无 push 权限**（403），一切推送走 fork
- 总体状态：**代码侧已完成**；阻塞项全部在仓外（M1 未合并、基准未跑）

## 已完成事项
- P0-0：main 与 origin/main 同步确认（0/0），集成分支创建
- P1-0（`c1c0460`）：`MemoryCloudParametric` 适配器（继承 MemoryCloudBaseAdapter，与 langchain/crewai/praisonai/autogen 同构）；`parametric` optional dep；quickstart 示例
- P2-0（`5cbf16e`）：`unifiedCascadeSearch` 可选参数化首跳（`opts.parametricFirstHop`，默认关；命中判据沿用 M1 相对零阈值）；`benchmarks/longmemeval/FIRST_HOP_NONREGRESSION.md`（状态 non-regression pending）
- P2-1（`b732079`）：`local/src/daemon/parametric-hooks.mjs` 三钩子（record→write / 冲突→forget+rewrite / 会话结束→snapshot）；双开关默认 False
- P2-2（`2c329e1`）：`session_migrate.py` export/import CLI + `examples/migrate_session.py`；zip+JSONL 沿用 export_reader 约定
- F-069 治理三件套（`999cc2a`/`8837ee9`/`95bb3f1`）：根 `GOVERNANCE.md`（含主张登记簿）；`docs/decisions/` MADR-lite ADR F-061~F-069 + 索引；`.github/PULL_REQUEST_TEMPLATE.md`
- F-069 trace（`30dd7f1`/`3e96abd`）：`python/memory_cloud/tracing.py`（七事件词表、M1 信封 + gen_ai.* 字段、hash-only 默认、never-throw）+ 接入 client.record/retrieve（daemon/cloud 双路由、latency）、parametric 适配器（5 操作 + broker_unavailable 降级事件）、session_migrate（可选 `trace=` 参数）
- 测试基线：Python **191 passed, 1 skipped**（`python/` 下 `pytest tests/ --ignore=tests/test_sdk_functional.py`）；JS **50 passed**（`local/` 下 `node --test`）

## 未决问题与卡点
- **LongMemEval 基准未跑**：`local/` 下运行 `node src/benchmark/recall-eval.mjs --benchmark longmemeval`，要求 R@5 ≥ 96.0；产物路径与门禁见 FIRST_HOP_NONREGRESSION.md。跑通后更新该文件状态与 GOVERNANCE §7 登记簿，PR 可转 Ready。
- **M1 侧未就绪**：`everest-an/M1` main 无 `memory_broker` 包、无 `consolidation_policy`（已核实全部分支与提交历史）。所有参数化功能目前仅 mock broker 测试。M1 合并后需真实联调：pip 装 `awareness-memory-cloud[parametric]` → 跑 `examples/parametric_quickstart.py` 与 `examples/migrate_session.py`。
- **JS trace 二期未立项**：触发条件已写入 GOVERNANCE §5——JS↔Python broker 桥接方案合并时随同一 PR 立项。`conflict_forget` 事件的 Python 触发点在桥接后才存在。
- 需要谁解除：M1 仓维护者（broker 合并）；本人或有 GPU/数据环境者跑基准。

## 下一步计划
1. 跑 LongMemEval 非回归基准（命令见上），更新 FIRST_HOP_NONREGRESSION.md + GOVERNANCE §7 + PR 描述
2. 盯 M1 `memory_broker` 合并动态；合并后做真实联调（quickstart + migrate_session + trace 文件人工检查事件流）
3. 联调通过 → 按 GOVERNANCE §4 立翻转默认值的 ADR → PR #1 转 Ready for review
4. JS↔Python broker 桥接方案确定时，JS trace 随桥接 PR 立项（二期）

## 本次会话的坑与后续注意事项

### 已踩坑
- `gh pr edit` 走 GraphQL 报 Projects classic deprecation 错 → **用 `gh api repos/.../pulls/1 -X PATCH -F body=@file` REST 通道**
- **PR 翻 Ready 不能用 REST PATCH `draft:false`**（draft→ready 单向，API 静默不生效）→ 必须用 GraphQL mutation `markPullRequestReadyForReview(input:{pullRequestId})`，node_id 从 `gh api repos/.../pulls/1 --jq .node_id` 取
- **package.json/lock 同步后必须 `npm install`**：否则 `@noble/hashes` 等缺失会让 anchoring/card-digest 等文件整文件失败，伪装成大面积回归（2026-09-06 triage 实录，见 `docs/js-suite-triage-20260906.md`）
- `node --test` 必须从 `local/` 目录跑；pytest 必须从 `python/` 目录跑（rootdir 由 pyproject.toml 定）
- 本机 Homebrew python 无 pytest/requests，已 `pip3 install --break-system-packages pytest requests pydantic numpy`
- rtk 环境下 pytest/node 输出可能被截断 → 重定向到文件再读；`node --test` 的 TAP 在 **stdout**
- `test_sdk_functional.py` 的 20 个 error 是**存量环境问题**（需 live server localhost:8000），已用 git stash 双向验证与本次变更无关——不要误判为新回归
- mock client（MagicMock）上 `getattr(client, "_trace_writer")` 返回 auto-Mock，trace emit 在既有 mock 测试里是无害调用——新增接入点时保持这个模式即可

### 后续注意事项
- **绝不推送 edwin-hao-ai 镜像**（自动 sync 下游，写入会被覆盖）；上游 403，只推 fork
- 追加提交后直接 `git push fork integration/broker-parametric`，PR 自动更新；PR 描述更新走 REST（见上）
- trace 事件词表变更 = 须立新 ADR（F-069 后果节已写死）；`conflict_forget` 槽位已预留勿删
- M1 的 trace 对齐事项（broker 接受 trace writer、事件词表、session 语义、trace_id 字段）需在 broker 合并**前**提出给 M1——合并后改成本翻倍（GOVERNANCE §5）
- 改 `unifiedCascadeSearch` 的一切 PR 必须先过 LongMemEval 门禁再转 Ready

## 关键决策与上下文
- 全部决策已固化为 `docs/decisions/F-061~F-069`（MADR-lite，含每条的 why 与后果），索引在 `docs/decisions/README.md`——读它们，不要凭记忆重推
- 治理规则在根 `GOVERNANCE.md`：依赖边界（SDK→M1 单向、只经 broker 包、违规即 revert）、决策权（**冲突判定权在本仓**，M1 delta 规则冲突消解已判负——勿"优化"上移）、门禁、默认值翻转三前置、主张登记簿（"本文件为准"纪律）
- trace 两层含义已在会话中对齐：机制 trace（运行时证据，F-069）与治理（规则层）是不同层；用户最终拍板"用社区的方法"（MADR 一决策一文件 + OTel semconv 字段参照 + opt-in 而非 mem0 式 opt-out）
- JS trace 不做一期的理由（无流量可观测、桥接未定、schema 双语言同步成本、热路径门禁期）已写入 GOVERNANCE §5 触发条件，勿提前立项

## 交接说明
- 本文件只总结本次会话，不继承历史 handoff。
- 下次会话第一步：阅读本文件，并从"下一步计划"继续。
