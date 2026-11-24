/**
 * Popup — account/mode panel. Talks to the SW via sendMessage only (no network).
 *
 * Cloud: connect (OAuth), show the granted memory + key prefix, open side panel.
 * Local: bind site ↔ workspace ↔ session (unchanged F-064 behaviour).
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
let currentTabUrl = '';
let status = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id ?? null;
  currentTabUrl = tab?.url ?? '';
  let host = '';
  try { host = new URL(tab.url).host; } catch { /* non-web tab */ }
  currentSite = siteIdFromHost(host);
  $('site-name').textContent = currentSite ? `${currentSite} (${host})` : `不支持的站点 (${host || 'n/a'})`;
  // AI-capture controls only make sense on a supported chat site. On any other
  // page the popup offers page saving instead (F-111).
  $('binding-card').classList.toggle('hidden', !currentSite);
  $('record-now').classList.toggle('hidden', !currentSite);
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;

  await refreshStatus();
  await loadBinding();
  await loadAdvanced();

  $('login').addEventListener('click', login);
  $('logout').addEventListener('click', logout);
  $('open-panel').addEventListener('click', openPanel);
  $('save-binding').addEventListener('click', saveBinding);
  $('new-session').addEventListener('click', newSession);
  $('record-now').addEventListener('click', recordNow);
  $('save-page').addEventListener('click', savePageNow);
  $('page-longterm').addEventListener('change', togglePageLongterm);
  $('save-rulepack').addEventListener('click', saveRulepack);
  $('save-cloud-base').addEventListener('click', saveCloudBase);
  for (const btn of document.querySelectorAll('.mode')) {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  }
}

// ---------------------------------------------------------------------------
// Status rendering.
// ---------------------------------------------------------------------------

async function refreshStatus() {
  status = await send({ type: 'GET_STATUS' });
  if (!status?.ok) return;

  const dot = $('conn-dot');
  dot.classList.toggle('on', !!status.connected);
  dot.classList.toggle('warn', status.state === 'reauth');

  const isCloud = status.mode === 'cloud';
  const isLocal = status.mode === 'local';
  const account = status.account;

  for (const btn of document.querySelectorAll('.mode')) {
    btn.classList.toggle('active', btn.dataset.mode === status.mode);
  }

  const needConnect = isCloud && (!account || status.state === 'reauth');
  $('connect').classList.toggle('hidden', !needConnect);
  $('account').classList.toggle('hidden', !(isCloud && account && status.state !== 'reauth'));
  $('local-fields').classList.toggle('hidden', !isLocal);

  if (needConnect) {
    const err = $('login-error');
    if (status.state === 'reauth') {
      err.textContent = '授权已失效（可能已在设置里撤销）。请重新连接。';
      err.classList.remove('hidden');
    } else {
      err.classList.add('hidden');
    }
    $('login').textContent = status.state === 'reauth' ? '重新连接' : '连接 Awareness';
  }

  if (account) {
    $('memory-name').textContent = account.memoryName || account.memoryId;
    $('key-prefix').textContent = `${account.keyPrefix || 'aw_…'}…`;
  }

  const note = $('offline-note');
  let noteText = '';
  if (status.mode === 'off') {
    noteText = '已关闭：不采集、不注入。随时切回云端或本地。';
  } else if (isLocal && !status.connected) {
    noteText = '未连接本地记忆。请先启动 daemon：npx @awareness.market/local start（端口 37800）。';
  } else if (isCloud && status.state === 'reauth') {
    noteText = '';
  }
  note.textContent = noteText;
  note.classList.toggle('hidden', !noteText);

  const stats = status.stats || { recorded: 0, filtered: 0, queued: 0 };
  $('stat-recorded').textContent = stats.recorded ?? 0;
  $('stat-filtered').textContent = stats.filtered ?? 0;
  $('stat-queued').textContent = stats.queued ?? 0;

  await refreshPageSave();
}

// ---------------------------------------------------------------------------
// F-111 · save the page you are reading.
// ---------------------------------------------------------------------------

