# F-067 · 会话迁移沿用 export_reader 的 zip+JSONL 格式

- **状态**: Accepted
- **日期**: 2026-09-06

## 背景

P2-2 会话迁移需要打包格式。可选：新造专用格式（如二进制序列化），或沿用仓内既有约定。

## 决策

沿用 `python/memory_cloud/export_reader.py` 的 zip+JSONL 约定：manifest.json + 领域目录（parametric/snapshot.json + parametric/bindings.jsonl）。restore 只读 snapshot.json（bit-exact 源），bindings.jsonl 仅为人工检查的 sidecar。

## 后果

- 已有的 export_reader 工具可以直接读迁移包的部分内容。
- 复用用户对导出格式的已有认知，无新格式文档负担。
- zip+JSONL 对 (F, z) 张量用 base64（M1 snapshot 原生格式），体积比二进制大约 33%——单会话 O(1) 状态（~66KB @ d=128），可接受；若未来状态膨胀再议二进制容器（届时立新决策）。
