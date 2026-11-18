/**
 * Side panel — read-only cloud memory browser (F-109).
 *
 * All network I/O stays in the service worker; this page only sends messages
 * and renders. State transitions live in `lib/panel-state.js` (unit-tested).
 */
import { initialState, reduce, messageFor } from '../lib/panel-state.js';

const $ = (id) => document.getElementById(id);

let state = initialState();
let status = null;

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
      resolve(resp);
    });
  });
}

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

async function init() {
  $('search-btn').addEventListener('click', onSearch);
  $('query').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearch(); });
  $('refresh').addEventListener('click', () => load(state.tab));
  $('detail-back').addEventListener('click', () => { state = reduce(state, { type: 'CLEAR_SELECT' }); render(); });
  $('detail-copy').addEventListener('click', copyDetail);
  $('login').addEventListener('click', login);
  for (const btn of document.querySelectorAll('#tabs button')) {
    btn.addEventListener('click', () => onTab(btn.dataset.tab));
  }

  await refreshStatus();
}

async function refreshStatus() {
  status = await send({ type: 'GET_STATUS' });
  const connected = !!status?.connected;
  $('conn-dot').classList.toggle('on', connected);
  $('memory-name').textContent =
    status?.account?.memoryName || (connected ? '云端记忆' : '未连接');

  if (!status?.ok || status.mode !== 'cloud') {
    state = reduce(state, { type: 'UNAUTHORIZED' });
    render();
    return;
  }
  if (!connected) {
    state = reduce(state, { type: 'UNAUTHORIZED' });
    render();
    return;
  }
  await load(state.tab);
}

// ---------------------------------------------------------------------------
// Data loading.
// ---------------------------------------------------------------------------

const LOADERS = {
  search: (q) => send({ type: 'CLOUD_SEARCH', query: q, maxItems: 30 }),
  cards: () => send({ type: 'CLOUD_CARDS', limit: 50 }),
  timeline: () => send({ type: 'CLOUD_TIMELINE', limit: 50 }),
};

async function load(tab) {
  const query = $('query').value.trim();
  if (tab === 'search' && !query) {
    state = reduce(state, { type: 'SET_TAB', tab });
    render();
    return;
  }

  state = reduce(state, { type: 'LOAD_START' });
  state = { ...state, tab };
  render();

  const res = await LOADERS[tab](query);
  if (!res?.ok) {
    if (res?.error === 'unauthorized' || res?.reauthRequired || res?.error === 'not_connected') {
      state = reduce(state, { type: 'UNAUTHORIZED' });
    } else {
      state = reduce(state, { type: 'LOAD_ERR', error: res?.error || 'unknown' });
    }
    render();
    return;
  }
  state = reduce(state, { type: 'LOAD_OK', items: res.items || [] });
  render();
}

function onTab(tab) {
  state = reduce(state, { type: 'SET_TAB', tab });
  if (tab === 'search') {
    render();
    $('query').focus();
    return;
  }
  load(tab);
}

function onSearch() {
  state = reduce(state, { type: 'SET_TAB', tab: 'search' });
  load('search');
}

// ---------------------------------------------------------------------------
// Render.
// ---------------------------------------------------------------------------

function render() {
  for (const btn of document.querySelectorAll('#tabs button')) {
    btn.classList.toggle('active', btn.dataset.tab === state.tab);
  }

  const unauthorized = state.status === 'unauthorized';
  const wrongMode = unauthorized && status?.mode && status.mode !== 'cloud';
  $('connect').classList.toggle('hidden', !(unauthorized && !wrongMode));
  $('content').classList.toggle('hidden', !!state.selected || (unauthorized && !wrongMode));
  $('detail').classList.toggle('hidden', !state.selected);

  if (state.selected) {
    renderDetail(state.selected);
    return;
  }
  if (unauthorized) {
    $('state-msg').textContent = wrongMode
      ? `侧边栏只读云端记忆；当前是${status.mode === 'local' ? '本地' : '关闭'}模式。请在扩展弹窗里切到「云端」。`
      : '';
    return;
  }

  const msg = messageFor(state);
  $('state-msg').textContent = msg;
  $('state-msg').classList.toggle('hidden', state.status === 'ready');

  const list = $('list');
  list.innerHTML = '';
  if (state.status !== 'ready') return;
  for (const item of state.items) {
    list.appendChild(renderItem(item));
  }
}

function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'item';

  const h = document.createElement('h3');
  h.textContent = item.title || firstLine(item.body) || '未命名记忆';
  li.appendChild(h);

  if (item.body) {
    const p = document.createElement('p');
    p.textContent = item.body;
    li.appendChild(p);
  }

  const metaBits = [item.category, formatDate(item.updatedAt)].filter(Boolean);
  if (metaBits.length) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = metaBits.join(' · ');
    li.appendChild(meta);
  }

  li.addEventListener('click', () => {
    state = reduce(state, { type: 'SELECT', item });
    render();
  });
  return li;
}

function renderDetail(item) {
  $('detail-title').textContent = item.title || firstLine(item.body) || '未命名记忆';
  const metaBits = [item.category, formatDate(item.updatedAt)].filter(Boolean);
  $('detail-meta').textContent = metaBits.join(' · ');
  $('detail-body').textContent = item.body || '';
}

async function copyDetail() {
  if (!state.selected?.body) return;
  try {
    await navigator.clipboard.writeText(state.selected.body);
    $('detail-copy').textContent = '已复制 ✓';
    setTimeout(() => { $('detail-copy').textContent = '复制内容'; }, 1500);
  } catch { /* clipboard denied — leave the label unchanged */ }
}

async function login() {
  const btn = $('login');
  btn.disabled = true;
  btn.textContent = '正在打开授权页…';
  const res = await send({ type: 'LOGIN' });
  btn.disabled = false;
  btn.textContent = '连接 Awareness';
  if (!res?.ok) {
    $('login-error').textContent = res?.error === 'auth_cancelled' ? '已取消授权。' : `连接失败：${res?.error || 'unknown'}`;
    $('login-error').classList.remove('hidden');
    return;
  }
  await refreshStatus();
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function firstLine(text) {
  const line = String(text || '').split('\n').find((l) => l.trim());
  return line ? line.slice(0, 80) : '';
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

init();
