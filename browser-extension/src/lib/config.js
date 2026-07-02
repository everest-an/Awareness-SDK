/**
 * Shared constants for the Awareness Memory Bridge extension.
 *
 * IMPORTANT (MV3 / Option C architecture): all daemon I/O lives in the service
 * worker. The content script NEVER fetches 127.0.0.1 directly — page CSP
 * (`connect-src`) on strict sites (ChatGPT) blocks it, and the page Origin is
 * not the extension origin. The SW fetches off a fixed `chrome-extension://<id>`
 * origin, bypasses CORS via host_permissions, and is exempt from page CSP.
 */

// Use 127.0.0.1 explicitly (NOT localhost) to dodge old-Chromium resolution
// quirks — this must match manifest host_permissions.
export const DAEMON_BASE = 'http://127.0.0.1:37800';

export const ENDPOINTS = {
  healthz: `${DAEMON_BASE}/healthz`,
  memories: `${DAEMON_BASE}/api/v1/memories`,
  promptInject: `${DAEMON_BASE}/api/v1/prompt/inject`,
  bridgeToken: `${DAEMON_BASE}/api/v1/bridge/token`,
  workspaces: `${DAEMON_BASE}/api/v1/workspaces`,
  sessions: `${DAEMON_BASE}/api/v1/sessions`,
  bindings: `${DAEMON_BASE}/api/v1/bindings`,
};

export const HEADER = {
  bridgeToken: 'X-Awareness-Bridge-Token',
  projectDirB64: 'X-Awareness-Project-Dir-B64',
  sessionId: 'X-Awareness-Session-Id',
};

// Canonical remote rule-pack (inert JSON) — hot-updates the per-site selectors
// WITHOUT republishing the extension. Points at the auto-synced public SDK repo
// on `main`: pushing an updated `default-rulepack.json` propagates to every
// install on the next rulepack alarm (~6h) or immediately when the SW restarts.
// MV3-safe: this is DATA, never code — it is only ever `fetch`ed as JSON and its
// selector strings are passed to `document.querySelector`, never eval'd. Users
// may override the source via the popup (SET_RULEPACK_URL); an explicit empty
// string disables remote refresh and pins the bundled default.
export const DEFAULT_RULEPACK_URL =
  'https://raw.githubusercontent.com/everest-an/Awareness-SDK/main/browser-extension/rules/default-rulepack.json';

// chrome.storage.local keys.
export const STORAGE = {
  token: 'bridge_token',
  connected: 'daemon_connected',
  bindings: 'site_bindings', // { [site]: { workspace, session_id, autoCapture, filterLevel } }
  queue: 'write_queue',      // pending payloads awaiting retry
  stats: 'stats',            // { recorded, filtered, queued }
  rulepack: 'rulepack_cache',
  rulepackUrl: 'rulepack_url', // optional remote hot-update URL (inert JSON only)
};

// chrome.alarms names.
export const ALARM = {
  heartbeat: 'awareness-heartbeat',
  retry: 'awareness-retry-queue',
  rulepack: 'awareness-rulepack-refresh',
};

export const HEARTBEAT_PERIOD_MIN = 0.5;   // 30s — alarms floor
export const RETRY_PERIOD_MIN = 1;
export const RULEPACK_PERIOD_MIN = 360;    // 6h

export const FILTER_LEVELS = ['strict', 'standard', 'loose'];
export const DEFAULT_FILTER_LEVEL = 'standard';
