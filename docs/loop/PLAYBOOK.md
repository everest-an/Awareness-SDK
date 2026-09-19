# LOOP PLAYBOOK — 操作坑与惯例（每轮开场必读，新坑必回写）

> ACE 式演化手册（AMM-001 移植自 AwareLiquid-Physic，2026-09-19）。
> 本文件是循环的**操作记忆**：每轮开场先读；踩到新坑当场回写
> （一行：坑 → 解法 → 出处）；惯例一旦写入即为约束。目标：同一个坑不踩第二次。

## 坑清单（每条都真实付出过代价）

- **`gh pr edit` 走 GraphQL 报 Projects classic deprecation 错**（HANDOFF
  09-06）：改用 REST 通道 `gh api repos/.../pulls/1 -X PATCH -F body=@file`。
- **PR draft→ready 不能用 REST PATCH `draft:false`**（HANDOFF，另一会话
  实测：API 静默不生效）→ 必须用 GraphQL mutation
  `markPullRequestReadyForReview(input:{pullRequestId})`，node_id 从
  `gh api repos/.../pulls/1 --jq .node_id` 取。
- **管道尾命令吞退出码**（Physic 轮 22 同款；SDK 侧 09-08 评估会话实测
  再踩：`goal_check | head` 后 `$?` 是 head 的）→ 门禁链 `cmd && next`
  或用 `PIPESTATUS`；验收脚本里单独跑命令不接管道。
- **`time.monotonic()` 原点平台相关**（09-08 收口批次，3.9 腿实测揪出）：
  macOS 原点近 0（实测 0.006s），"把时间戳置 0 模拟过期"的测试写法在
  该平台静默失效。→ 涉时钟的测试一律相对当前时刻回退
  (`monotonic() - window - ε`)，不假设原点。
- **pytest 必须从 `python/` 跑、`node --test` 必须从 `local/` 跑**
  （rootdir 由 pyproject/package.json 定；09-08 实测在仓根跑 pytest 得
  "no tests ran"）。
- **venv 装新依赖必须同步 ci.yml 的 pip install 行**（夜间轮护栏 0 条，
  事故先例：缺 numpy 致 6 测试红就 push）。纯本地校验工具（如 pyyaml）
  不入 CI 行，但要写明用途。
- **package.json/lock 同步后必须 `npm install`**（HANDOFF：否则
  `@noble/hashes` 等缺失伪装成大面积回归）。
- **并发会话同仓工作会撞号/撞 rebase**（09-08 整合批次实测：另一会话
  占用 F-074/F-075 编号 + 三提交需 rebase 整合）。→ 开工前先
  `git fetch fork && git log HEAD..fork/<branch> --oneline` 看远端；
  决策编号用 ADR- 命名空间并先查 docs/decisions/ 现有编号。
- **mock client（MagicMock）上 `getattr(client, "_trace_writer")` 返回
  auto-Mock**（HANDOFF）：trace emit 在既有 mock 测试里是无害调用；
  新增接入点保持此模式，别让 trace 在 mock 测试里炸。
- **fork 的 workflow 首次注册无 API 等价物**（09-08 实测：permissions
  enable + workflows enable 均 404）→ 必须网页 Actions 页点一次启用；
  此后 `gh workflow run ci.yml --ref <branch>` 可用（需 workflow 带
  workflow_dispatch）。
- **大型提交批次 push 前先 `git pull --rebase fork`**（夜间轮护栏 3；
  防并行会话碰撞——push 被拒时先看远端新增了什么再解，别硬推）。
- **后台调研 agent 可能僵尸化**（09-08 会话实测：两 agent metadata
  status=running 但零输出、SendMessage 报 no active task）→ 派发后
  限时未回收就自己上（WebFetch 直抓权威源），别干等。

## 被验证有效的做法

- **双锚验收**（移植自 Physic 轮 73）：带产物目标的 check_cmd 用
  `grep -q "<判读锚>" docs/loop/LOOP-LOG.md && test -f <产物>` ——
  判读锚只在判读写完时存在，产物锚只在文件落地时存在，两个独立事件
  同时发生才算达成。入队时即写，防假阳性 ACHIEVED。
- **判读完下一心跳 = 消化轮**：回填（LOOP-LOG/RSI-INDEX/台账）→ 分流
  （新坑入 PLAYBOOK / 新工具入 TOOLS / 新方向入队尾），期间禁开新目标。
- **蒸馏轮零重叠族**：补池先 grep 既有条目族，本轮选零重叠族；
  方向类条目当轮追加队尾（写清 check_cmd），防"档案写了、循环忘了"。
- **每函数 ≤20 逻辑行、公共 API 在前**：沿用仓内既有约定。

## 惯例（已固化的流程约束）

- **原子提交**：一个提交一件事；正文引用目标 ID（`ref: <GOALS 目标ID>`）。
- **门禁三件套 + 双测试**：提交前 check_claims / check_adr_index /
  check_version_sync + pytest（python/）+ JS 门禁套件（local/）全绿。
- **先登记后引用**：对外数字主张先入 GOVERNANCE §7 + CLAIMS.md 双登记
  （缺一 check_claims exit 1）；撤回主张复活会被 lint 拦。
- **机制改动提案制**：对循环自身程序的改进 = 写 `AMENDMENTS.md` 提案，
  未经用户批准不得自行更改 GOAL-PROMPT 或本文件"惯例"节
  （坑清单可直接追加；ADR-002 同款边界：代理只有起草权）。
- **单马拉松约定**：同一时间只允许一个马拉松会话。启动前先跑
  `./scripts/loop/marathon_guard`，exit 1 ⇒ 已有活会话，本次转为
  "仅确认状态并结束"。
- **经验蒸馏入库硬标准**（移植 AMM-015 精神）：① 溯源可复核（出处精确
  到题录，域名根/聚合站裸链不算）；② 缺证性声明降档——"空白/无人做"
  类断言只能写"当前 query 族下未检索到"。
