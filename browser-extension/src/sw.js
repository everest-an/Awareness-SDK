/**
 * Service Worker — the ONLY place that talks to the network (Option C).
 *
 * Responsibilities:
 *  - Own every cloud / daemon call (record, inject, auth, browse).
 *  - Persist the cloud OAuth grant (F-109) or the local bridge token (F-064).
 *  - Heartbeat via chrome.alarms (min 30s) — `setInterval` can't revive a killed
 *    SW, alarms can. Tracks connected state for silent degradation (FM-1).
 *  - Retry the durable write queue on the retry alarm (FM-2).
 *  - Refresh the remote rule-pack (inert JSON) on the rulepack alarm.
 *  - Handle content-script / popup / side-panel messages.
 */
import {
  ALARM, STORAGE, HEARTBEAT_PERIOD_MIN, RETRY_PERIOD_MIN, RULEPACK_PERIOD_MIN,
  DEFAULT_FILTER_LEVEL,
} from './lib/config.js';
import {
  ensureToken, listWorkspaces, createSession,
} from './lib/daemon-client.js';
import {
  getMode, setMode, resolveConnection, persistConnection, record, inject,
} from './lib/transport.js';
import {
  login, logout, getAccountView, setCloudBase, getCloudBase,
} from './lib/auth.js';
import * as cloud from './lib/cloud-client.js';
import { getActiveRulepack, refreshRemoteRulepack } from './lib/rulepack.js';
import { enqueue, getQueue, setQueue, queueSize } from './lib/queue.js';

// ---------------------------------------------------------------------------
// Lifecycle: install / startup → set alarms, migrate mode, warm state.
// ---------------------------------------------------------------------------

/**
 * Single bootstrap promise. Every message/alarm awaits it, so a `SET_MODE`
 * sent while `onInstalled` is still migrating can never be clobbered by the
 * migration write (the 0.2.0 → 0.3.0 race that queued cloud captures).
 */
const READY = (async () => {
  await setupAlarms();
  await migrateMode();
  await ensureStats();
  await refreshConnection();
})();

chrome.runtime.onInstalled.addListener(async () => { await READY; });
chrome.runtime.onStartup.addListener(async () => { await READY; });

async function setupAlarms() {
  await chrome.alarms.create(ALARM.heartbeat, { periodInMinutes: HEARTBEAT_PERIOD_MIN });
  await chrome.alarms.create(ALARM.retry, { periodInMinutes: RETRY_PERIOD_MIN });
  await chrome.alarms.create(ALARM.rulepack, { periodInMinutes: RULEPACK_PERIOD_MIN });
}

/**
 * Existing F-064 users have a bridge token / daemon heartbeat. Upgrading must
 * not silently switch them to cloud and stop capturing.
 */
async function migrateMode() {
  const got = await chrome.storage.local.get([STORAGE.mode, STORAGE.token, STORAGE.connected]);
  if (got[STORAGE.mode]) return;
  const wasLocal = !!got[STORAGE.token] || got[STORAGE.connected] === true;
  await chrome.storage.local.set({ [STORAGE.mode]: wasLocal ? 'local' : 'cloud' });
}

async function refreshConnection() {
  const connection = await resolveConnection();
  await persistConnection(connection);
  if (connection.mode === 'local' && connection.connected) {
    await ensureToken(); // best-effort; ok if it fails while offline
  }
  return connection;
}

async function ensureStats() {
  const got = await chrome.storage.local.get(STORAGE.stats);
  if (!got[STORAGE.stats]) {
    await chrome.storage.local.set({ [STORAGE.stats]: { recorded: 0, filtered: 0, queued: 0 } });
  }
}

async function bumpStat(key, delta = 1) {
  const got = await chrome.storage.local.get(STORAGE.stats);
  const stats = got[STORAGE.stats] || { recorded: 0, filtered: 0, queued: 0 };
  stats[key] = (stats[key] || 0) + delta;
  await chrome.storage.local.set({ [STORAGE.stats]: stats });
  return stats;
}

// ---------------------------------------------------------------------------
// Alarms.
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await READY;
  if (alarm.name === ALARM.heartbeat) {
    await refreshConnection();
  } else if (alarm.name === ALARM.retry) {
    await drainQueue();
  } else if (alarm.name === ALARM.rulepack) {
    await refreshRemoteRulepack();
  }
});

