# Security Policy（安全策略）

## 支持的版本

本仓处于参数化集成线（PR #1）阶段，仅 `integration/broker-parametric` 分支
与其产物（PyPI/npm 包的对应 tag）接受安全修复。其余历史版本不维护。

## 报告漏洞

**请不要用公开 issue 报告安全漏洞。**

- 首选：GitHub 私密漏洞报告（本仓 Security → Report a vulnerability）
- 备选：仓库所有者的 GitHub 账号私信（@AricRedemption）

报告请包含：受影响的包/路径、复现步骤或 PoC、影响评估。我们承诺：

1. 72 小时内确认收到；
2. 7 天内给出初步评估（是否接受、严重级别、修复计划）；
3. 修复发布前不公开细节；接受后 CVE/致谢与报告者协商。

## 范围与边界

- 本 SDK 的隐私纪律是**本地优先**：trace 默认关、hash-only（sha256 前 16 位，
  非可逆）、never-throw。若发现任何路径在未 opt-in 时把内容明文落盘或外发，
  属最高优先级漏洞。
- 本仓依赖方向为 SDK→M1 单向、只经 `mt_lnn.memory_broker` 包（GOVERNANCE §1）；
  M1 侧问题请报给 M1 仓（github.com/everest-an/M1）。
- 供应链相关说明：CI 的 workflow token 为只读最小权限、依赖版本固定
  （ci.yml）、基准数据集 sha256 校验（benchmark.yml）。发现供应链异常
  （依赖劫持、workflow 篡改）同样走上述私密通道。

## 已知非漏洞

- `trace_full_content=True` / `full_content=True` 显式开启后 trace 明文落盘——
  这是文档化的 opt-in 行为，不是漏洞。
- `AWARENESS_TRACE_PATH` 指向攻击者可控路径时的行为由使用者负责（本地
  优先产品，环境即信任边界）。
