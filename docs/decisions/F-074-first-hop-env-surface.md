# F-074 · 首跳开关的过程级 env 表面

- **状态**: Accepted
- **日期**: 2026-09-06
- **修订**: `local/src/core/search.mjs`、`benchmarks/longmemeval/FIRST_HOP_NONREGRESSION.md`

## 背景

P2-0 首跳 stage 只能通过 `unifiedCascadeSearch(query, {parametricFirstHop: true})`
逐调用启用。daemon 的 MCP handler 从不传该 opt，`run_ab.sh` 想做
with-first-hop 的 A/B 复跑就只能改代码——FIRST_HOP_NONREGRESSION.md
早期版本的 Open questions 记录了这一缺口。

## 决策

增加过程级 env 开关 `AWARENESS_PARAMETRIC_FIRST_HOP`：

- 取值**恰为 `'1'`** 时武装首跳（其余一切值——`'0'`/`'true'`/`' 1'`——均关，
  严格匹配避免 shell 拼接事故）；
- 与逐调用 opt-in 是"或"关系：`opts.parametricFirstHop === true || env === '1'`；
- **默认关不变**（GOVERNANCE §4）：unset 时行为与 main 逐位一致；
- **武装 ≠ 生效**：无 broker 时 stage 依旧 no-op（单元锁定）——env 只是把
  "要不要咨询参数层"的决策从代码编辑提升为进程配置；
- 落点在 `unifiedCascadeSearch` 内部而非 MCP handler，与本文件既有
  `RRF_K`/backend env 风格一致，benchmark/MCP/测试三类调用方同享。

## 后果

- `run_ab.sh` 将来的 ON/OFF A/B 无需代码编辑（broker 就位后即用）。
- 默认行为零变化：env unset 路径被单元测试锁死（off-state 12 例 + F-074 6 例）。
- 不把开关暴露为 MCP 参数——LLM 客户端不应能改变检索层路由；env 属于
  运维面，与召回结果的 opacity 约定（F-053）不冲突。
- 若未来翻转默认值（GOVERNANCE §4 三条件），env 开关自然退役为冗余，
  删除即可（届时 ADR）。
