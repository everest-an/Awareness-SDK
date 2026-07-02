/**
 * Popup — config panel. Talks to the SW via sendMessage only (no daemon I/O).
 * Shows connection state, binds site↔workspace↔session, filter level, live
 * stats, "record now", and an advanced remote rule-pack URL field.
 */

const $ = (id) => document.getElementById(id);

/** Map a hostname to a rule-pack site id (mirrors default-rulepack matches). */
function siteIdFromHost(host) {
  if (/chatgpt\.com|chat\.openai\.com/.test(host)) return 'chatgpt';
  if (/gemini\.google\.com/.test(host)) return 'gemini';
  if (/doubao\.com/.test(host)) return 'doubao';
  if (/kimi\.com|moonshot\.cn/.test(host)) return 'kimi';
  if (/deepseek\.com/.test(host)) return 'deepseek';
  return null;
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
      resolve(resp);
    });
  });
}

let currentSite = null;
let currentTabId = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;
  let host = '';
  try { host = new URL(tab.url).host; } catch { /* non-web tab */ }
  currentSite = siteIdFromHost(host);
  $('site-name').textContent = currentSite ? `${currentSite} (${host})` : `不支持的站点 (${host || 'n/a'})`;

  await refreshStatus();
  await loadWorkspaces();
  await loadBinding();

  $('save-binding').addEventListener('click', saveBinding);
  $('new-session').addEventListener('click', newSession);
  $('record-now').addEventListener('click', recordNow);
  $('save-rulepack').addEventListener('click', saveRulepack);
}

async function refreshStatus() {
  const st = await send({ type: 'GET_STATUS' });
  const connected = !!st?.connected;
  $('conn-dot').classList.toggle('on', connected);
  $('offline-note').classList.toggle('hidden', connected);
  const stats = st?.stats || { recorded: 0, filtered: 0, queued: 0 };
  $('stat-recorded').textContent = stats.recorded ?? 0;
  $('stat-filtered').textContent = stats.filtered ?? 0;
  $('stat-queued').textContent = stats.queued ?? 0;
}

async function loadWorkspaces() {
  const res = await send({ type: 'LIST_WORKSPACES' });
  if (!res?.ok || !res.workspaces) return;
  const sel = $('workspace');
  // /workspaces returns a path-keyed map { "C:\\...": {lastUsed,...} }.
  const paths = Object.keys(res.workspaces);
  for (const p of paths) {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  }
}

async function loadBinding() {
  if (!currentSite) return;
  const res = await send({ type: 'GET_BINDING', site: currentSite });
  const b = res?.binding || {};
  if (b.workspace) $('workspace').value = b.workspace;
  if (b.session_id) $('session').value = b.session_id;
  $('auto-capture').checked = b.autoCapture !== false;
  if (b.filterLevel) $('filter').value = b.filterLevel;
}

async function saveBinding() {
  if (!currentSite) return;
  const binding = {
    workspace: $('workspace').value || null,
    session_id: $('session').value.trim() || null,
    autoCapture: $('auto-capture').checked,
    filterLevel: $('filter').value,
  };
  const res = await send({ type: 'SET_BINDING', site: currentSite, binding });
  $('save-binding').textContent = res?.ok ? '已保存 ✓' : '保存失败';
  setTimeout(() => { $('save-binding').textContent = '保存绑定'; }, 1500);
}

async function newSession() {
  const workspace = $('workspace').value || null;
  const res = await send({
    type: 'CREATE_SESSION',
    payload: { source: 'external_chat', site: currentSite },
    opts: workspace ? { workspace } : {},
  });
  if (res?.ok && res.session?.id) {
    $('session').value = res.session.id;
  } else {
    $('new-session').textContent = '失败';
    setTimeout(() => { $('new-session').textContent = '新建'; }, 1500);
  }
}

async function recordNow() {
  if (currentTabId == null) return;
  chrome.tabs.sendMessage(currentTabId, { type: 'MANUAL_CAPTURE' }, () => {
    // ignore lastError (tab may not have content script)
    void chrome.runtime.lastError;
    setTimeout(refreshStatus, 800);
  });
}

async function saveRulepack() {
  const url = $('rulepack-url').value.trim();
  const res = await send({ type: 'SET_RULEPACK_URL', url });
  $('save-rulepack').textContent = res?.refresh?.updated ? '已更新 ✓' : '已保存';
  setTimeout(() => { $('save-rulepack').textContent = '保存并刷新'; }, 1500);
}

init();
