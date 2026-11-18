# Awareness Memory (Browser Extension · MV3)

Two-way memory for **ChatGPT / Gemini / 豆包 / Kimi / DeepSeek**:

- **Auto-capture** — when an AI answer finishes, the Q&A is written to your
  Awareness memory (`source=external_chat`) so any IDE agent or another chat can
  recall it later.
- **One-click recall** — pull relevant memories for the current topic and insert
  them into the chat composer.
- **Side panel** — search your cloud memory, browse knowledge cards and timeline.

Two transports (F-109):

| Mode | Data path | Setup |
|---|---|---|
| **cloud** (default) | `https://awareness.market/api/v1` | click “连接 Awareness”, OAuth, pick a memory |
| **local** (optional) | `http://127.0.0.1:37800` | run the Awareness daemon |

Part of **F-109** (cloud) on top of **F-064 Phase 3** (local bridge). See
`docs/features/f-109-chrome-extension-cloud/` and `docs/features/f-064/`.

## Install

Chrome Web Store: *(link added after review)*

Dev / unpacked:

1. `chrome://extensions` → Developer mode → **Load unpacked** →
   select this `sdks/browser-extension/` folder.
2. Pin the extension, open the popup.
3. Cloud: **连接 Awareness** → sign in → pick a memory.
   Local: switch the segmented control to **本地** first, then start the daemon
   (`npx @awareness.market/local start`).

## Architecture — Option C (service worker owns all network I/O)

```
content.js  ──sendMessage──▶  sw.js ── transport.js ──┬─ cloud-client.js ──▶ awareness.market
(DOM scrape/inject)          (I/O + auth + queue)     └─ daemon-client.js ─▶ 127.0.0.1:37800
```

- **content.js** does DOM only. It NEVER fetches — page CSP (`connect-src`)
  blocks loopback on strict sites and the page Origin isn't trusted. All calls
  are relayed to the service worker.
- **sw.js** is the single network choke point. It owns the OAuth grant, the
  retry queue, the heartbeat and the remote rule-pack refresh.
- **popup** / **sidepanel** are pure UI: they `sendMessage` and render.

### Cloud OAuth (reuses F-084)

1. `POST /register` (RFC 7591, public PKCE client,
   `client_kind: "browser_extension"`).
2. `chrome.identity.launchWebAuthFlow()` → the existing
   `https://awareness.market/authorize` consent page.
3. The approve endpoint mints a **dedicated, revocable `aw_` key** bound to the
   memory the user picked.
4. `POST /token` (code + PKCE verifier) returns the `awmcp_` bearer **and**, for
   extension clients only, that dedicated `aw_` key + memory id.

Why the extra key: the `awmcp_` bearer is only resolvable inside the MCP
process; the extension speaks REST. The key is never placed in a URL or a log,
the popup shows only its first 8 characters, and revoking it in
Settings → API Keys stops capture within one heartbeat.

## Rule-pack (remote-updatable, MV3-safe)

Selectors / finish-signals / inject-strategies live in
`rules/default-rulepack.json` (inert JSON, schema v2). A remote pack hot-swaps
selectors **as data only** — never eval'd, never imported as code. Each site
carries `confidence` + `lastVerified`.

豆包 is anchored on stable `data-message-id` / `.md-box-root` attributes (its
2026 rebuild removed every `data-testid`), verified on the live logged-in DOM.

## Tests

```bash
npm run verify:io        # L1: content script has no fetch; rule-pack inert
npm run verify:release   # L1: versions/icons/permissions/entry points
npm test                 # L2/L3: cloud client, PKCE, panel state, chaos, rulepack
HEADLESS=1 npm run test:e2e   # L4: real Chromium + real HTTP (cloud + local)
```

The L4 suite has **zero `page.route`**: the cloud spec runs against a real local
HTTP server, and the local spec against a real daemon.

## Packaging

```bash
npm run package
# → dist/awareness-memory-<version>.zip  (manifest + src + rules + icons only)
```

`scripts/package.mjs` refuses to build if `manifest.json`, `package.json` and
`CHANGELOG.md` disagree on the version. Store copy and permission
justifications: `docs/features/f-109-chrome-extension-cloud/STORE-LISTING.md`.

## Privacy

The extension only reads the five supported chat sites, only saves Q&A when an
answer finishes, and never touches passwords, cookies, other tabs or browsing
history. Full policy: `https://awareness.market/en/privacy/extension`.
