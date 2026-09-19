# GOALS.md — 程序计数器（循环元状态，唯一真相源）

> 移植自 AwareLiquid-Physic 的自循环机制（AMM-001，2026-09-19 用户指令）。
> 任何会话（人/cron/hook）打开工作区：读这里 → 执行 `current_action` → 完成后
> 推进状态并原子提交。规则：一次只有一个 `current_action`；完成条件必须可验证；
> 判读与历史写 `docs/loop/LOOP-LOG.md`（append-only），本文件只留机器可解析现态。
> 更新本文件 = 推进程序计数器。

```yaml
state: RUNNING            # RUNNING | BLOCKED-HUMAN | IDLE
mode: OFF                 # ON/OFF 总开关（./scripts/loop/iteration start|stop）
iteration_window: 全天候
current_goal: >-
  自循环机制移植落地（AMM-001）+ 消费工程化欠账队列。三 lint 门禁
  （claims / adr-index / version-sync）为 GATE-RED 优先级：红则先修门禁，
  禁蒸馏禁队列迭代。外部等待（PR #1 评审 / fork CI 首启 / M1 broker 评审）
  不阻塞队列消费。
current_action: >-
  下一心跳：./scripts/loop/goal_check → 严格按 VERDICT 行动。
  GATE-RED=先修红门禁；ACHIEVED=判读写 LOOP-LOG 后推进队列；
  NOT-Achieved=对队首目标迭代一步；QUEUE-EMPTY=工程化蒸馏轮
  （业界做法扫描，入库标准见 PLAYBOOK 蒸馏轮条目）。
  每目标完成 = 判读锚写 LOOP-LOG + 原子提交 push fork（GOVERNANCE §3 门禁全绿）。
done_condition: >-
  队列清空且无新欠账 ⇒ state: IDLE + 收尾记录（RSI-INDEX 入账），
  保留重入口：上游评审动态 / 用户指令 / 新欠账。
blocked_on: >-
  1) PR #1 上游评审（合并 = F-071 生效机制）；2) fork CI 首次启用
  （Actions 页 UI 点击，API 无等价物——六 job 已本地模拟全绿）；
  3) M1 feat/consolidation-policy 评审（broker 联调 + 三开关翻转前置）。
next_trigger_hint: goal_check → 队首 GATE-LINT-CHANGELOG / 用户"继续"
pointer: docs/loop/LOOP-LOG.md（判读与历史）；docs/loop/DEBT-LEDGER.md（欠账）；
  docs/loop/AMENDMENTS.md（机制提案制）；docs/loop/RSI-INDEX.md（指数）；
  GOVERNANCE.md（宪法，机制改动不触其文本）；docs/decisions/（ADR 谱系）
updated: 2026-09-19 23:5x (AMM-001 移植落地：GOALS/GOAL-PROMPT/PLAYBOOK/
  DEBT-LEDGER/RSI-INDEX/AMENDMENTS/TOOLS + scripts/loop 三件；队列种入
  P2 工程化清单五项目)
```

## goal_queue（双轨交替：engineering / governance；顶部为当前目标）

```yaml
goal_queue:
- id: GATE-LINT-CHANGELOG
    track: engineering
    goal: 把 python/CHANGELOG.md 与 local/CHANGELOG.md 纳入 check_claims 扫描面（对外主张面全覆盖——CHANGELOG 含测试数等数字主张，当前不在 9 个扫描面内）；若新扫描出未登记主张，按 §7+CLAIMS 双登记流程补账
    done_condition: SCAN_TARGETS 含两份 CHANGELOG 且 lint PASS + 判读写 LOOP-LOG
    check_cmd: grep -q "python/CHANGELOG.md" scripts/check_claims.py && grep -q "GATE-LINT-CHANGELOG 判读" docs/loop/LOOP-LOG.md
- id: ISSUE-TEMPLATE
    track: governance
    goal: 补 .github/ISSUE_TEMPLATE（bug 报告 + config.yml，链接 SECURITY.md 私密通道与 GOVERNANCE 门禁纪律；安全类引导去私密披露）
    done_condition: 两个模板文件落地 + 判读写 LOOP-LOG
    check_cmd: test -f .github/ISSUE_TEMPLATE/bug_report.md && grep -q "ISSUE-TEMPLATE 判读" docs/loop/LOOP-LOG.md
- id: ACTIONS-SHA-PIN
    track: engineering
    goal: workflows 的第三方 action 引用升级为 SHA 固定（OpenSSF Token-Permissions 之后的供应链补强；tag 引用留注释标版本）
    done_condition: 8 个 workflow 全部 SHA pin + 判读写 LOOP-LOG
    check_cmd: grep -qE "uses: actions/checkout@[0-9a-f]{40}" .github/workflows/ci.yml && grep -q "ACTIONS-SHA-PIN 判读" docs/loop/LOOP-LOG.md
- id: CONTRIBUTING
    track: governance
    goal: 薄 CONTRIBUTING.md——指向 GOVERNANCE/ADR/claims 纪律与本 loop（先登记后引用、双条件门禁、起草权边界、本地测试命令），一页内
    done_condition: CONTRIBUTING.md 落地 + 判读写 LOOP-LOG
    check_cmd: test -f CONTRIBUTING.md && grep -q "CONTRIBUTING 判读" docs/loop/LOOP-LOG.md
- id: DEPENDABOT
    track: engineering
    goal: .github/dependabot.yml（pip + npm 两生态周更；分组合并避免 PR 噪音）
    done_condition: dependabot.yml 落地 + 判读写 LOOP-LOG
    check_cmd: test -f .github/dependabot.yml && grep -q "DEPENDABOT 判读" docs/loop/LOOP-LOG.md
```

队列规则：goal_check 判 ACHIEVED 时弹出顶部并晋升下一位；双轨交替养成交付
节奏；新方向（蒸馏轮发现/用户指定）追加队尾并标 track。队列空 ⇒ 按
goal_check 路由（工程化蒸馏轮，入库标准见 PLAYBOOK）。
**条件性重入口（不入队，防路由器空转）**：
- **CI-ACTIVATE**：fork Actions 首次启用后（用户 UI 点击），首跑若有红 job
  → 按失败清单开修复目标（六 job 本地已模拟全绿，预期为绿）。
- **BROKER-INTEGRATE**：M1 feat/consolidation-policy 合并后 → parity 测试
  转正 + 真实联调（quickstart / migrate_session / trace 事件流人工检查）
  + 三开关翻转 ADR 各一（GOVERNANCE §4）。
- **GATE-METHODOLOGY**：PR #1 合并后 → F-071 生效确认 + RSI-INDEX 0.6 锚
  校准（合并日为首个"交付日"基线）。

## 推进规则

1. current_action 完成且验收过（三 lint + Python + JS 全绿）→ 判读写
   LOOP-LOG、`updated` 戳更新，与产物同一原子提交；
2. 出现需要人的决策 → `state: BLOCKED-HUMAN` + `blocked_on` 写明问题，
   循环在收尾轮汇总，不自行决策（ADR-002：起草权边界）；
3. 目标本身要变（罕见）→ 走 `AMENDMENTS.md` 提案制，不改本文件语义。
