# GOAL-PROMPT — 自循环马拉松提示词（正本，随 AMENDMENTS 演化）

> **会话角色**：粘贴本文件的是**执行会话**——按 GOALS.md 程序计数器迭代：
> 门禁红修门禁 → 队列目标 → （判据满足时）收口。体系设计/治理改动在独立
> 设计会话进行（AMENDMENTS 提案制）；执行会话不改机制。
> **版本：v1.0（AMM-001 移植自 AwareLiquid-Physic）**

> 用法：在 Awareness-SDK 工作区**新开一个 ZCode 会话**，整段粘贴。
> 第一行必须是 `/goal` 开头。
> 本文件由 AMENDMENTS 提案制维护；改这里的规则 = 改循环自身，走提案。

```text
/goal 按 docs/loop/GOALS.md 的 goal_queue 持续自循环：每轮心跳运行
./scripts/loop/goal_check，严格按其 VERDICT 与提示行动；每心跳产出一个可验收
成果，验收（三 lint + Python pytest + JS 门禁套件全绿）后原子提交 push 到
fork。循环不自行停止，直至手动停止或触发收口。

## 心跳分支（细则以 goal_check 输出为准）
4 GATE-RED=三 lint（claims / adr-index / version-sync）有红 ⇒ 先修门禁，
  禁蒸馏禁队列迭代（SDK 版 DEBT-FIRST：门禁是本仓的"欠账"）
0 ACHIEVED=弹出晋升（判读写 docs/loop/LOOP-LOG.md）
1 NOT-Achieved=对队首目标迭代一步（未达成不停）
2 QUEUE-EMPTY=工程化蒸馏轮：扫描业界做法/社区实践，入库条目须含
  【出处链接+适用条件+验证状态】并分流（操作类→PLAYBOOK；工具类→TOOLS；
  方向类→GOALS 队尾）；同 query 族换法 ≤3 次；连续 2 轮无行动类产出 ⇒ 评估收口

## 启动/收尾
启动：./scripts/loop/marathon_guard，exit 1 ⇒ 已有马拉松，确认状态即结束。
收口（S1 连续 2 蒸馏轮无行动产出 / S2 队列清空且无新欠账 / S3 手动）
⇒ state: IDLE + 收尾记录（RSI-INDEX 入账），保留重入口：上游评审动态/
用户指令/新欠账。
收尾：LOOP-LOG 判读补齐 → RSI-INDEX 指数入账 → 删 .loop-lock → 结束。

## 纪律
- 门禁先行：任何提交前三 lint（check_claims / check_adr_index /
  check_version_sync）+ pytest（python/ 下）+ JS 门禁套件（local/ 下）全绿；
  新装依赖必须同步 ci.yml。
- 分支：只推 fork 的 integration/broker-parametric；绝不推 main、绝不推
  edwin-hao-ai 镜像、绝不 force push（GOVERNANCE §1 + HANDOFF 护栏）。
- 原子提交：协议+代码+结果+台账同一 commit；commit 正文引用目标 ID。
- 机制红线：trace 词表、GOVERNANCE 文本、门禁阈值、默认值——一律不动
  （修订走 ADR，决策权在人；ADR-002：自动化代理只有起草权）。
- 结论分级：本地实测才可写"已验证"；CI 未跑前不写"CI 通过"；
  引用第三方数字必带出处（claims lint 把关）。
- 每轮回写 PLAYBOOK ≥1 条（坑或被验证的做法）；新工具入 TOOLS。
- 需人决策 ⇒ state: BLOCKED-HUMAN 停止；上下文过长/卡两轮 ⇒ 快照进 GOALS
  后重开续跑。

## 记录与治理
判读一律写 docs/loop/LOOP-LOG.md（锚："<目标ID> 判读"）；GOALS 只留现态。
机制改动只走 AMENDMENTS 提案，不自改本 prompt 与惯例节；PLAYBOOK 坑清单
可直接追加。

## 项目配置
分支：integration/broker-parametric（fork: AricRedemption/Awareness-SDK），
方向切子分支，毕业开 PR 走上游评审；不改历史判定；不提交大产物
（benchmarks 结果 JSON 除外——它们是门禁证据）。
真相源：GOVERNANCE.md=宪法，docs/decisions/=决策谱系，GOVERNANCE §7 +
CLAIMS.md=数字主张，GOALS=元状态，DEBT-LEDGER=欠账，RSI-INDEX=指数，
LOOP-LOG=判读与历史。
```
