# 决策记录（Architecture Decision Records）

格式：MADR-lite（状态 / 日期 / 背景 / 决策 / 后果），一决策一文件。

**命名空间（ADR-001 起分离）**：

- **F-061 ~ F-075：冻结遗留块**——编号与上游 feature/fix 标记（F-053~F-088…）
  同源冲突（F-064/F-072 已实际双义），自此冻结不再新增。引用时必须带文件链接。
- **ADR-001 起：新决策命名空间**——`ADR-<NNN>-<slug>.md`，与上游编号彻底分离。

状态取值：`Proposed` / `Accepted` / `Superseded by ADR-xxx` / `Deprecated`。

## 遗留块（F-061 ~ F-075，冻结）

| 编号 | 标题 | 状态 | 日期 |
|---|---|---|---|
| [F-061](F-061-dependency-direction.md) | 依赖方向 SDK→M1 单向，只经 memory_broker 包 | Accepted | 2026-09-06 |
| [F-062](F-062-broker-graceful-degradation.md) | broker 不可达时优雅降级，不硬依赖 | Accepted | 2026-09-06 |
| [F-063](F-063-first-hop-pure-prepend.md) | 召回首跳纯前插、默认关 | Accepted | 2026-09-06 |
| [F-064](F-064-relative-zero-threshold.md) | 首跳命中判据沿用 M1 相对零阈值 | Accepted | 2026-09-06 |
| [F-065](F-065-hook-switches-independent-default-off.md) | 事件钩子双开关独立、默认 False | Accepted | 2026-09-06 |
| [F-066](F-066-conflict-decision-stays-local.md) | 冲突判定权留在本仓，参数层只执行 | Accepted | 2026-09-06 |
| [F-067](F-067-migration-zip-jsonl.md) | 会话迁移沿用 export_reader 的 zip+JSONL 格式 | Accepted | 2026-09-06 |
| [F-068](F-068-bit-exact-parametric-only.md) | bit-exact 保证只覆盖参数化层 | Accepted | 2026-09-06 |
| [F-069](F-069-sdk-trace-design.md) | SDK 级 trace：M1 信封 + OTel 字段映射 + opt-in hash-only；设立本治理体系 | Accepted | 2026-09-06 |
| [F-070](F-070-governance-execution-infrastructure.md) | 治理与 trace 的工程化执行设施：CI / trace 分析器 / A-B 一键化 / 主张校验 | Accepted | 2026-09-06 |
| [F-071](F-071-gate-text-vs-substance.md) | §3 字面门禁 vs §5 实质非回归：同环境基线 + A/B 零回归证据双条件（随 PR #1 合并生效） | Accepted | 2026-09-06 |
| [F-072](F-072-trace-phase2-sampling-and-transport-error.md) | trace 二期：采样/频控（min-interval，错误事件永不采样）+ `transport_error` 词表扩展 7→8 | Accepted | 2026-09-07 |
| [F-073](F-073-claims-evidence-mapping.md) | 主张-证据显式映射文件（CLAIMS.md 模式）：声明式 lint + 撤回生命周期 + 90 天时效 | Accepted | 2026-09-07 |
| [F-074](F-074-first-hop-env-surface.md) | 首跳开关的过程级 env 表面（AWARENESS_PARAMETRIC_FIRST_HOP，默认关） | Accepted | 2026-09-07 |
| [F-075](F-075-session-metadata-store.md) | 会话元数据存储——补全 P2-1 快照路径承诺；trace 携带真实会话 id | Accepted | 2026-09-07 |

## 新命名空间（ADR- 起）

| 编号 | 标题 | 状态 | 日期 |
|---|---|---|---|
| [ADR-001](ADR-001-decision-namespace-split.md) | 决策记录命名空间分离：冻结 F-编号，启用 ADR- 前缀 | Accepted | 2026-09-07 |
| [ADR-002](ADR-002-automation-agent-authority-boundary.md) | 自动化迭代代理只有起草权——权限边界入 §2 决策权表（F-071 事故制度化） | Accepted | 2026-09-08 |
| [ADR-003](ADR-003-trace-envelope-schema-version.md) | trace 信封 schema 版本字段 `v`（词表演进的前向兼容） | Accepted | 2026-09-08 |

新决策：复制任一文件的五节骨架，`ADR-` 编号递增，同步更新本表。引用 ADR 必须带文件链接，不用裸编号。
