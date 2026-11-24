# Changelog — Awareness Memory (Browser Extension)

All notable changes to the extension. Format: `## [version] — date`,
grouped Added / Changed / Fixed. User-visible wording (what *you* see), not just
"fix X".

## [0.3.1] — 2026-11-24 · 豆包输入框修复 + 授权不再卡死

### Fixed
- **豆包上用不了的问题**：豆包把输入框从 `<textarea>` 换成了富文本编辑器，
  旧规则匹配不到输入框，悬浮胶囊根本不会出现。现在输入框支持「候选链」：
  先试 textarea，找不到就自动退回 contenteditable，胶囊和「注入记忆」恢复。
- **新账号授权卡死**：授权页在账号没有记忆库时只显示一行灰字，授权按钮永远
  点不了。现在会直接给出「创建记忆库并继续」，建完自动选中即可授权。

### Added
- `npm run probe:rulepack`：对线上 5 个站点跑一次选择器体检，站点改版当天
  就能发现「输入框/消息节点匹配不到」。

## [0.3.0] — 2026-11-19 · 云端记忆 + 侧边栏（F-109）

### Added
- **云端记忆，开箱即用**：安装后点「连接 Awareness」→ 登录并选一个记忆库 →
  自动捕获与一键召回立即生效。**不再需要本地 daemon**。
- **侧边栏记忆面板**：在 Chrome 侧边栏里搜索云端记忆、浏览知识卡片和时间线，
  点开可看全文并复制。
- **本地模式保留**：已装 daemon 的用户可在弹窗里切到「本地」，行为与 0.2.0
  完全一致；老用户升级时自动保持本地模式，不会断流。
- **模式开关**：云端 / 本地 / 关闭，随时可停。
- **云端地址可改**（高级设置），便于 staging 验证。
- **商店物料**：16/32/48/128 图标、`npm run package`（同时产出 zip 与可直接 Load unpacked 的目录）、隐私政策页。

### Changed
- 扩展更名为 **Awareness Memory**（原 Awareness Memory Bridge）。
- 权限最小化：`storage, alarms, identity, sidePanel, activeTab`；不申请
  `tabs`，不申请全站访问，只有 5 个受支持的 AI 站点会注入内容脚本。
- 授权使用 OAuth 2.1 + PKCE（复用云端授权页），扩展拿到的是**本次授权专属、
  可在设置里单独撤销**的 key；弹窗只显示前 8 位。

### Fixed
- manifest 版本（0.1.0）与 CHANGELOG（0.2.0）不一致，发布流水线现在会拦截。
- 未连接时不再静默丢弃对话：云端未登录会入队，授权失效会明确提示重新连接。

## [0.2.0] — 2026-07-05 · to-C hardening (F-085)

Security + resilience pass before large-scale to-C rollout. Closes the 3 red-lines
from `docs/features/f-064/COMMERCIAL-READINESS-AUDIT.md`.

### Security
- **A same-machine web page can no longer read your local memories.** The local
  daemon's `/prompt/inject` endpoint (previously no-key) now requires a trusted
  Origin (the extension / a whitelisted chat site) or a valid bridge token; an
  anonymous cross-origin page gets `403 forbidden_origin`. Escape hatch for rare
  web-based host-LLMs: `AWARENESS_PROMPT_INJECT_OPEN=1`. (R1, daemon-side)
- **Remote rule-packs are now signature-verified (verify-before-apply).** The
  extension verifies a detached Ed25519 signature over the exact pack bytes with
  an embedded public key before applying it; a tampered or unsigned pack is
  rejected and the bundled default is kept — so a poisoned pack can't retarget
  scraping at, say, a password field. *Mechanism + tests landed; enforcement
  activates once the signing key is provisioned by the publish pipeline (T4).* (R2)

### Reliability
- **Daemon hiccups degrade visibly instead of crashing.** Added L3 chaos coverage
  (happy / 5xx-HTML / timeout) for record, recall-inject, and rule-pack fetch: all
  return a structured degraded result (retry/queue/fallback), never a throw or an
  injected `"undefined"`. (R3)

### Tooling
- `scripts/sign-rulepack.mjs` (T4) — Ed25519 rule-pack signing CLI (`genkey` /
  `sign` / `verify`). Publish-side counterpart to R2's verify-before-apply; its
  node:crypto signatures verify under the extension's Web Crypto (interop test).
  Private keys are `.gitignore`d — provisioning the key turns R2 enforcement on.

### Tests
- `sdks/local/test/prompt-inject-auth.test.mjs` (6), `test/rulepack-signature.test.mjs`
  (10), `test/chaos-daemon.test.mjs` (10), `test/rulepack-sign-interop.test.mjs` (3).
  Full extension suite green, L1 io-boundary guard green.

## [0.1.0] — 2026-07-04

First public MVP of the two-way memory bridge for non-IDE web chats. Turns your
豆包 / DeepSeek / Kimi / ChatGPT / Gemini sessions into a memory that any tool can
recall.

### Added
- **Auto-capture** — when an AI answer finishes streaming, the Q&A pair is saved
  to your **local** Awareness memory (`source=external_chat`), recallable from any
  IDE agent or another chat.
- **One-click recall** — pull memories relevant to the current topic and inject
  them into the chat composer; no copy-paste.
- **Per-site control** — toggle capture per platform; bind which memory
  (workspace/session) each site writes to, from the popup.
- **Five platform adapters** driven by a declarative rule-pack
  (`rules/default-rulepack.json`, schema v2): DeepSeek · ChatGPT · 豆包(Doubao) ·
  Kimi · Gemini.
- **Remote rule-pack hot-update** — when a platform changes its DOM, the service
  worker fetches an updated pack (inert data only, never eval'd) and hot-swaps it,
  so most platform breakages are fixed **without shipping a new extension**. Falls
  back to the bundled default if the remote is unavailable/malformed.

### Changed
- In-page UI refactored to a **Shadow-DOM floating widget** (bottom-right),
  detached from the host composer DOM to avoid layout intrusion on strict sites.
- 豆包 adapter re-anchored on stable `data-message-id` / `.md-box-root` after
  Doubao's 2026 rebuild removed all `data-testid` and moved to hashed CSS-module
  class names.

### Verified
- Real-machine (logged-in DOM) verified: **DeepSeek · ChatGPT · 豆包 · Kimi**
  (`confidence: high`, 2026-07).
- **Gemini** wired but pending re-verification (`confidence: medium-high`, DOM
  last checked 2026-05).

### Known limitations / roadmap
See `docs/features/f-064/COMMERCIAL-READINESS-AUDIT.md`. Before large-scale to-C
rollout, three items must land:
- **Local `/prompt/inject` auth** — currently no-key; a same-machine web page
  could read local memories. Add bridge-token / origin allowlist.
- **Rule-pack signature verification** — remote pack is not yet signed; add
  Ed25519/minisign verify-before-apply with bundled fallback.
- **L3 chaos tests** — add happy / 5xx / timeout triples for daemon calls.

Also planned: cross-tab / retry **idempotency** (dedupe repeated captures) and
**Gemini** re-verification.
