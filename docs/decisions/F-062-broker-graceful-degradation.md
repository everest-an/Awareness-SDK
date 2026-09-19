# F-062 · broker 不可达时优雅降级，不硬依赖

- **状态**: Accepted
- **日期**: 2026-09-06

## 背景

`mt_lnn.memory_broker` 尚未在 M1 合并（F-061）。参数化功能若硬依赖它，用户在包发布前完全装不上 SDK；即便发布后，torch 等重依赖也可能让部分环境装不了。

## 决策

所有 broker 导入走 try/except；包缺失或构造失败时，参数化操作降级为带日志的 no-op / 空结果，业务路径（daemon/cloud 通道）完全不受影响。适配器暴露 `broker_available` 供调用方探测。

## 后果

- SDK 任何环境下都可安装、可 import。
- 降级是静默的——这正是需要机制 trace（F-069）记录 `broker_unavailable` 事件的原因：把"静默"变成"可观测的静默"。
- mock broker 测试覆盖降级路径；真实 broker 联调是翻转默认值的前置条件（GOVERNANCE §4）。
