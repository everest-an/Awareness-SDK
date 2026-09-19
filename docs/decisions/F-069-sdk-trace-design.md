# F-069 · SDK 级 trace：M1 信封 + OTel 字段映射 + opt-in hash-only；设立治理体系

- **状态**: Accepted
- **日期**: 2026-09-06

## 背景

参数化集成线（F-061~F-068）大量使用静默降级与 fire-and-forget 钩子，运行时不可观测；同时工程协作缺少成文规约。对标结论：M1 的 JsonlMetricWriter 信封与 PR 门禁纪律可直接借用；大厂 SDK（OpenAI/Vercel）证明核心包应零观测依赖、opt-in；社区标准是 OTel GenAI semconv（字段命名）与 MADR（决策记录）；mem0 的 opt-out 遥测不适用本仓（本地优先、隐私敏感）。

## 决策

1. **机制 trace**（`python/memory_cloud/tracing.py`）：JSONL writer，信封沿用 M1 `{ts, event, session_id, channel}`，扩展字段参照 `gen_ai.*` 风格并文档化映射表。默认关（`trace_path`/`AWARENESS_TRACE_PATH`），hash-only（sha256 前 16 位，`full_content` 显式放开），never-throw（写失败静默自禁用）。事件词表七个：recall / write / forget / snapshot / restore / conflict_forget / broker_unavailable。核心包**不引入 OTel SDK 依赖**——桥接留给文档化映射。
2. **治理**（`GOVERNANCE.md`）：依赖边界 / 决策权 / 门禁 / 默认值 / 方向前置证据 / 接口 / 主张登记簿（学 M1 RESULTS.md "本文件为准"）。
3. **决策记录**（`docs/decisions/` MADR-lite）：一决策一文件（社区标准），F-xxx 编号续接。
4. **PR 模板**（`.github/PULL_REQUEST_TEMPLATE.md`）：学 M1——门禁 checklist、数字须来自脚本产物、未完成项强制声明、AI 披露。

## 后果

- 四个盲区（降级不可见、钩子零观测、召回不可归因、迁移无凭证）关闭；治理获得证据来源。
- `conflict_forget` 事件当前无 Python 触发点（判定在 JS 层，见 F-066）——词表预留，触发点在未来 JS↔Python broker 桥接（届时 JS trace 随同一 PR 立项，GOVERNANCE §5）。
- trace 事件词表的任何变更须走本决策记录流程（改字段 = 新决策或本文件 Superseded）。
- 本决策同时设立 GOVERNANCE.md 与 docs/decisions/ 体系本身（自举条目）。
