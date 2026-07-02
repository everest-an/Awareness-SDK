/**
 * Service Worker — the ONLY place that talks to the daemon (Option C).
 *
 * Responsibilities:
 *  - Own all http://127.0.0.1:37800 I/O (record, inject, token, workspaces).
 *  - Mint + persist the bridge token on install.
 *  - Heartbeat via chrome.alarms (min 30s) — `setInterval` can't revive a killed
 *    SW, alarms can. Tracks daemon-connected state for silent degradation (FM-1).
 *  - Retry the durable write queue on the retry alarm (FM-2).
 *  - Refresh the remote rule-pack (inert JSON) on the rulepack alarm.
 *  - Handle content-script / popup messages (capture, inject, status, bind).
 */
import {
  ALARM, STORAGE, HEARTBEAT_PERIOD_MIN, RETRY_PERIOD_MIN, RULEPACK_PERIOD_MIN,
  DEFAULT_FILTER_LEVEL,
} from './lib/config.js';
import {
  pingDaemon, ensureToken, recordMemory, fetchInjection,
  listWorkspaces, createSession,
} from './lib/daemon-client.js';
import { getActiveRulepack, refreshRemoteRulepack } from './lib/rulepack.js';
import { enqueue, getQueue, setQueue, queueSize } from './lib/queue.js';

// ---------------------------------------------------------------------------
// Lifecycle: install / startup → set alarms, mint token, warm state.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarms();
  await bootstrap();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarms();
  await bootstrap();
});

async function setupAlarms() {
  await chrome.alarms.create(ALARM.heartbeat, { periodInMinutes: HEARTBEAT_PERIOD_MIN });
  await chrome.alarms.create(ALARM.retry, { periodInMinutes: RETRY_PERIOD_MIN });
  await chrome.alarms.create(ALARM.rulepack, { periodInMinutes: RULEPACK_PERIOD_MIN });
}

async function bootstrap() {
  const alive = await pingDaemon();
  await chrome.storage.local.set({ [STORAGE.connected]: alive });
  if (alive) await ensureToken(); // best-effort; ok if it fails while offline
  await ensureStats();
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
  if (alarm.name === ALARM.heartbeat) {
    const alive = await pingDaemon();
    await chrome.storage.local.set({ [STORAGE.connected]: alive });
    if (alive) await ensureToken();
  } else if (alarm.name === ALARM.retry) {
    await drainQueue();
  } else if (alarm.name === ALARM.rulepack) {
    await refreshRemoteRulepack();
  }
});

async function drainQueue() {
  const alive = await chrome.storage.local.get(STORAGE.connected);
  if (!alive[STORAGE.connected]) return; // stay queued while offline
  const q = await getQueue();
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    const result = await recordMemory(item.payload, item.opts || {});
    if (result.ok) {
      await bumpStat('recorded');
    } else if (result.httpStatus && result.httpStatus >= 400 && result.httpStatus < 500 && result.httpStatus !== 429) {
      // permanent client error (e.g. 400/403) — drop, don't loop forever
    } else {
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts < 10) remaining.push(item);
    }
  }
  await setQueue(remaining);
  const stats = await chrome.storage.local.get(STORAGE.stats);
  const s = stats[STORAGE.stats] || {};
  s.queued = remaining.length;
  await chrome.storage.local.set({ [STORAGE.stats]: s });
}

// ---------------------------------------------------------------------------
// Message hub (content script + popup).
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Return true to keep the channel open for the async response.
  handleMessage(msg).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err) });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg?.type) {
    case 'GET_BOOTSTRAP':      return getBootstrapForSite(msg.url);
    case 'CAPTURE':            return handleCapture(msg.payload, msg.site);
    case 'INJECT':             return handleInject(msg.q, msg.site);
    case 'GET_STATUS':         return getStatus();
    case 'LIST_WORKSPACES':    return listWorkspaces();
    case 'CREATE_SESSION':     return createSession(msg.payload, msg.opts);
    case 'SET_BINDING':        return setBinding(msg.site, msg.binding);
    case 'GET_BINDING':        return { ok: true, binding: await getBinding(msg.site) };
    case 'SET_RULEPACK_URL':   return setRulepackUrl(msg.url);
    default:                   return { ok: false, error: 'unknown_message' };
  }
}

/** Content script asks: which rule + binding + settings apply to this tab? */
async function getBootstrapForSite(url) {
  const rulepack = await getActiveRulepack();
  const connected = (await chrome.storage.local.get(STORAGE.connected))[STORAGE.connected] || false;
  return { ok: true, rulepack, connected };
}

async function getBinding(site) {
  const got = await chrome.storage.local.get(STORAGE.bindings);
  const all = got[STORAGE.bindings] || {};
  return all[site] || { workspace: null, session_id: null, autoCapture: true, filterLevel: DEFAULT_FILTER_LEVEL };
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

/** Handle a captured Q&A from a content script. */
async function handleCapture(payload, site) {
  if (!payload || !payload.content) return { ok: false, error: 'empty_payload' };
  const binding = await getBinding(site);
  const opts = binding.workspace ? { workspace: binding.workspace } : {};
  if (binding.session_id) payload.session_id = binding.session_id;

  const connected = (await chrome.storage.local.get(STORAGE.connected))[STORAGE.connected] || false;
  if (!connected) {
    const queued = await enqueue({ payload, opts });
    await bumpStat('queued', 0); // recompute below
    await syncQueuedStat();
    return { ok: true, status: 'queued', queued };
  }

  const result = await recordMemory(payload, opts);
  if (result.ok) {
    if (result.status === 'skipped') { await bumpStat('filtered'); return { ok: true, status: 'skipped' }; }
    await bumpStat('recorded');
    return { ok: true, status: result.status || 'ok', id: result.id };
  }
  // Transient failure → queue for retry (FM-2).
  if (!result.httpStatus || result.httpStatus >= 500 || result.httpStatus === 429 || result.error === 'timeout' || result.error === 'network_error') {
    await enqueue({ payload, opts });
    await syncQueuedStat();
    return { ok: true, status: 'queued' };
  }
  return { ok: false, status: 'rejected', error: result.error, httpStatus: result.httpStatus };
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
  const connected = (await chrome.storage.local.get(STORAGE.connected))[STORAGE.connected] || false;
  if (!connected) return { ok: false, error: 'offline' };
  const binding = await getBinding(site);
  const opts = binding.workspace ? { workspace: binding.workspace } : {};
  return fetchInjection(q, opts);
}

async function getStatus() {
  const got = await chrome.storage.local.get([STORAGE.connected, STORAGE.stats, STORAGE.token]);
  return {
    ok: true,
    connected: got[STORAGE.connected] || false,
    stats: got[STORAGE.stats] || { recorded: 0, filtered: 0, queued: 0 },
    hasToken: !!got[STORAGE.token],
  };
}
