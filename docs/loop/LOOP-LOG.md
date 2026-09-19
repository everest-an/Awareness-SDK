# LOOP-LOG — 判读与历史（append-only，唯一追加入口）

> 每个队列目标的完成判读、每夜的收尾记录、每次机制事件都追加于此。
> 格式：`## <日期> <目标ID/事件> 判读` 小节 + 要点列表。**只追加不改写**——
> 写错了就再追加一条更正（corrige 语义，同 M1 ADJ 纪律）。
> goal_check 的判读锚（`grep -q "<目标ID> 判读"`）指向本文件。

## 2026-09-19 AMM-001 判读

自循环机制自 AwareLiquid-Physic 移植落地：

- 落地面：docs/loop/{GOALS, GOAL-PROMPT, PLAYBOOK, DEBT-LEDGER, RSI-INDEX,
  AMENDMENTS, TOOLS, LOOP-LOG} + scripts/loop/{goal_check, marathon_guard,
  iteration} + tests/test_loop_scripts.py（路由与锁回归）。
- 适配四处（AMM-001 正文详列）：DEBT-FIRST→GATE-RED（三 lint 为门禁债）、
  蒸馏轮改工程化语义、判读落点 PRD §19→LOOP-LOG、RSI-INDEX 瘦身
  （复合指数待首窗口预注册，A 维度机械计量）。
- 初始欠账 5 笔入 DEBT-LEDGER（L:3 / C:2）；队列种入 P2 工程化清单 5 项目
  （GATE-LINT-CHANGELOG / ISSUE-TEMPLATE / ACTIONS-SHA-PIN / CONTRIBUTING /
  DEPENDABOT）。
- 基线：第 0 夜（RSI-INDEX 逐夜账本首行）。下一步 = 用户以 GOAL-PROMPT 启动
  首个马拉松（mode 当前 OFF，`./scripts/loop/iteration start` 开启）。
