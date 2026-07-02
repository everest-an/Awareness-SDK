/**
 * Daemon REST client — runs ONLY inside the service worker.
 *
 * Every call here fetches http://127.0.0.1:37800 off the extension origin
 * (`chrome-extension://<id>`). This is the single choke point for daemon I/O.
 * All failures are returned as structured results (never throw across the
 * sendMessage boundary) so callers can degrade silently (FM-1) or queue (FM-2).
 */
import { ENDPOINTS, HEADER, STORAGE } from './config.js';

const TIMEOUT_MS = 8000;

/** fetch with an AbortController timeout. Returns Response or throws. */
async function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** GET /healthz — used by the heartbeat alarm. */
export async function pingDaemon() {
  try {
    const res = await timedFetch(ENDPOINTS.healthz);
    return res.ok;
  } catch {
    return false;
  }
}

/** Read the persisted bridge token (or null). */
export async function getStoredToken() {
  const got = await chrome.storage.local.get(STORAGE.token);
  return got[STORAGE.token] || null;
}

/**
 * Ensure a bridge token exists: reuse the stored one, else mint a fresh one.
 * Minting fetches off the extension origin, which the daemon's isTokenMintOrigin
 * allows (chrome-extension://). Returns the token string or null on failure.
 */
export async function ensureToken() {
  const existing = await getStoredToken();
  if (existing) return existing;
  try {
    const res = await timedFetch(ENDPOINTS.bridgeToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'awareness-browser-extension' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.status === 'ok' && data.token) {
      await chrome.storage.local.set({ [STORAGE.token]: data.token });
      return data.token;
    }
    return null;
  } catch {
    return null;
  }
}

/** Base64-encode a UTF-8 workspace path for the project-dir header (CJK-safe). */
function b64(str) {
  // btoa needs Latin1; encode UTF-8 bytes first.
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * POST /api/v1/memories — write a captured Q&A.
 * @param {object} payload  { content, source, session_id?, title?, tags?, metadata? }
 * @param {object} [opts]   { workspace? } — optional project-dir routing
 * @returns {Promise<{ok:boolean, status?:string, id?:string, httpStatus?:number, error?:string}>}
 */
export async function recordMemory(payload, opts = {}) {
  const token = await ensureToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers[HEADER.bridgeToken] = token;
  if (opts.workspace) headers[HEADER.projectDirB64] = b64(opts.workspace);
  if (payload.session_id) headers[HEADER.sessionId] = payload.session_id;

  try {
    const res = await timedFetch(ENDPOINTS.memories, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      return { ok: false, httpStatus: res.status, error: data?.error || `http_${res.status}` };
    }
    return { ok: true, status: data?.status, id: data?.id };
  } catch (err) {
    return { ok: false, error: (err && err.name === 'AbortError') ? 'timeout' : 'network_error' };
  }
}

/**
 * GET /api/v1/prompt/inject — fetch relevant-memory markdown for a topic.
 * @param {string} q
 * @param {object} [opts] { limit?, budget?, workspace? }
 * @returns {Promise<{ok:boolean, markdown?:string, card_count?:number, error?:string}>}
 */
export async function fetchInjection(q, opts = {}) {
  const params = new URLSearchParams({ q: q || '' });
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.budget) params.set('budget', String(opts.budget));
  const headers = {};
  if (opts.workspace) headers[HEADER.projectDirB64] = b64(opts.workspace);
  try {
    const res = await timedFetch(`${ENDPOINTS.promptInject}?${params.toString()}`, { headers });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = await res.json();
    return { ok: true, markdown: data?.markdown || '', card_count: data?.card_count ?? 0 };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

/** GET /api/v1/workspaces — for the popup binding picker. */
export async function listWorkspaces() {
  try {
    const res = await timedFetch(ENDPOINTS.workspaces);
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, workspaces: await res.json() };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

/** POST /api/v1/sessions — create an external session (reuses native table). */
export async function createSession(payload, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.workspace) headers[HEADER.projectDirB64] = b64(opts.workspace);
  try {
    const res = await timedFetch(ENDPOINTS.sessions, {
      method: 'POST', headers, body: JSON.stringify(payload || {}),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, session: await res.json() };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}
