/**
 * Web page saver — content script injected ONLY into origins the user turned on
 * in the popup ("在此站点常驻保存图标").
 *
 * It never captures anything on its own: the pill waits for a click, then shows
 * a preview card, and only the explicit 保存 button messages the service worker.
 * Extraction + network live in the SW (Option C: content scripts do no I/O).
 */
(() => {
  'use strict';

  const ID = 'awareness-page-saver-host';
  if (document.getElementById(ID)) return;

  // The 5 AI chat sites already carry the capture pill from content.js.
  const AI_HOSTS = /(^|\.)(chatgpt\.com|chat\.openai\.com|gemini\.google\.com|doubao\.com|kimi\.com|moonshot\.cn|deepseek\.com)$/;
  if (AI_HOSTS.test(location.hostname)) return;

  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'position:fixed;z-index:2147483646;right:16px;bottom:24px;width:0;height:0;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  let cardEl = null;
  let busy = false;

  root.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .aw-save {
        position: absolute; right: 0; bottom: 0;
        width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
        background: #ffffff; border: 1px solid #cbd5e1; border-radius: 999px;
        box-shadow: 0 4px 14px rgba(15,23,42,.18); cursor: pointer;
        font: 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; user-select: none;
        transition: transform .12s ease, box-shadow .12s ease;
      }
      .aw-save:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,23,42,.24); }
      .aw-save:active { transform: translateY(0); }
      .aw-save svg { width: 18px; height: 18px; color: #0f766e; }
      .aw-card {
        position: absolute; right: 0; bottom: 46px; width: 300px;
        background: #ffffff; color: #0f172a; border: 1px solid #dbe3ee; border-radius: 14px;
        box-shadow: 0 16px 40px rgba(15,23,42,.22); overflow: hidden;
        font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .aw-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #eef2f7; }
      .aw-dot { width: 7px; height: 7px; border-radius: 50%; background: #14b8a6; }
      .aw-head b { font-size: 12px; font-weight: 650; letter-spacing: .01em; }
      .aw-x { margin-left: auto; border: 0; background: transparent; color: #94a3b8; font-size: 16px; cursor: pointer; line-height: 1; }
      .aw-body { padding: 10px 12px; max-height: 210px; overflow: auto; }
      .aw-title { font-weight: 600; margin-bottom: 6px; word-break: break-word; }
      .aw-preview { color: #475569; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
      .aw-url { color: #94a3b8; font-size: 11px; margin-top: 6px; word-break: break-all; }
      .aw-actions { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #eef2f7; }
      .aw-btn {
        flex: 1; height: 32px; border-radius: 8px; border: 1px solid transparent; cursor: pointer;
        font: 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; font-weight: 600;
      }
      .aw-btn.primary { background: #14b8a6; color: #ffffff; }
      .aw-btn.primary:disabled { opacity: .5; cursor: default; }
      .aw-btn.ghost { background: #f1f5f9; color: #334155; }
      .aw-status { padding: 0 12px 10px; font-size: 12px; color: #0f766e; }
      .aw-status.err { color: #b91c1c; }
    </style>
    <button class="aw-save" title="保存这一页到 Awareness">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>
        <path d="M14 3v5h5"/>
        <path d="M9 13h6M9 17h4"/>
      </svg>
    </button>
  `;

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
        resolve(resp);
      });
    });
  }

  function closeCard() {
    cardEl?.remove();
    cardEl = null;
  }

  function pagePreview() {
    const pick = (sel) => {
      try {
        const el = document.querySelector(sel);
        return el ? el.innerText || el.textContent || '' : '';
      } catch { return ''; }
    };
    const text = (pick('article') || pick('main') || (document.body ? document.body.innerText : '') || '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      title: (document.title || location.hostname).trim(),
      url: location.href,
      preview: text.slice(0, 220),
    };
  }

  function openCard() {
    if (cardEl) { closeCard(); return; }
    const info = pagePreview();
    cardEl = document.createElement('div');
    cardEl.className = 'aw-card';
    cardEl.innerHTML = `
      <div class="aw-head"><span class="aw-dot"></span><b>保存这一页到 Awareness</b>
        <button class="aw-x" aria-label="关闭">×</button>
      </div>
      <div class="aw-body">
        <div class="aw-title"></div>
        <div class="aw-preview"></div>
        <div class="aw-url"></div>
      </div>
      <div class="aw-actions">
        <button class="aw-btn ghost" data-act="cancel">取消</button>
        <button class="aw-btn primary" data-act="save">保存</button>
      </div>
      <div class="aw-status" hidden></div>
    `;
    cardEl.querySelector('.aw-title').textContent = info.title;
    cardEl.querySelector('.aw-preview').textContent = info.preview || '（未提取到正文）';
    cardEl.querySelector('.aw-url').textContent = info.url;

    cardEl.querySelector('.aw-x').addEventListener('click', closeCard);
    cardEl.querySelector('[data-act="cancel"]').addEventListener('click', closeCard);
    cardEl.querySelector('[data-act="save"]').addEventListener('click', () => save(cardEl));
    root.appendChild(cardEl);
  }

  async function save(card) {
    if (busy) return;
    busy = true;
    const btn = card.querySelector('[data-act="save"]');
    const status = card.querySelector('.aw-status');
    btn.disabled = true;
    btn.textContent = '保存中…';

    const res = await send({ type: 'SAVE_PAGE_FROM_PAGE' });
    busy = false;

    if (res?.ok) {
      status.hidden = false;
      status.classList.remove('err');
      status.textContent = `已保存${res.chars ? ` · ${res.chars} 字` : ''}`;
      btn.textContent = '已保存 ✓';
      setTimeout(closeCard, 1600);
      return;
    }

    status.hidden = false;
    status.classList.add('err');
    status.textContent = res?.error === 'not_connected'
      ? '未连接 Awareness，请先在扩展弹窗里连接'
      : res?.error === 'reauth_required'
        ? '授权已失效，请重新连接'
        : '保存失败，请稍后重试';
    btn.disabled = false;
    btn.textContent = '重试';
  }

  root.querySelector('.aw-save').addEventListener('click', openCard);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
})();
