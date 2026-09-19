# LOOP DEBT-LEDGER — 工程欠账台账（循环元状态账本）

> 移植自 AwareLiquid-Physic（AMM-009 精神，AMM-001 落地）。SDK 的"欠账"
> = **已定义验收标准的待执行工程项**（区别于队列目标：欠账是已立项待执行
> 或等外部的，队列是可立即迭代的）。每收尾轮更新。
> **分级**：**L-debt** = 本机可执行（阻塞 GATE-RED 级清理之外的心跳优先级，
> 心跳应先清欠再迭代队列）；**C-debt** = 等外部（上游评审/用户点击/云环境），
> 挂起不阻塞循环，债龄 >5 个心跳轮一次性升级 BLOCKED-HUMAN 提请。
>
> 另有一类特殊"门禁债"：三 lint（claims/adr-index/version-sync）任一红 =
> GATE-RED，**永远最高优先**（goal_check 自动裁决），不入本表——本表只记
> 门禁绿时仍欠的工程项。

## 台账

| id | 事项 | 验收锚 | 档位 | 预计 | 状态 | 登记日 | 债龄(心跳轮) |
|---|---|---|---|---|---|---|---|
| E-1 | fork CI 首次启用（Actions 页 UI 点击，API 无等价物）+ 首跑验证六 job 全绿 | fork Actions 页出现绿 run | **C-debt**（等用户点击） | 点击后 ~10min | open | 2026-09-08 | 0 |
| E-2 | CodeQL SAST workflow（Scorecard SAST 项；python + JS 两 matrix） | .github/workflows/sast.yml 落地 + LOOP-LOG 判读 | **L-debt** | ~40min | open | 2026-09-08 | 0 |
| E-3 | PyPI/npm 发布链 provenance（PEP 740 attestation + npm provenance；需 tag 触发发布改造，版本纪律已由 check_version_sync 把关） | publish workflow 含 attestation 步骤 + LOOP-LOG 判读 | **L-debt** | ~1h | open | 2026-09-08 | 0 |
| E-4 | PR #1 正文与合并后动作清单维护（评审意见逐条落地；合并 = F-071 生效） | 上游评审动态 | **C-debt**（等上游） | 随评审 | open | 2026-09-08 | 0 |
| E-5 | M1 broker 真实联调（feat/consolidation-policy 合并后：parity 转正 + quickstart/migrate_session + trace 事件流检查 + 三翻转 ADR） | GOVERNANCE §4 三 ADR 落地 | **C-debt**（等 M1） | 数小时 | open | 2026-09-08 | 0 |

## 指标（每收尾轮必算，与 RSI-INDEX B 维度同步）

| 指标 | 定义 | 当前值 | 报警线 |
|---|---|---|---|
| D_count | open 欠账条数（L:3 / C:2） | 5 | L-debt >0 ⇒ 心跳优先清欠（门禁红除外） |
| D_min | L-debt 预计总时长 | ~1h40m | — |
| age_max | 最老 open 债龄（心跳轮） | 0（新台账） | L-debt >5 ⇒ 升级 BLOCKED-HUMAN |
| digest_rate | 已结案 / 累计登记 | 0/5（新台账） | 连续 2 收尾夜 =0 且 D_count>0 ⇒ 优先级最高 |

## 状态机

open →（心跳认领）→ running →（验收锚满足）→ closed
                        ↘（前置消失/被新方案取代）→ void（留理由一行）

## 清偿顺序

1. E-1（一键的事，价值最大——解锁六 job 实跑验证）；
2. E-2 → E-3（L-debt 按杠杆序）；
3. E-4/E-5 挂起等外部，动态推进不占心跳；
4. 每笔结案：LOOP-LOG 判读（锚 `<id> 判读`）+ 本表置 closed + digest_rate 更新。
