# Changelog — Awareness Memory Bridge (Browser Extension)

All notable changes to the F-064 browser extension. Format: `## [version] — date`,
grouped Added / Changed / Fixed. User-visible wording (what *you* see), not just
"fix X".

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
