# M1 `mt_lnn.memory_broker` 契约蓝本（DRAFT FOR M1 REVIEW）

- **状态**: DRAFT —— 供 M1 维护者评审；采纳前不构成任何一方的义务
- **日期**: 2026-09-07
- **来源**: ① `docs/m1-broker-alignment-proposal.md` 四项请求 ② SDK 侧已锁定的
  调用形态（`python/memory_cloud/integrations/parametric.py`，测试冻结）③
  参考实现 `python/memory_cloud/_dev_stubs/broker.py`（同形状 dev stub，
  使 SDK 的真实代码路径可在 M1 发布前受契约测试覆盖）
- **配套**: `tests/test_real_broker_contract.py`（SDK 侧契约测试 = 本文件
  第 8 节的可执行形式）

---

## 1. 公开面

### 构造

```python
MemoryBroker(**config)   # config 全可选：d_mem=128, update_rule, decay, eta, ...
```

- 内部委托 `parametric_memory.ParametricMemory`（M1 决策域），broker 只做
  契约面包装，不复制其逻辑。
- `trace_writer` 可注入（见 §4）。

### 方法（签名 = SDK 调用形态，逐条对应 `parametric.py`）

| 方法 | 签名 | 返回 | SDK 调用点 |
|---|---|---|---|
| `write` | `(session_id, *, key, value, update_rule=None, trace_id=None)` | 结果 dict（含 `ok`/`error`，形态见 §7） | L224 |
| `recall` | `(session_id, *, query, top_k=5, candidates=None, trace_id=None)` | 可迭代的逐命中记录，形状见 §2 | L256 |
| `forget` | `(session_id, *, key=None, trace_id=None)` | 删除计数（truthy 即有删除） | L300 |
| `snapshot` | `(session_id, trace_id=None)` | 可序列化状态（含 `state_bytes`）或 `None`（空会话） | L325 |
| `restore` | `(session_id, snapshot, trace_id=None)` | `None`；恢复后逐绑定 recall 逐位一致 | L353 |
| `state_bytes` | `(session_id)` | `int` | — |
| `policyWrite` | `(session_id, event: dict)` | `None`（可选；SDK 存在即优先用它承载固化策略事件） | — |
| `getActiveSessionId` / `sessions` | — | `str \| None` / `list[str]` | 观测面 |

## 2. recall 返回形状（本蓝本裁决的第一件事）

SDK **不钉死单一形状**，逐命中记录接受两种：

```python
(value, score)                      # M1 ParametricMemory 原生元组
{"value": ..., "score": ...}        # dict 形式
```

SDK 按 duck-typing 解包（`parametric.py` L263-268），`value is None` 的条目
视为无记忆并过滤（F-064）。**建议 M1 规范化为元组**（与其内部实现一致，
dict 形式仅为兼容保留）。`score` 语义：越大越相关，符号不限。

## 3. 相对零阈值（F-064：判据留在 M1）

- forget 之后 `|qF| ≤ 1e-5·|F|` → 视为无记忆，`recall` 返回 `value=None`
  的条目（或直接不返回该条）。
- 阈值常数与判据正确性由 M1 的测试背书；SDK 不做二次判定。
- 若 M1 调整阈值常数，SDK 无需改代码——这是判据放 M1 的收益。

## 4. trace 注入与事件（对齐提案 ①②）

- 注入：`MemoryBroker(..., trace_writer=w)` 或 `set_trace_writer(w)`。
  writer 是 duck-typed `write(event, fields)` 调用（SDK 侧为
  `MemoryTraceWriter`，M1 侧可用自己的实现）。
- 信封沿用 `{ts, event, session_id, channel}`（M1 `JsonlMetricWriter` 形状）；
  broker 侧 `channel="memory_broker"`（与 SDK 的 `"memory_trace"` 区分，
  两侧事件可按 `session_id`/`trace_id` join）。
- 事件词表与 SDK 七事件一致（recall/write/forget/snapshot/restore/
  conflict_forget/broker_unavailable）；broker 侧最低产出集：
  `recall`（hit、latency_ms）+ 操作失败事件。词表任何变更走双方 ADR。

## 5. session 语义（对齐提案 ③ —— M1 必须裁定的 OPEN QUESTIONS）

| # | 问题 | SDK 临时假设（可被 M1 裁定推翻） |
|---|---|---|
| Q1 | session 由谁创建？ | 首次 write 隐式创建 |
| Q2 | `forget(session_id, key=None)` 是清空还是销毁？ | 清空绑定，session 仍存在 |
| Q3 | `restore` 能否复活未创建/已清空的 session？ | 能（restore 即创建+灌入） |
| Q4 | 同 session 并发 write/recall 是否安全？ | broker 内部串行化；SDK 钩子是 fire-and-forget，存在并发窗口 |

## 6. trace_id 透传（对齐提案 ④）

全部方法接受可选 `trace_id: str`（kwargs 末位），broker emit 的事件携带
同值。SDK 侧以此把自身 trace 事件与 broker 内部事件关联成一次调用链
（GOVERNANCE §6 方向治理的跨仓归因依赖此键）。

## 7. 错误约定（SDK 降级触发条件，F-062）

- **miss（业务正常）**：recall 无命中 / forget 无匹配 → 正常返回空/零，
  **不抛异常**。
- **infra failure（基础设施故障）**：抛异常。SDK 捕获后 emit
  `broker_unavailable` 并降级（不向用户冒泡）。
- broker 不可 import / 构造失败：SDK 侧整体降级（F-062，已在 SDK 测试覆盖）。

## 8. 测试期望清单（= `test_real_broker_contract.py` 的可执行形式）

1. 七方法存在且签名兼容（kwargs 形态）
2. write → recall 同 session 命中；`value is not None`
3. recall 支持 dict 与 tuple 两种逐命中形状（SDK duck-typing）
4. snapshot → restore 往返：`state_bytes` 一致 + 逐绑定 recall 逐位一致
5. forget(key) 后该 key recall 为空；`forget(session, key=None)` 清空语义（Q2）
6. trace 注入后 broker emit 事件带 `channel="memory_broker"` 与 `trace_id`
7. 异常路径：infra failure 抛出（供 SDK 降级）；miss 不抛

## 9. OPEN QUESTIONS 汇总

Q1-Q4（§5）+ ① snapshot 的版本化/跨版本兼容承诺 ② `candidates` 参数的
语义与默认 ③ `policyWrite` 的事件 schema（与 M1 consolidation_policy 对接）。
