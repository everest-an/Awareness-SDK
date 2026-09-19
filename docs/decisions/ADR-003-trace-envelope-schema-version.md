# ADR-003 · trace 信封 schema 版本字段（`v`）

- **状态**: Accepted（2026-09-08 采纳并实施）
- **日期**: 2026-09-08
- **提案**: trace JSONL 信封增加常量字段 `v`（schema 版本号）
- **背景**: F-072 词表 7→8 演进暴露了 schema 演进问题：rotation 只保留一代
  （`<path>.1`），但一个 trace 文件本身可能跨越词表变更（daemon 长跑期间
  SDK 升级）；analyze_trace.py 目前靠 unknown-bucket 容错（F-070），但没有
  字段能显式判定"这行事件属于哪版词表"。业界参照：OTel semconv 以
  schema_url 标定 schema 版本；结构化日志惯例（GELF/LogRotator 系）均带
  版本字段。信封加一个常量整数是同思路的最小实现。

## 决议

1. `tracing.py` 增加 `SCHEMA_VERSION = 1`，writer 把 `"v": 1` 盖进每行
   静态字段（与 `channel`/`session_id` 同层）。
2. 词表/字段语义的任何后续变更（依 F-069 须走 ADR）**必须同步递增**该版本
   号；分析器按版本分流是未来选项，当前 unknown-bucket 机制不变。
3. 兼容性：分析器对缺失 `v` 的旧行按 v=1 处理（不破坏既有 trace 文件）。

## 后果

- trace 文件可自描述：跨版本混存时可机读判定词表代际。
- 成本：每行 +4 字节；对本地 opt-in 场景可忽略。

## 与既有决策的关系

- F-069（信封设立）：`v` 属信封扩展字段，本法即其 ADR 依据。
- F-070（分析器 unknown-bucket）：本法为其未来按版本分流铺路，当前不改变行为。
