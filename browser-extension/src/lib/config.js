/**
 * Shared constants for the Awareness Memory extension (MV3).
 *
 * Two transports coexist (F-109):
 *   - cloud: https://awareness.market/api/v1  (default; OAuth-provisioned `aw_` key)
 *   - local: http://127.0.0.1:37800           (F-064 daemon mode, opt-in)
 *
 * IMPORTANT (MV3 / Option C architecture): all network I/O lives in the
 * service worker. The content script NEVER fetches — page CSP (`connect-src`)
 * on strict sites blocks it, and the page Origin is not trusted. The SW fetches
 * off a fixed `chrome-extension://<id>` origin, bypasses CORS via
 * host_permissions, and is exempt from page CSP.
 */

// ---------------------------------------------------------------------------
// Local daemon (F-064).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cloud (F-109).
// ---------------------------------------------------------------------------

export const CLOUD_DEFAULT_BASE = 'https://awareness.market';

/** OAuth endpoints (F-084 authorization server, mounted on the MCP host). */
export const CLOUD_OAUTH = {
  registerPath: '/register',
  tokenPath: '/token',
  authorizePath: '/authorize',
  // RFC 8707 audience. Must match the server's canonical resource.
  resource: 'https://awareness.market/mcp',
  clientName: 'Awareness Memory (Chrome Extension)',
  clientKind: 'browser_extension',
  scope: 'awareness.recall awareness.record',
};

/** Build REST endpoint paths for a given base URL (trailing slash tolerated). */
export function cloudPaths(baseUrl) {
  const base = String(baseUrl || CLOUD_DEFAULT_BASE).replace(/\/+$/, '');
  const v1 = `${base}/api/v1`;
  return {
    base,
    v1,
    memories: `${v1}/memories`,
    memory: (id) => `${v1}/memories/${encodeURIComponent(id)}`,
    content: (id) => `${v1}/memories/${encodeURIComponent(id)}/content`,
    retrieve: (id) => `${v1}/memories/${encodeURIComponent(id)}/retrieve`,
    cards: (id) => `${v1}/memories/${encodeURIComponent(id)}/insights/knowledge-cards`,
    timeline: (id) => `${v1}/memories/${encodeURIComponent(id)}/timeline`,
    register: `${base}${CLOUD_OAUTH.registerPath}`,
    token: `${base}${CLOUD_OAUTH.tokenPath}`,
    authorize: `${base}${CLOUD_OAUTH.authorizePath}`,
  };
}

// ---------------------------------------------------------------------------
// Modes.
// ---------------------------------------------------------------------------

export const MODES = ['cloud', 'local', 'off'];
export const DEFAULT_MODE = 'cloud';

// ---------------------------------------------------------------------------
// Canonical remote rule-pack (inert JSON) — hot-updates per-site selectors
// WITHOUT republishing the extension. Points at the auto-synced public SDK repo
// on `main`: pushing an updated `default-rulepack.json` propagates to every
// install on the next rulepack alarm (~6h) or immediately when the SW restarts.
// MV3-safe: this is DATA, never code — it is only ever `fetch`ed as JSON and its
// selector strings are passed to `document.querySelector`, never eval'd. Users
// may override the source via the popup (SET_RULEPACK_URL); an explicit empty
// string disables remote refresh and pins the bundled default.
// ---------------------------------------------------------------------------

export const DEFAULT_RULEPACK_URL =
  'https://raw.githubusercontent.com/everest-an/Awareness-SDK/main/browser-extension/rules/default-rulepack.json';

// ---------------------------------------------------------------------------
// chrome.storage.local keys.
// ---------------------------------------------------------------------------

export const STORAGE = {
  // local mode
  token: 'bridge_token',
  connected: 'daemon_connected',
  bindings: 'site_bindings', // { [site]: { workspace, session_id, autoCapture, filterLevel, memory_id } }
  // shared
  queue: 'write_queue',      // pending payloads awaiting retry
  stats: 'stats',            // { recorded, filtered, queued }
  rulepack: 'rulepack_cache',
  rulepackUrl: 'rulepack_url', // optional remote hot-update URL (inert JSON only)
  mode: 'connection_mode',   // 'cloud' | 'local' | 'off'
  // cloud mode
  cloudBase: 'cloud_base',
  cloudAuth: 'cloud_auth',   // { apiKey, memoryId, memoryName, keyPrefix, connectedAt }
  cloudClient: 'cloud_client', // { [base]: { client_id, redirect_uri } }
  cloudReauth: 'cloud_reauth_required',
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
