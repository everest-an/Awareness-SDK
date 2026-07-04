# Awareness Memory Bridge (Browser Extension · MV3)

Two-way memory bridge for **ChatGPT / Gemini / 豆包 / Kimi / DeepSeek**:

- **Auto-capture** — when an AI answer finishes, the Q&A is written to your local
  Awareness daemon (`source=external_chat`) so any IDE (Claude Code, etc.) can
  recall it later.
- **Manual inject** — pull relevant memories for the current topic and insert
  them into the chat composer with one click.

Part of **F-064 Phase 3**. See `docs/features/f-064/ACCEPTANCE-phase3.md` and
`docs/features/f-064/phase3-dom-adapters.md`. Changelog: `CHANGELOG.md`.

## What it does (for you)

You already chat with 豆包 / DeepSeek / Kimi / ChatGPT / Gemini in the browser.
This extension gives those chats a **memory that follows you across tools**:

- **Auto-capture** — the moment an AI answer finishes streaming, the Q&A pair is
  saved to **your own local Awareness memory** (`source=external_chat`). Later,
  any IDE agent (Claude Code, Cursor, …) or another chat can recall it.
- **One-click recall** — before you ask, pull the memories relevant to the
  current topic and drop them straight into the chat box. No copy-paste.
- **You stay in control** — capture is per-site toggleable, you pick which memory
  (workspace/session) each site writes to, and everything flows through a daemon
  on **your machine** (`127.0.0.1:37800`), not a third-party server.

Supported today (real-machine verified): **DeepSeek · ChatGPT · 豆包(Doubao) ·
Kimi** (`confidence: high`). **Gemini** is wired but pending re-verification
(`confidence: medium-high`, DOM last checked 2026-05).

## How platform compatibility works (豆包 / Doubao as the example)

The extension does **not** hard-code any site. `content.js` is a generic engine
driven by a declarative **rule-pack** (`rules/default-rulepack.json`), so adding
or fixing a platform is a data change, not a code change.

Each site entry describes *how to read and write that platform's DOM*:

| Field | 豆包's value | What it does |
|---|---|---|
| `match` | `*://www.doubao.com/*` | which URLs this adapter drives |
| `selectors` | `turnContainer`, `assistantText`, `userText` … | **fallback chains** (first match wins) that locate each chat turn |
| `finishSignal` | `selectorGone` on `[data-streaming="true"]` → fallback `mutationQuiescence` 700ms | how we know the answer *finished* (so we don't capture half a reply) |
| `input` | `textarea` + `nativeValueSetter` + send button | how one-click recall injects text and (optionally) sends |

**Why 豆包 is the hard case.** Doubao's 2026 rebuild **removed every
`data-testid`** and switched to hashed CSS-module class names that change on each
release — anchoring on those would break weekly. So the adapter anchors on the
**stable `data-*` attributes** verified on the live logged-in DOM:

- a turn = `[data-message-id]`
- an **assistant** turn = `[data-message-id]:has(.md-box-root)` (the rendered
  markdown box only exists on AI replies)
- a **user** turn = `[data-message-id]:not(:has(.md-box-root))`

**When a platform changes its DOM**, we don't ship a new extension. The rule-pack
is **remote-updatable**: the service worker periodically fetches a newer pack
(loaded as **inert data only — never eval'd**, an MV3 hard rule) and hot-swaps
it, falling back to the bundled default if the remote is missing or malformed.
Each site carries `confidence` + `lastVerified` so drift is visible.

The same four fields drive all five platforms — 豆包/Kimi/DeepSeek/ChatGPT/Gemini
differ only in their selector strings and finish-signal, not in any code path.

## Architecture — Option C (service worker owns all daemon I/O)

```
content.js  ──sendMessage──▶  sw.js  ──fetch 127.0.0.1:37800──▶  Awareness daemon
(DOM scrape/inject)          (I/O + token + queue + heartbeat)
```

- **content.js** does DOM only. It NEVER fetches the daemon — page CSP
  (`connect-src`) blocks 127.0.0.1 on strict sites and the page Origin isn't
  trusted. All daemon calls are relayed to the service worker.
- **sw.js** owns every `http://127.0.0.1:37800` call off the fixed
  `chrome-extension://<id>` origin (bypasses CORS via `host_permissions`, exempt
  from page CSP). It mints + stores the **bridge token**, heartbeats via
  `chrome.alarms` (min 30s; `setInterval` can't revive a killed SW), retries a
  durable write queue, and refreshes the remote rule-pack.
- **Bridge token**: a valid `X-Awareness-Bridge-Token` lets the SW's
  chrome-extension origin bypass the daemon's site Origin allowlist. Minting is
  Origin-gated so websites can't steal one.

## Rule-pack (remote-updatable, MV3-safe)

Selectors/finish-signals/inject-strategies live in `rules/default-rulepack.json`
(inert JSON, schema v2). An optional remote URL (set in the popup) hot-swaps a
newer pack **as data only** — never eval'd, never imported as code (MV3 red
line). Falls back to the bundled default if the remote is unavailable/malformed.

Selectors are **fallback chains** (first match wins). Confidence + `lastVerified`
are per-site; DOM drifts, so re-verify in DevTools before shipping.

## Load unpacked (dev)

1. Start the daemon: `npx @awareness-sdk/local start` (port 37800).
2. `chrome://extensions` → Developer mode → **Load unpacked** → select this
   `sdks/browser-extension/` folder.
3. Open a supported site, pin the extension, open the popup to bind a
   workspace/session and toggle auto-record.

## Guards & tests

- **L1** `npm run verify:io` — content script has no daemon fetch; rule-pack is
  inert; manifest covers all 5 sites.
- **L2** `node --test test/rulepack-match.test.mjs` — pure rule-pack matching (no
  browser): the bundled pack resolves all 5 sites + rejects malformed/spoofed.
- **L4** `npm run test:e2e` — Playwright persistent context (real Chromium + real
  daemon, zero mock). Specs in `test/e2e/*.spec.mjs`. Headless CI needs the full
  Chromium (`channel:'chromium'`, new-headless) — MV3 service workers do NOT load
  under the default headless-shell. Run `npx playwright install chromium` first.
