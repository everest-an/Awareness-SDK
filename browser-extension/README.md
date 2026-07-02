# Awareness Memory Bridge (Browser Extension · MV3)

Two-way memory bridge for **ChatGPT / Gemini / 豆包 / Kimi / DeepSeek**:

- **Auto-capture** — when an AI answer finishes, the Q&A is written to your local
  Awareness daemon (`source=external_chat`) so any IDE (Claude Code, etc.) can
  recall it later.
- **Manual inject** — pull relevant memories for the current topic and insert
  them into the chat composer with one click.

Part of **F-064 Phase 3**. See `docs/features/f-064/ACCEPTANCE-phase3.md` and
`docs/features/f-064/phase3-dom-adapters.md`.

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
