# 提案 · M1 `memory_broker` 合并前的 SDK↔M1 对齐事项

- **状态**: Proposed（待 M1 侧反馈）
- **日期**: 2026-09-06
- **提出方**: Awareness-SDK（下游消费方）
- **依据**: GOVERNANCE §5 —— 与 M1 的对齐事项须在 `memory_broker` 合并**之前**提出，合并后修改成本视为翻倍。本文件同时是 F-069（SDK trace）与 F-061（依赖方向）的执行附件。

## 背景

SDK 已完成参数化集成线（PR #1）：`MemoryCloudParametric` 适配器、召回首跳、事件钩子、会话迁移、SDK 级 trace（`python/memory_cloud/tracing.py`）。全部参数化功能在 mock broker 上测试通过，等待 `mt_lnn.memory_broker` 在 M1 main 合并后做真实联调。

合并前请 M1 侧确认以下四项。每一项都附了 SDK 侧的现状与具体请求。

---

## 1 · trace writer 注入：broker 需要接受外部观测接口

**SDK 现状**：SDK 有 `MemoryTraceWriter`（JSONL，信封 `{ts, event, session_id, channel, ...fields}`，与 M1 `JsonlMetricWriter` 同形）。SDK 侧的降级路径已 emit `broker_unavailable`（F-062 的"可观测的静默"）；但 broker **内部**的操作（consolidation、遗忘后的相对零判定、快照序列化）SDK 完全看不到。

**请求**：`MemoryBroker` 支持注入一个可选的 trace writer / 回调（构造参数或 setter 均可），broker 在关键操作完成/失败时 emit 事件。最小事件集建议：`write` / `recall`（含 hit 与 latency）/ `forget` / `snapshot` / `restore`，与 SDK 词表同名（见第 2 项）。

**为什么必须在合并前定**：这是 broker 的构造签名与内部埋点，合并后加 = 破坏性变更；GOVERNANCE §5 成本翻倍条款直接适用。

## 2 · 事件词表对齐：同名事件 + `gen_ai.operation.name`

**SDK 现状**：七事件词表已固化（F-069，变更须 ADR）：

| 事件 | 语义 | SDK 触发点 |
|---|---|---|
| `recall` | 召回（route: parametric/cascade/daemon/cloud，hit、latency_ms） | client 双路由 + 适配器 |
| `write` | 写入（content_hash + content_bytes，hash-only） | client.record + 适配器 |
| `forget` | 遗忘（key_hash） | 适配器 |
| `snapshot` | 会话快照（binding_count、state_bytes） | 适配器 + session_migrate |
| `restore` | 快照恢复（binding_count、state_bytes） | 适配器 + session_migrate |
| `conflict_forget` | 冲突取代执行 forget(old)+write(new) | **槽位已预留，无 Python 触发点**（判定在本仓 daemon，F-066） |
| `broker_unavailable` | 静默降级（op + reason） | 适配器全部降级路径 |

**请求**：M1 侧 emit 的事件**采用同名 event 值**，扩展字段命名沿用 `gen_ai.operation.name="memory.*"` 风格（`memory.write` / `memory.recall` / …）。若 M1 已有不可改的既有词表，请给出官方映射表（M1 event → SDK event），SDK 的桥接层按映射表翻译。

## 3 · session 语义：生命周期与 ID 映射

**SDK 现状**：SDK 用 `session_prefix`（默认 `"sdk"`）作 trace 信封的 `session_id`；broker 调用传入的是业务层 session id（如 `"s1"`、`"sess-demo"`），二者目前是**两个命名空间**。

**请求确认三点**：
1. **ID 映射**：broker 的 session 是否就是 SDK 传入的 `session_id` 字符串（1:1，无前缀加工）？若是，SDK trace 侧会把 broker session id 写入 `trace_id` 关联字段，信封 `session_id` 保持 SDK 前缀——两侧按 `trace_id` join。
2. **生命周期**：session 由谁创建/销毁？`forget(session_id)` 后 session 是否整体消失，还是仅清空？`restore` 是否复活已销毁的 session？
3. **并发语义**：同一 session_id 并发 write/recall 是否安全（SDK 侧钩子是 fire-and-forget，存在并发窗口）。

## 4 · trace_id 透传：跨仓事件关联键

**SDK 现状**：`recall` / `write` 事件已带可选 `trace_id`（调用链关联）。

**请求**：broker 方法支持透传 `trace_id`（kwargs 末尾可选参数即可，如 `broker.write(..., trace_id=...)`），broker emit 的事件携带同值。这样 SDK 事件与 M1 事件可以按 `trace_id` 关联成一次完整调用链（GOVERNANCE §6 的方向治理要消费 `recall` 的 route/hit/latency——跨仓归因依赖这个键）。

---

## 附 · SDK 已依赖的契约面（合并时请勿破坏）

以下是 `MemoryCloudParametric`（`python/memory_cloud/integrations/parametric.py`）已按 mock 实现锁定的调用形态，单测已冻结：

```python
MemoryBroker(**broker_config)                     # 构造：全部参数可选（d_mem/update_rule/decay/eta…）
broker.write(session_id, key=, value=, update_rule=)
broker.recall(session_id, query=, top_k=, candidates=)   # 返回 (value, score) 对的可迭代；value=None 表示无记忆（相对零判定在 M1 侧完成，F-064）
broker.forget(session_id, key=)                   # 返回删除计数
broker.snapshot(session_id)                       # 返回可序列化状态（含 state_bytes）
broker.restore(session_id, snapshot)
```

相对零阈值判据（`|qF| ≤ 1e-5·|F|` → 无记忆）**留在 M1**（F-064：SDK 采信 broker 的非空返回，不做二次判定）——请 M1 在合并时保证该行为有测试背书并在 broker 文档注明阈值常数。

## 交付与流程

- M1 侧反馈后，本文件状态改为 Accepted（附 M1 issue 链接）；有修改则按修改落地。
- JS↔Python broker 桥接方案确定时，JS trace 随同一 PR 立项（F-069 后果节；`conflict_forget` 的桥接触发点同步落地）。
- 本提案不改变任何 SDK 默认值；联调通过前三个开关保持默认关（GOVERNANCE §4）。
