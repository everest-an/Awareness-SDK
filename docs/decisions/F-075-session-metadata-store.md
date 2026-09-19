# F-075 · 会话元数据存储——补全 P2-1 的快照路径承诺

- **状态**: Accepted
- **日期**: 2026-09-06
- **修订**: `local/src/daemon/session-metadata.mjs`（新）、`local/src/daemon.mjs`、`local/src/daemon/parametric-hooks.mjs`

## 背景

P2-1 规格要求会话结束时"快照路径**写进会话元数据**"。实现里 hooks 用
`typeof daemon._setSessionMetadata === 'function'` 防御性调用，但 daemon
上从未定义该方法——检查恒 false，元数据写入**静默 no-op**。快照文件落盘了，
但"哪个会话对应哪个快照"的关联不存在，P2-2 迁移场景按元数据找快照时会断。

## 决策

1. 新增 `local/src/daemon/session-metadata.mjs`：一 workspace 一份
   `<awarenessDir>/session-metadata.json`，形如 `{[sessionId]: {[key]: value}}`；
   整文件原子写（tmp+rename）；损坏文件视为空并在下次保存时覆盖——本存储是
   指针辅助，不是状态源（快照文件本身承载状态）。
2. daemon 挂载 `setSessionMetadata/getSessionMetadata`（惰性加载、never-throw、
   失败降级 DEBUG 日志）。
3. hooks 调用点从 `_setSessionMetadata` 改为真实方法 `setSessionMetadata`
   （保留 typeof 防御以兼容测试桩）。
4. 同 PR 内的 trace session_id 覆写（log_* helpers 新增可选 `session_id`
   参数）：parametric/迁移/client record 事件现携带**真实记忆会话 id**，
   不再只落 client 前缀——GOVERNANCE §4 要求的翻转证据（按会话聚合命中率/
   降级频率）因此可用。词表未变（session_id 本就是信封 static 字段，
   fields 覆写是既有语义），不构成 F-069 的词表变更。

## 后果

- P2-1 规格承诺兑现；P2-2 迁移可按元数据定位快照。
- 写放大可忽略：每会话结束一次小 JSON 原子写。
- 7 个新单测锁定行为（roundtrip/重启恢复/损坏恢复/原子性/缺目录）。
