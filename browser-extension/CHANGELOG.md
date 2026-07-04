# Changelog — Awareness Memory Bridge (Browser Extension)

All notable changes to the F-064 browser extension. Format: `## [version] — date`,
grouped Added / Changed / Fixed. User-visible wording (what *you* see), not just
"fix X".

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

### Tests
- `sdks/local/test/prompt-inject-auth.test.mjs` (6), `test/rulepack-signature.test.mjs`
  (10), `test/chaos-daemon.test.mjs` (10). Full extension suite 39/39, L1 io-boundary
  guard green.

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
