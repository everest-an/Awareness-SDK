# F-072 · trace 二期：采样/频控与传输层错误事件

- **状态**: Accepted（2026-09-08 采纳并实施）
- **日期**: 2026-09-07（提案）；2026-09-08 采纳
- **提案**: 扩展事件词表（7→8）；为 writer 增加采样/频控配置
- **采纳记录**: 用户 2026-09-08 会话授权全量执行，本法随 F-071/F-073 一并采纳。
  词表变更依 F-069 走 ADR——本文件即该 ADR。业界对标（OTel head/tail 采样、
  Langfuse 错误优先埋点）见 LEDGER S4 搜索发现：本设计与其混合式最佳实践同构。

## 实施记录（2026-09-08）

- `tracing.py`：`log_transport_error()`（op/route/error_class/status/latency_ms/
  trace_id，内容零记录）+ `MIN_INTERVAL_ELIGIBLE`（recall/write）/`NEVER_SAMPLED`
  （broker_unavailable/transport_error/forget/conflict_forget）+ writer
  `min_interval_ms`（参数 > `AWARENESS_TRACE_MIN_INTERVAL_MS` env > 关）+
  `_suppressed_count` 聚合携带。
- `client.py`：云路由在 `_request_response` 收口埋点（op 由
  `_op_from_request` 从 method+path 无内容分类，内存 ID 不落盘）；daemon
  路由在 `call_local_daemon` 收口埋点（op 用 `DAEMON_OP_NAMES` 映射）。
  **仅最终失败 emit**——可重试中间态不是事件；`_probe_daemon` 探活失败是
  auto 模式正常回退路径，不属于传输错误，不埋点。
- `analyze_trace.py`：`transport_error` 聚合（total/by_op/by_route/
  by_error_class/by_status）。
- 测试：test_tracing 12 例新增、test_analyze_trace 1 例、
  test_client_transport_trace 6 例（云 connect/timeout/http_status 单次
  emit、daemon 双类、成功路径零事件）。
- **close() 冲刷**（2026-09-08 验收补充）：run 结束窗口内的 pending
  `_suppressed_count` 由 close() 以终行冲刷（绕过频控门——冲刷行若落在
  自己的窗口内会被门拦掉）；幂等、never-raise。停机不再丢量级信息。
- **session_id 贯通**（2026-09-08 验收补充）：record/ingest/chat/insights
  等会话感知流程的 transport_error 携带真实 session_id（信封覆写语义，
  与 7072b9b 的成功路径同轴可归因）；无会话端点（list/get 等）保持
  client 前缀不被覆写——transport_error 行出现真实 session id 即代表
  该操作知道自己的会话。daemon recall 不携带（F-053 单参数面下会话由
  daemon 服务端分配，客户端不可知）。

## 背景

F-070 工程化审计（2026-09-07）确认 trace 机制的两个二期缺口：

1. **无采样/频控**：本地 opt-in 场景下 JSONL 量级可控，但高频调用（daemon
   长跑、批量任务）下 `recall`/`write` 成功事件会成为体量大头；rotation
   （F-070）只解决单文件大小，不解决写入量与信息密度。
2. **错误路径埋点不全**：broker 降级有 `broker_unavailable`，但 client 的
   HTTP 失败路径（daemon 不可达、超时、非 2xx）目前不 emit 任何事件——
   行业惯例是错误路径优先于成功路径埋点（错误稀有且高价值）。

## 决议（已实施）

### 1. 词表扩展：新增 `transport_error`（7→8 事件）

- 触发点：`MemoryCloudClient` 的 daemon/cloud HTTP 路径失败（连接错误、
  超时、非 2xx），覆盖 record/retrieve 双路由。
- 字段：`op`（create_memory/search/…）、`route`（daemon/cloud）、
  `error_class`（connect/timeout/http_status）、`status`（非 2xx 时）、
  `latency_ms`。内容零记录（与 hash-only 纪律一致）。
- Python 触发点本次提案即存在（与 `conflict_forget` 的"桥接后才有触发点"
  不同，无需等桥接）。

### 2. 采样/频控设计（仅约束成功类高频事件）

- **永不采样**：`broker_unavailable`、`transport_error`、`forget`、
  `conflict_forget`——错误与稀有事件全量保留（信息密度最高、量最小）。
- **min-interval 频控**：`recall`/`write` 成功事件按事件类型设最小间隔
  （默认关闭；`AWARENESS_TRACE_MIN_INTERVAL_MS` env 或 `min_interval_ms=`
  参数）。间隔内的事件以计数器聚合（`_suppressed_count`），间隔结束时的
  下一条事件携带累计数——不丢量级信息，只去重复密度。
- **不采用概率采样**作为默认：本地优先产品里可复现性 > 音量；概率采样留作
  超大规模场景的可选后续。

### 3. 错误路径优先埋点原则

后续任何埋点扩展，错误/降级路径的覆盖优先级高于成功路径（§6 最低证据集
的延伸：治理消费的证据集中在异常与延迟，正常路径密度反而损害信噪比）。

## 后果

- 词表 7→8：`transport_error` 进入 F-069 词表；`analyze_trace.py` 同步
  识别（unknown-bucket 机制保证旧分析器不崩，见 F-070 设计）。
- writer 增加 `min_interval_ms` 配置面（默认关——默认行为不变，符合
  "新能力默认关"门禁第 2 条精神）。
- 事件流体积在 daemon 长跑场景可控；rotation 继续兜底单文件大小。

## 与既有决策的关系

- F-069（词表设立）：本法是其"变更须 ADR"条款的首次行使。
- F-070（执行设施）：rotation 已落地；本法补"写入量"维度；分析器的
  unknown-bucket 是本法零破坏落地的保障。