async function drainQueue() {
  const mode = await getMode();
  if (mode === 'off') return;
  const connection = await resolveConnection();
  if (!connection.connected) return;

  const q = await getQueue();
  if (!q.length) return;
  const remaining = [];
  let reauth = false;

  for (const item of q) {
    // Items queued under another mode stay put until the user switches back.
    if ((item.mode || 'local') !== mode) { remaining.push(item); continue; }
    if (reauth) { remaining.push(item); continue; }

    const res = await record(item.payload, item.opts || {}, item.site);
    if (res.ok) {
      await bumpStat('recorded');
      continue;
    }
    if (res.reauthRequired) { reauth = true; remaining.push(item); continue; }
    if (res.httpStatus && res.httpStatus >= 400 && res.httpStatus < 500 && res.httpStatus !== 429) {
      // permanent client error (e.g. 400/403) — drop, don't loop forever
      await bumpStat('filtered');
      continue;
    }
    item.attempts = (item.attempts || 0) + 1;
    if (item.attempts < 10) remaining.push(item);
  }

  await setQueue(remaining);
  const got = await chrome.storage.local.get(STORAGE.stats);
  const s = got[STORAGE.stats] || {};
  s.queued = remaining.length;
  await chrome.storage.local.set({ [STORAGE.stats]: s });
  if (reauth) await refreshConnection();
}

// ---------------------------------------------------------------------------
// Message hub (content script + popup + side panel).
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Return true to keep the channel open for the async response.
  handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err) });
  });
  return true;
});

async function handleMessage(msg) {
  await READY;
  switch (msg?.type) {
    case 'GET_BOOTSTRAP':        return getBootstrapForSite(msg.url);
    case 'CAPTURE':              return handleCapture(msg.payload, msg.site);
    case 'INJECT':               return handleInject(msg.q, msg.site);
    case 'GET_STATUS':           return getStatus();
    case 'LIST_WORKSPACES':      return listWorkspacesForMode();
    case 'CREATE_SESSION':       return createSessionForMode(msg.payload, msg.opts);
    case 'SET_BINDING':          return setBinding(msg.site, msg.binding);
    case 'GET_BINDING':          return { ok: true, binding: await getBinding(msg.site) };
    case 'SET_RULEPACK_URL':     return setRulepackUrl(msg.url);
    case 'SET_MODE':             return handleSetMode(msg.mode);
    case 'LOGIN':                return handleLogin();
    case 'LOGOUT':               return handleLogout();
    case 'SET_CLOUD_BASE':       return handleSetCloudBase(msg.base);
    case 'CLOUD_LIST_MEMORIES':  return cloud.listMemories();
    case 'CLOUD_CARDS':          return cloud.knowledgeCards(msg);
    case 'CLOUD_TIMELINE':       return cloud.timeline(msg);
    case 'CLOUD_SEARCH':         return cloud.search(msg.query, msg);
    default:                     return { ok: false, error: 'unknown_message' };
  }
}

/** Content script asks: which rule + binding + settings apply to this tab? */
async function getBootstrapForSite(_url) {
  const rulepack = await getActiveRulepack();
  const connection = await resolveConnection();
  return { ok: true, rulepack, connected: connection.connected, mode: connection.mode };
}

async function getBinding(site) {
  const got = await chrome.storage.local.get(STORAGE.bindings);
  const all = got[STORAGE.bindings] || {};
  return all[site] || {
    workspace: null,
    session_id: null,
    memory_id: null,
    autoCapture: true,
    filterLevel: DEFAULT_FILTER_LEVEL,
  };
}

async function setBinding(site, binding) {
  const got = await chrome.storage.local.get(STORAGE.bindings);
  const all = got[STORAGE.bindings] || {};
  all[site] = { ...(all[site] || {}), ...binding };
  await chrome.storage.local.set({ [STORAGE.bindings]: all });
  return { ok: true, binding: all[site] };
}

async function setRulepackUrl(url) {
  await chrome.storage.local.set({ [STORAGE.rulepackUrl]: url || '' });
  const result = await refreshRemoteRulepack();
  return { ok: true, refresh: result };
}

// --- mode / auth ------------------------------------------------------------

async function handleSetMode(mode) {
  const res = await setMode(mode);
  if (!res.ok) return res;
  await refreshConnection();
  return { ...res, status: await getStatus() };
}