function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

function pageFlash(text, isError = false) {
  const el = $('page-status');
  el.textContent = text;
  el.classList.toggle('err', isError);
  el.classList.remove('hidden');
}

/** Show the page-save card only for a connected cloud account on a web page. */
async function refreshPageSave() {
  const box = $('page-save');
  const connected = status?.ok
    && status.mode === 'cloud'
    && status.connected
    && !!status.account
    && status.state !== 'reauth';
  const origin = originOf(currentTabUrl);
  if (!connected || !origin) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  $('page-site').textContent = origin.replace(/^https?:\/\//, '');
  const res = await send({ type: 'GET_PAGE_SITES' });
  $('page-longterm').checked = Array.isArray(res?.origins) && res.origins.includes(origin);
}

async function savePageNow() {
  const btn = $('save-page');
  const statusEl = $('page-status');
  btn.disabled = true;
  btn.textContent = '保存中…';
  statusEl.classList.add('hidden');

  const res = await send({ type: 'SAVE_PAGE_ACTIVE' });
  btn.disabled = false;
  btn.textContent = '保存当前页到记忆';

  if (res?.ok) {
    pageFlash(
      res.status === 'duplicate'
        ? '这一页已经在记忆里了'
        : `已保存${res.chars ? ` · ${res.chars} 字` : ''}`,
    );
    setTimeout(() => statusEl.classList.add('hidden'), 3000);
  } else if (res?.error === 'cannot_read_page') {
    pageFlash('无法读取此页（浏览器内部页、商店页不支持）', true);
  } else if (res?.error === 'not_connected' || res?.reauthRequired) {
    pageFlash('未连接或授权已失效，请重新连接', true);
  } else {
    pageFlash('保存失败，请稍后重试', true);
  }
}

/**
 * Long-term icon for this site. The host permission MUST be requested inside the
 * user gesture, so this runs directly in the change handler (no await before
 * chrome.permissions.request).
 */
async function togglePageLongterm(event) {
  const want = event.target.checked;
  const origin = originOf(currentTabUrl);
  if (!origin) return;

  if (want) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch {
      granted = false;
    }
    if (!granted) {
      event.target.checked = false;
      pageFlash('需要站点权限才能在页面上显示图标', true);
      return;
    }
    const res = await send({ type: 'PAGE_SITE_ENABLE', origin });
    if (!res?.ok) {
      event.target.checked = false;
      pageFlash('开启失败，请重试', true);
      return;
    }
    pageFlash('已开启：本页右下角出现保存图标');
  } else {
    await send({ type: 'PAGE_SITE_DISABLE', origin });
    try { await chrome.permissions.remove({ origins: [`${origin}/*`] }); } catch { /* already gone */ }
    pageFlash('已关闭此站点的常驻图标');
  }
}

// ---------------------------------------------------------------------------
// Cloud auth.
// ---------------------------------------------------------------------------

async function login() {
  const btn = $('login');
  btn.disabled = true;
  btn.textContent = '正在打开授权页…';
  $('login-error').classList.add('hidden');

  const res = await send({ type: 'LOGIN' });
  btn.disabled = false;

  if (!res?.ok) {
    $('login').textContent = '重新连接';
    $('login-error').textContent = loginErrorText(res?.error, res?.detail);
    $('login-error').classList.remove('hidden');
    return;
  }
  await refreshStatus();
  await loadBinding();
}

function loginErrorText(code, detail) {
  switch (code) {
    case 'auth_cancelled': return '已取消授权。';
    case 'state_mismatch': return '授权校验失败（state 不匹配），请重试。';
    case 'not_extension_client': return '服务器还不支持扩展授权，请稍后再试或改用本地模式。';
    case 'registration_failed': return '无法注册扩展客户端，请检查网络后重试。';
    case 'token_failed': return '换取凭证失败，请重试。';
    default: return `连接失败：${code || 'unknown'}${detail ? ` (${detail})` : ''}`;
  }
}

