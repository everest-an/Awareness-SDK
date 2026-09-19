# LOOP AMENDMENTS — 循环机制提案制（立法史）

> 本文件是自循环自身演化的**唯一合法通道**：改 GOAL-PROMPT、惯例节、
> GOALS 语义、指数口径 = 一律走提案。执行会话只有起草权（ADR-002 同款
> 边界）；用户批准后状态改 ADOPTED 并可落地。正文不可变，勘误开新 AMM
> 双向注记。
> 状态取值：`PROPOSED` / `ADOPTED` / `REJECTED` / `RETIRED`。
> **A 维度计量即来自本文件状态列**——状态列必须真实（Physic 前车之鉴：
> 手工不维护导致 A=0/0 与十余条生效机制矛盾）。

| AMM | 标题 | 状态 | 日期 |
|---|---|---|---|
| [AMM-001](#amm-001) | 自循环机制整体移植自 AwareLiquid-Physic（docs/loop 七件套 + scripts/loop 三件 + 按 SDK 现实适配） | ADOPTED | 2026-09-19 |

---

### AMM-001

- **状态**: ADOPTED（用户指令"把它的机制移植过来，开始执行"，2026-09-19）
- **日期**: 2026-09-19

**决策**：将 AwareLiquid-Physic `docs/loop/` 自循环机制整体移植至本仓，
按 SDK 现实做四处适配（其余原样保留）：

1. **DEBT-FIRST → GATE-RED**：SDK 无 GPU 算力债；它的"欠账"对应物是
   三 lint 门禁（claims / adr-index / version-sync）——任一红 = 最高优先
   （goal_check 退出码 4），工程欠账另立 DEBT-LEDGER（L-debt 本机可执行 /
   C-debt 等外部）。
2. **蒸馏轮语义**：Physic 的"文献扫描补池"改为"工程化蒸馏轮"（业界做法
   扫描：OpenSSF Scorecard 项、CI/CD 实践、SDK 工程惯例），入库硬标准
   （可复核出处+适用条件+验证状态）原样保留。
3. **判读落点**：Physic 判读写 PRD §19；SDK 无 §19——新建
   `docs/loop/LOOP-LOG.md`（append-only）作为判读锚与历史文件，GOALS 从
   第一天起就只留现态（吸取 Physic 元状态文件日志化教训，见 Physic 评估
   报告诊断 1）。
4. **RSI-INDEX 瘦身**：复合指数暂不设公式（首窗口后预注册）；0.6 锚待
   PR #1 合并日校准；A 维度从第一天起机械计量（grep 本文件状态列）。

**保留不动的承重墙**（从 Physic 原样移植）：预注册验收双锚、goal_check
路由器（含空 check_cmd 假阳性防护）、marathon_guard 单马拉松锁、心跳分支
结构、PLAYBOOK 坑清单格式（出处+适用条件+验证状态）、提案制、
BLOCKED-HUMAN 停机语义。

**与既有机制的关系**：取代 `~/Projects/iteration-control/`（LEDGER + cron
夜间轮）作为本仓的常设自循环——iteration-control 保留为历史台账（09-07
批次的账与护栏教训仍可引用），不再新建批次。
