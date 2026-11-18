/**
 * Mode-aware transport facade used by the service worker.
 *
 * `cloud` → https://awareness.market/api/v1 (OAuth `aw_` key)
 * `local` → http://127.0.0.1:37800       (F-064 bridge token)
 * `off`   → no I/O at all
 *
 * Keeping the branch here (instead of inside sw.js) means the message hub, the
 * retry queue and the heartbeat all agree on what "connected" means.
 */
import { DEFAULT_MODE, MODES, STORAGE } from './config.js';
import { getAuth, isReauthRequired } from './auth.js';
import * as cloud from './cloud-client.js';
import * as local from './daemon-client.js';

export async function getMode() {
  const got = await chrome.storage.local.get(STORAGE.mode);
  const mode = got[STORAGE.mode];
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

export async function setMode(mode) {
  if (!MODES.includes(mode)) return { ok: false, error: 'invalid_mode' };
  await chrome.storage.local.set({ [STORAGE.mode]: mode });
  return { ok: true, mode };
}

/**
 * Resolve the live connection state for the current mode.
 * @returns {Promise<{mode:string, connected:boolean, state:string}>}
 *          state: connected | disconnected | reauth | off
 */
export async function resolveConnection() {
  const mode = await getMode();
  if (mode === 'off') return { mode, connected: false, state: 'off' };

  if (mode === 'cloud') {
    const auth = await getAuth();
    if (!auth) return { mode, connected: false, state: 'disconnected' };
    if (await isReauthRequired()) return { mode, connected: false, state: 'reauth' };
    return { mode, connected: true, state: 'connected' };
  }

  const alive = await local.pingDaemon();
  return { mode, connected: alive, state: alive ? 'connected' : 'disconnected' };
}

/** Persist the legacy `connected` flag used by content.js + popup. */
export async function persistConnection(connection) {
  await chrome.storage.local.set({ [STORAGE.connected]: !!connection?.connected });
  return connection;
}

/**
 * Write one captured Q&A through the active transport.
 * @returns same structured shape as the underlying clients.
 */
export async function record(payload, opts = {}, site = '') {
  const mode = await getMode();
  if (mode === 'cloud') {
    return cloud.recordCapture({
      content: payload?.content,
      title: payload?.title,
      site: payload?.metadata?.site || site,
    });
  }
  if (mode === 'local') {
    return local.recordMemory(payload, opts);
  }
  return { ok: true, status: 'skipped' };
}

/** Fetch relevant-memory markdown for injection. */
export async function inject(query, opts = {}) {
  const mode = await getMode();
  if (mode === 'cloud') return cloud.fetchInjection(query);
  if (mode === 'local') return local.fetchInjection(query, opts);
  return { ok: false, error: 'off' };
}
