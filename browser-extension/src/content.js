/**
 * Content script — DOM scrape + inject ONLY. Zero daemon I/O.
 *
 * Architecture (Option C): this script must NEVER fetch 127.0.0.1. Page CSP
 * (connect-src) on strict sites blocks it, and the page Origin isn't trusted.
 * All daemon calls are relayed to the service worker via chrome.runtime
 * .sendMessage. (Enforced by scripts/verify-extension-io-boundary — this file
 * contains no `fetch('http://127.0.0.1` / `localhost`.)
 *
 * It is a generic engine driven by the rule-pack: selectors are fallback chains
 * (first match wins), finish-signals and inject-strategies are enum-dispatched.
 * DeepSeek is wired first (most stable `ds-*` selectors); the same engine drives
 * ChatGPT / Gemini / Doubao / Kimi from their rule entries.
 */
(() => {
  'use strict';

  let SITE = null;      // matched rule-pack site entry
  let CONNECTED = false;
  let lastCaptureSig = null;
  let rootObserver = null;
  let quiesceTimer = null;
  // Floating widget (ShadowDOM). We NEVER insert into the host page's composer
  // DOM — that broke site layouts. Instead a single fixed-position host element
  // hangs off <body> and everything lives inside its shadow root, fully isolated
  // from the site's CSS/JS. Default state is a small collapsed pill.
  let hostEl = null;    // light-DOM host, position:fixed bottom-right
  let root = null;      // open shadow root (open so Playwright CSS can pierce)
  let pillEl = null;    // collapsed capsule (default)
  let barEl = null;     // expanded bar
  const ID = 'awareness-bridge-host';

  // ----- tiny DOM helpers ---------------------------------------------------

  const qFirst = (selectors, root = document) => {
    for (const sel of (selectors || [])) {
      try { const el = root.querySelector(sel); if (el) return el; } catch { /* bad sel */ }
    }
    return null;
  };
  const qAllFirst = (selectors, root = document) => {
    for (const sel of (selectors || [])) {
      try { const els = root.querySelectorAll(sel); if (els.length) return Array.from(els); } catch { /* bad sel */ }
    }
    return [];
  };
  const textOf = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const hashSig = (s) => { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return String(h); };

  // ----- bootstrap ----------------------------------------------------------

  async function boot() {
    const resp = await send({ type: 'GET_BOOTSTRAP', url: location.href });
    if (!resp?.ok || !resp.rulepack) return;
    CONNECTED = !!resp.connected;
    SITE = matchSite(resp.rulepack, location.href);
    if (!SITE) return; // no adapter for this page
    startObserving();
    mountInjectBar();
    patchHistory();
  }

  function matchSite(rulepack, urlStr) {
    if (!rulepack?.sites) return null;
    let host, pathname;
    try { const u = new URL(urlStr); host = u.host; pathname = u.pathname; } catch { return null; }
    for (const site of rulepack.sites) {
      for (const glob of site.match) {
        if (globMatch(glob, host, pathname)) return site;
      }
    }
    return null;
  }
  function globMatch(glob, host, pathname) {
    const noScheme = glob.replace(/^\*:\/\//, '').replace(/^https?:\/\//, '');
    const slash = noScheme.indexOf('/');
    const hostPart = slash === -1 ? noScheme : noScheme.slice(0, slash);
    const pathPart = slash === -1 ? '/*' : noScheme.slice(slash);
    const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + esc(hostPart) + '$').test(host)
      && new RegExp('^' + esc(pathPart)).test(pathname);
  }

  // ----- capture (finish-signal → scrape latest Q&A) ------------------------

  function startObserving() {
    const rootEl = qFirst(SITE.observeRoot) || document.body;
    rootObserver = new MutationObserver(() => onMutation());
    rootObserver.observe(rootEl, { childList: true, subtree: true, characterData: true });
  }

  function onMutation() {
    const fs = SITE.finishSignal || {};
    if (fs.type === 'mutationQuiescence' || (fs.fallback && fs.fallback.type === 'mutationQuiescence')) {
      const debounce = fs.debounceMs || (fs.fallback && fs.fallback.debounceMs) || 700;
      clearTimeout(quiesceTimer);
      quiesceTimer = setTimeout(() => maybeCapture(), debounce);
    }
    if (isFinished()) maybeCapture();
  }

  function isFinished() {
    const fs = SITE.finishSignal;
    if (!fs) return false;
    const check = (sig) => {
      if (!sig) return false;
      if (sig.type === 'classRemoved') {
        const nodes = document.querySelectorAll(sig.target);
        if (!nodes.length) return false;
        // finished when NO node still carries the streaming flag
        return !Array.from(nodes).some((n) => n.classList?.contains(sig.flagClass));
      }
      if (sig.type === 'selectorGone') {
        return !document.querySelector(sig.selector);
      }
      if (sig.type === 'actionBarAppears') {
        const targets = document.querySelectorAll(sig.target);
        if (!targets.length) return false;
        const last = targets[targets.length - 1];
        return !!last.querySelector(sig.actionBar) || !!document.querySelector(sig.actionBar);
      }
      return false;
    };
    return check(fs) || check(fs.fallback);
  }

  function scrapeLatestTurn() {
    // assistant text = last assistant node's text
    const assistants = qAllFirst(SITE.selectors.assistantText?.length ? SITE.selectors.assistantText : SITE.selectors.assistantMessage);
    if (!assistants.length) return null;
    const answer = textOf(assistants[assistants.length - 1]);
    if (!answer || answer.length < 8) return null;

    // user text = last user node's text (best-effort)
    const users = qAllFirst(SITE.selectors.userText?.length ? SITE.selectors.userText : SITE.selectors.userMessage);
    const question = users.length ? textOf(users[users.length - 1]) : '';

    return { question, answer };
  }

  async function maybeCapture(force = false) {
    const binding = (await send({ type: 'GET_BINDING', site: SITE.id }))?.binding || {};
    if (!force && binding.autoCapture === false) return;

    const turn = scrapeLatestTurn();
    if (!turn) return;
    const sig = hashSig(turn.question + '' + turn.answer);
    if (!force && sig === lastCaptureSig) return; // already captured this turn
    lastCaptureSig = sig;

    const content = turn.question
      ? `Q: ${turn.question}\n\nA: ${turn.answer}`
      : turn.answer;

    const payload = {
      content,
      source: 'external_chat',
      title: turn.question ? turn.question.slice(0, 80) : `${SITE.id} answer`,
      metadata: {
        site: SITE.id,
        url: location.href,
        title: document.title,
        captured_at: new Date().toISOString(),
      },
    };
    const res = await send({ type: 'CAPTURE', payload, site: SITE.id });
    flashInjectBar(res?.status);
  }

  // ----- inject (topic → daemon markdown → composer) ------------------------

  /**
   * Mount the floating widget. Independent of the host page's composer DOM: a
   * single fixed-position host element on <body> carrying an OPEN shadow root.
   * We still require the adapter's input selector to exist first — that proves
   * the page is a real chat surface (and is what inject targets) — but we do NOT
   * insert anything into it.
   */
  function mountInjectBar() {
    if (hostEl && document.getElementById(ID)) return;
    const input = qFirst([SITE.input.selector]);
    if (!input) { setTimeout(mountInjectBar, 1500); return; }

    hostEl = document.createElement('div');
    hostEl.id = ID;
    // z-index on the light-DOM host guarantees it sits above the site. Fixed
    // positioning decouples it from the composer entirely.
    hostEl.style.cssText = 'position:fixed;z-index:99999;right:16px;bottom:88px;width:0;height:0;';
    document.documentElement.appendChild(hostEl);
    root = hostEl.attachShadow({ mode: 'open' });

    const dotColor = CONNECTED ? '#22c55e' : '#94a3b8';
    root.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .aw-pill {
          position: absolute; right: 0; bottom: 0;
          display: flex; align-items: center; gap: 4px;
          width: 40px; height: 40px; justify-content: center;
          background: #ffffff; border: 1px solid #cbd5e1; border-radius: 999px;
          box-shadow: 0 4px 14px rgba(15,23,42,.18); cursor: pointer;
          font: 16px/1 system-ui, sans-serif; user-select: none;
          transition: transform .12s ease;
        }
        .aw-pill:hover { transform: scale(1.06); }
        .aw-pill .aw-pill-dot {
          position: absolute; top: 4px; right: 4px;
          width: 8px; height: 8px; border-radius: 50%; background: ${dotColor};
          border: 1.5px solid #fff;
        }
        .aw-bar {
          position: absolute; right: 0; bottom: 0;
          display: flex; align-items: center; gap: 8px;
          min-width: 240px; max-width: 340px; padding: 8px 10px;
          background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px;
          box-shadow: 0 6px 20px rgba(15,23,42,.20);
          font: 12px/1.5 system-ui, sans-serif; color: #334155;
        }
        .aw-bar[hidden], .aw-pill[hidden] { display: none; }
        .aw-dot { width: 8px; height: 8px; border-radius: 50%; background: ${dotColor}; flex: 0 0 auto; }
        .aw-label { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .aw-find {
          flex: 0 0 auto; cursor: pointer; border: 0; border-radius: 6px;
          background: #0ea5e9; color: #fff; padding: 3px 9px; font: inherit;
        }
        .aw-collapse {
          flex: 0 0 auto; cursor: pointer; border: 0; background: transparent;
          color: #64748b; font: 14px/1 system-ui; padding: 2px 4px;
        }
        .aw-panel {
          position: absolute; right: 0; bottom: 100%; margin-bottom: 8px;
          width: 340px; max-height: 240px; overflow: auto;
          background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
          padding: 10px; box-shadow: 0 8px 24px rgba(15,23,42,.20);
        }
        .aw-panel pre {
          white-space: pre-wrap; margin: 0 0 8px;
          font: 11px/1.45 ui-monospace, SFMono-Regular, monospace; color: #475569;
        }
        .aw-inject {
          cursor: pointer; border: 0; border-radius: 6px;
          background: #16a34a; color: #fff; padding: 4px 12px; font: 12px system-ui;
        }
      </style>
      <div class="aw-pill" part="pill" title="Awareness 记忆桥">
        <span class="aw-pill-dot"></span><span aria-hidden="true">🧠</span>
      </div>
      <div class="aw-bar" hidden>
        <span class="aw-dot"></span>
        <span class="aw-label">${CONNECTED ? 'Awareness 记忆已连接' : '未连接本地记忆'}</span>
        <button class="aw-find">找相关记忆</button>
        <button class="aw-collapse" title="收起">▾</button>
      </div>`;

    pillEl = root.querySelector('.aw-pill');
    barEl = root.querySelector('.aw-bar');
    pillEl.addEventListener('click', expandBar);
    root.querySelector('.aw-collapse').addEventListener('click', collapseBar);
    root.querySelector('.aw-find').addEventListener('click', onFindMemories);

    applyViewportOffset();
    window.addEventListener('resize', applyViewportOffset);
  }

  /** Expand: pill → bar. Transient — a page reload resets to the collapsed pill. */
  function expandBar() {
    if (!barEl || !pillEl) return;
    pillEl.hidden = true;
    barEl.hidden = false;
  }

  /** Collapse: bar → pill (also drops any open memory panel). */
  function collapseBar() {
    if (!barEl || !pillEl) return;
    const panel = root.querySelector('.aw-panel');
    if (panel) panel.remove();
    barEl.hidden = true;
    pillEl.hidden = false;
  }

  /**
   * Keep the widget clear of the site's send button. Base offset is 88px; on
   * narrow (mobile-view) or short viewports the composer sits higher/differently,
   * so we lift the widget to avoid overlap.
   */
  function applyViewportOffset() {
    if (!hostEl) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    let bottom = 88;              // base: clears the desktop composer send button
    if (w < 768) bottom = 120;   // mobile-view: taller composer / toolbars, lift up
    if (h < 520) bottom = 56;    // short window: hug bottom so it never overflows top
    hostEl.style.bottom = bottom + 'px';
    hostEl.style.right = (w < 480 ? 8 : 16) + 'px';
  }

  function flashInjectBar(status) {
    if (!root) return;
    const label = root.querySelector('.aw-label');
    if (!label) return;
    const text = status === 'ok' ? '已记录本轮对话'
      : status === 'skipped' ? '本轮被过滤（噪声）'
      : status === 'queued' ? '已入队，待同步'
      : status === 'duplicate' ? '重复，已跳过'
      : label.textContent;
    label.textContent = text;
    // Surface capture feedback: auto-expand so the user (and E2E) can see it.
    if (status === 'ok' || status === 'queued' || status === 'skipped' || status === 'duplicate') {
      expandBar();
    }
  }

  async function onFindMemories() {
    const input = qFirst([SITE.input.selector]);
    const topic = input ? (input.value || input.innerText || document.title) : document.title;
    const res = await send({ type: 'INJECT', q: topic, site: SITE.id });
    if (!res?.ok) { flashInjectBar(); return; }
    if (!res.markdown || !res.card_count) {
      root.querySelector('.aw-label').textContent = '未找到相关记忆';
      return;
    }
    showInjectResult(res.markdown, res.card_count);
  }

  function showInjectResult(markdown, count) {
    if (!barEl) return;
    let panel = root.querySelector('.aw-panel');
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.className = 'aw-panel';
    const pre = document.createElement('pre');
    pre.textContent = markdown.slice(0, 2000);
    const btn = document.createElement('button');
    btn.className = 'aw-inject';
    btn.textContent = `注入 ${count} 条相关记忆`;
    btn.addEventListener('click', () => { injectIntoComposer(markdown); panel.remove(); });
    panel.appendChild(pre); panel.appendChild(btn);
    barEl.appendChild(panel);
  }

  function injectIntoComposer(text) {
    const input = qFirst([SITE.input.selector]);
    if (!input) return;
    const strategy = SITE.input.injectStrategy;
    input.focus();
    if (strategy === 'nativeValueSetter') {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const next = (input.value ? input.value + '\n\n' : '') + text;
      if (setter) setter.call(input, next); else input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else { // execCommandInsertText (ProseMirror / Quill / Lexical / contenteditable)
      // NOTE: execCommand('insertText') drives all three editor engines we target,
      // including Kimi's Lexical — Lexical applies the edit through its own reconciler
      // ASYNCHRONOUSLY (so the DOM text updates a tick later, but it does land).
      // Verified on kimi.com 2026-07-03. Do NOT add a synchronous "did it change?"
      // guard + beforeinput fallback here: the async editors always read unchanged
      // synchronously, which would double-insert.
      try {
        document.execCommand('insertText', false, text);
      } catch {
        input.textContent = (input.textContent || '') + text;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
  }

  // ----- SPA nav resilience -------------------------------------------------

  function patchHistory() {
    const rerun = () => { lastCaptureSig = null; setTimeout(() => { mountInjectBar(); }, 800); };
    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m];
      history[m] = function (...args) { const r = orig.apply(this, args); rerun(); return r; };
    }
    window.addEventListener('popstate', rerun);
  }

  // ----- messaging ----------------------------------------------------------

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
          resolve(resp);
        });
      } catch (e) { resolve({ ok: false, error: String(e) }); }
    });
  }

  // Expose a manual trigger for the popup's "record now" button.
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'MANUAL_CAPTURE') {
      maybeCapture(true).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