async function logout() {
  await send({ type: 'LOGOUT' });
  await refreshStatus();
}

async function openPanel() {
  try {
    // Call open() directly in the click handler (no await before it) so the
    // user gesture is still valid; WINDOW_ID_CURRENT avoids a windows.getCurrent
    // round-trip that can consume the gesture.
    await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    window.close();
  } catch {
    // Older Chrome or a blocked side panel: fall back to the web app.
    chrome.tabs.create({ url: status?.cloudBase || 'https://awareness.market' });
  }
}

// ---------------------------------------------------------------------------
// Mode.
// ---------------------------------------------------------------------------

async function switchMode(mode) {
  const res = await send({ type: 'SET_MODE', mode });
  if (!res?.ok) return;
  await refreshStatus();
  await loadBinding();
}

// ---------------------------------------------------------------------------
// Site binding.
// ---------------------------------------------------------------------------

async function loadBinding() {
  if (!currentSite) return;
  const res = await send({ type: 'GET_BINDING', site: currentSite });
  const b = res?.binding || {};
  $('auto-capture').checked = b.autoCapture !== false;
  if (b.filterLevel) $('filter').value = b.filterLevel;
  if (b.session_id) $('session').value = b.session_id;
  if (status?.mode === 'local') await loadWorkspaces();
}

async function loadWorkspaces() {
  const res = await send({ type: 'LIST_WORKSPACES' });
  if (!res?.ok || !res.workspaces) return;
  const sel = $('workspace');
  const current = sel.value;
  sel.innerHTML = '<option value="">（使用 daemon 当前项目）</option>';
  // /workspaces returns a path-keyed map { "C:\\...": {lastUsed,...} }.
  for (const p of Object.keys(res.workspaces)) {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  }
  sel.value = current;
}

async function saveBinding() {
  if (!currentSite) return;
  const res = await send({ type: 'GET_BINDING', site: currentSite });
  const existing = res?.binding || {};
  const binding = {
    ...existing,
    workspace: status?.mode === 'local' ? ($('workspace').value || null) : existing.workspace,
    session_id: status?.mode === 'local' ? ($('session').value.trim() || null) : existing.session_id,
    autoCapture: $('auto-capture').checked,
    filterLevel: $('filter').value,
  };
  const saved = await send({ type: 'SET_BINDING', site: currentSite, binding });
  $('save-binding').textContent = saved?.ok ? '已保存 ✓' : '保存失败';
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
    $('new-session').textContent = '仅本地模式';
    setTimeout(() => { $('new-session').textContent = '新建'; }, 1500);
  }
}

async function recordNow() {
  if (currentTabId == null) return;
  chrome.tabs.sendMessage(currentTabId, { type: 'MANUAL_CAPTURE' }, () => {
    void chrome.runtime.lastError;
    setTimeout(refreshStatus, 800);
  });
}

// ---------------------------------------------------------------------------
// Advanced.
// ---------------------------------------------------------------------------

async function loadAdvanced() {
  const got = await chrome.storage.local.get(['rulepack_url', 'cloud_base']);
  $('rulepack-url').value = got.rulepack_url || '';
  $('cloud-base').value = got.cloud_base || 'https://awareness.market';
}

async function saveRulepack() {
  const url = $('rulepack-url').value.trim();
  const res = await send({ type: 'SET_RULEPACK_URL', url });
  $('save-rulepack').textContent = res?.refresh?.updated ? '已更新 ✓' : '已保存';
  setTimeout(() => { $('save-rulepack').textContent = '刷新'; }, 1500);
}

async function saveCloudBase() {
  const base = $('cloud-base').value.trim() || 'https://awareness.market';
  const res = await send({ type: 'SET_CLOUD_BASE', base });
  $('save-cloud-base').textContent = res?.ok ? '已保存 ✓' : '保存失败';
  setTimeout(() => { $('save-cloud-base').textContent = '保存'; }, 1500);
  await refreshStatus();
}

init();