async function handleLogin() {
  const res = await login();
  await refreshConnection();
  return { ...res, status: await getStatus() };
}

async function handleLogout() {
  await logout();
  await refreshConnection();
  return { ok: true, status: await getStatus() };
}

async function handleSetCloudBase(base) {
  const normalized = await setCloudBase(base);
  // A credential is only valid for the server that issued it.
  const account = await getAccountView();
  if (account && account.base !== normalized) await logout();
  await refreshConnection();
  return { ok: true, base: normalized, status: await getStatus() };
}

// --- capture / inject -------------------------------------------------------

/** Handle a captured Q&A from a content script. */
async function handleCapture(payload, site) {
  if (!payload || !payload.content) return { ok: false, error: 'empty_payload' };

  const mode = await getMode();
  if (mode === 'off') return { ok: true, status: 'skipped' };

  const binding = await getBinding(site);
  const opts = binding.workspace ? { workspace: binding.workspace } : {};
  if (binding.session_id) payload.session_id = binding.session_id;

  const connection = await resolveConnection();

  // Cloud + revoked key: never put the conversation into an orphan queue.
  if (connection.mode === 'cloud' && connection.state === 'reauth') {
    return { ok: false, error: 'reauth_required', reauthRequired: true };
  }

  if (!connection.connected) {
    const queued = await enqueue({ payload, opts, site, mode: connection.mode || mode });
    await syncQueuedStat();
    return { ok: true, status: 'queued', queued };
  }

  const res = await record(payload, opts, site);
  if (res.ok) {
    if (res.status === 'skipped') { await bumpStat('filtered'); return { ok: true, status: 'skipped' }; }
    if (res.status === 'duplicate') { await bumpStat('filtered'); return { ok: true, status: 'duplicate' }; }
    await bumpStat('recorded');
    return { ok: true, status: res.status || 'ok', id: res.id };
  }
  if (res.reauthRequired) {
    await refreshConnection();
    return { ok: false, error: 'reauth_required', reauthRequired: true };
  }
  // Transient failure → queue for retry (FM-2).
  if (!res.httpStatus || res.httpStatus >= 500 || res.httpStatus === 429 || res.error === 'timeout' || res.error === 'network_error') {
    await enqueue({ payload, opts, site, mode });
    await syncQueuedStat();
    return { ok: true, status: 'queued' };
  }
  return { ok: false, status: 'rejected', error: res.error, httpStatus: res.httpStatus };
}

async function syncQueuedStat() {
  const size = await queueSize();
  const got = await chrome.storage.local.get(STORAGE.stats);
  const s = got[STORAGE.stats] || { recorded: 0, filtered: 0, queued: 0 };
  s.queued = size;
  await chrome.storage.local.set({ [STORAGE.stats]: s });
}

/** Handle an inject request — returns markdown for the content script to insert. */
async function handleInject(q, site) {
  const connection = await resolveConnection();
  if (!connection.connected) {
    return { ok: false, error: connection.state === 'reauth' ? 'reauth_required' : 'offline' };
  }
  const binding = await getBinding(site);
  const opts = binding.workspace ? { workspace: binding.workspace } : {};
  return inject(q, opts);
}

// --- mode-specific pickers --------------------------------------------------

async function listWorkspacesForMode() {
  const mode = await getMode();
  if (mode === 'cloud') return cloud.listMemories();
  return listWorkspaces();
}

async function createSessionForMode(payload, opts) {
  const mode = await getMode();
  if (mode === 'cloud') {
    // Cloud memory spaces are created in the web app, not the extension.
    return { ok: false, error: 'not_supported_in_cloud_mode' };
  }
  return createSession(payload, opts);
}

// --- status -----------------------------------------------------------------

async function getStatus() {
  const mode = await getMode();
  const connection = await resolveConnection();
  const got = await chrome.storage.local.get([STORAGE.stats, STORAGE.token]);
  const account = mode === 'cloud' ? await getAccountView() : null;
  return {
    ok: true,
    mode,
    state: connection.state,
    connected: connection.connected,
    account,
    cloudBase: mode === 'cloud' ? await getCloudBase() : null,
    stats: got[STORAGE.stats] || { recorded: 0, filtered: 0, queued: 0 },
    hasToken: !!got[STORAGE.token],
  };
}
