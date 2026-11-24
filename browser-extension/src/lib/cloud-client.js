/**
 * Cloud REST client — runs ONLY inside the service worker.
 *
 * Auth is the `aw_` key provisioned by the F-109 OAuth grant. The key is
 * user-scoped server-side, but this client always sends the granted memory id
 * in the path so the extension can only touch the memory the user approved.
 *
 * All failures are returned as structured results (never throw across the
 * sendMessage boundary) so callers can degrade silently, queue a retry, or ask
 * the user to re-authorize.
 */
import { STORAGE, cloudPaths } from './config.js';
import { getAuth, getCloudBase, markReauthRequired } from './auth.js';
import { buildPageContent } from './page-extract.js';

const TIMEOUT_MS = 12000;

/** Retryable = a later attempt may succeed without user action. */
function result(ok, extra = {}) {
  return { ok, ...extra };
}

function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

/**
 * One authenticated JSON request.
 * @returns {Promise<{ok:boolean, status?:number, data?:any, error?:string,
 *                    retryable?:boolean, reauthRequired?:boolean}>}
 */
export async function request(path, { method = 'GET', body, timeoutMs = TIMEOUT_MS } = {}) {
  const auth = await getAuth();
  if (!auth) return result(false, { error: 'not_connected', retryable: false });

  const base = await getCloudBase();
  const url = path.startsWith('http') ? path : `${base}${path}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.apiKey}`,
        ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
      signal: ctrl.signal,
    });
  } catch (err) {
    return result(false, {
      error: err?.name === 'AbortError' ? 'timeout' : 'network_error',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { /* non-JSON (e.g. nginx 5xx HTML) */ }
  }

  if (res.status === 401) {
    // The `aw_` key is non-expiring while valid; a 401 means it was revoked or
    // is otherwise unusable. stop capturing and ask for a fresh grant.
    await markReauthRequired(true);
    return result(false, { httpStatus: 401, error: 'unauthorized', retryable: false, reauthRequired: true });
  }
  if (!res.ok) {
    return result(false, {
      httpStatus: res.status,
      data,
      error: data?.detail || data?.error || `http_${res.status}`,
      retryable: isRetryableStatus(res.status),
    });
  }
  return result(true, { httpStatus: res.status, data });
}

// ---------------------------------------------------------------------------
// Memory spaces.
// ---------------------------------------------------------------------------

export async function listMemories() {
  const res = await request('/api/v1/memories');
  if (!res.ok) return res;
  const items = Array.isArray(res.data) ? res.data : (res.data?.items || []);
  return result(true, {
    memories: items.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      ownerId: m.owner_id || m.ownerId || '',
      updatedAt: m.updated_at || m.updatedAt || '',
    })),
  });
}

export async function getMemory(memoryId) {
  const base = await getCloudBase();
  return request(cloudPaths(base).memory(memoryId));
}

// ---------------------------------------------------------------------------
// Writes (captured Q&A).
// ---------------------------------------------------------------------------

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stable idempotency key for a captured turn.
 *
 * Namespaced by memory id: `ingest_delivery.message_id` is a global primary
 * key, so a content-only hash would let two users with the same text collide.
 */
export async function messageIdFor(memoryId, content) {
  const hash = await sha256Hex(String(content || ''));
  return `ext:${memoryId}:${hash.slice(0, 40)}`;
}

/**
 * POST /memories/{id}/content — write one captured Q&A.
 * @param {{content:string, title?:string, site?:string, messageId?:string}} input
 */
export async function recordCapture(input) {
  const auth = await getAuth();
  if (!auth) return result(false, { error: 'not_connected', retryable: false });

  const content = String(input?.content || '');
  if (!content.trim()) return result(false, { error: 'empty_payload', retryable: false });

  const messageId = input.messageId || (await messageIdFor(auth.memoryId, content));
  const base = await getCloudBase();
  const res = await request(cloudPaths(base).content(auth.memoryId), {
    method: 'POST',
    timeoutMs: input.timeoutMs,
    body: {
      content,
      async_vectorize: true,
      message_id: messageId,
      kwargs: {
        source: 'external_chat',
        ...(input.site ? { site: input.site } : {}),
        ...(input.title ? { title: input.title } : {}),
      },
    },
  });
  if (!res.ok) return res;
  if (res.data?.duplicate) return result(true, { status: 'duplicate' });
  const rawStatus = res.data?.status;
  // The cloud write path reports `success`, or `queued` when it accepted the
  // content into its async vectorization queue — both mean "the server has it".
  // The content script speaks the transport-neutral vocabulary (`ok` / ...).
  const status = rawStatus === 'success' || rawStatus === 'queued' || !rawStatus ? 'ok' : rawStatus;
  return result(true, { status, id: res.data?.id, messageId });
}

// ---------------------------------------------------------------------------
// Web page capture (F-111).
// ---------------------------------------------------------------------------

/**
 * Save one page the user explicitly chose. Uses the same content endpoint as
 * chat capture, tagged so recall can tell a page from a conversation.
 *
 * @param {{url:string, title:string, text:string}} page
 */
export async function recordPage(page) {
  const auth = await getAuth();
  if (!auth) return result(false, { error: 'not_connected', retryable: false });

  const url = String(page?.url || '');
  const title = String(page?.title || '').slice(0, 200);
  const text = String(page?.text || '');
  if (!text.trim()) return result(false, { error: 'empty_page', retryable: false });

  const content = buildPageContent({ title, url, text });
  const messageId = await messageIdFor(auth.memoryId, content);
  const base = await getCloudBase();
  const res = await request(cloudPaths(base).content(auth.memoryId), {
    method: 'POST',
    body: {
      content,
      async_vectorize: true,
      message_id: messageId,
      kwargs: { source: 'web_page', url, title },
    },
  });
  if (!res.ok) return res;
  if (res.data?.duplicate) return result(true, { status: 'duplicate' });
  return result(true, { status: 'ok', id: res.data?.id, messageId });
}

// ---------------------------------------------------------------------------
// Recall.
// ---------------------------------------------------------------------------

/** Pick display fields from a heterogeneous retrieval result. */
function normalizeItem(item, index) {
  if (item == null) return null;
  if (typeof item === 'string') {
    return { id: `r${index}`, title: '', body: item, category: '', updatedAt: '' };
  }
  const body =
    item.content ?? item.summary ?? item.text ?? item.chunk ?? item.value ?? '';
  const title =
    item.title ?? item.name ?? item.card_title ?? item.heading ?? '';
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  if (!str && !title) return null;
  return {
    id: String(item.id ?? item.card_id ?? `r${index}`),
    title: String(title || ''),
    body: String(str || ''),
    category: String(item.category ?? item.type ?? item.event_type ?? ''),
    score: typeof item.score === 'number' ? item.score : undefined,
    updatedAt: String(
      item.updated_at ?? item.updatedAt ?? item.timestamp ?? item.created_at ?? ''
    ),
  };
}

export function itemsFromRetrieve(data) {
  // The cloud API is heterogeneous by endpoint:
  //   /retrieve        → { results: [...] }
  //   /knowledge-cards → { cards: [...] }
  //   /timeline        → { entries: [...] }
  //   /memories        → bare array
  const raw = Array.isArray(data)
    ? data
    : (data?.results || data?.cards || data?.entries || data?.items || []);
  return raw.map(normalizeItem).filter(Boolean);
}

export function formatInjection(items, { maxItems = 6, maxChars = 2000 } = {}) {
  const picked = items.slice(0, maxItems);
  if (!picked.length) return { markdown: '', card_count: 0 };
  let out = '### 相关记忆（Awareness）\n';
  let used = 0;
  let count = 0;
  for (const item of picked) {
    const title = item.title ? `**${item.title}**\n` : '';
    const body = item.body.length > 600 ? `${item.body.slice(0, 600)}…` : item.body;
    const block = `\n${title}${body}\n`;
    if (used + block.length > maxChars) break;
    out += block;
    used += block.length;
    count += 1;
  }
  return count ? { markdown: out, card_count: count } : { markdown: '', card_count: 0 };
}

/**
 * POST /memories/{id}/retrieve and format the result for injection.
 * `query` is the composer text / page title.
 */
export async function fetchInjection(query, { maxItems = 6, timeoutMs } = {}) {
  const auth = await getAuth();
  if (!auth) return result(false, { error: 'not_connected' });
  const base = await getCloudBase();
  const res = await request(cloudPaths(base).retrieve(auth.memoryId), {
    method: 'POST',
    timeoutMs,
    body: {
      query: String(query || '').slice(0, 2000),
      recall_mode: 'structured',
      include_raw_chunks: false,
    },
  });
  if (!res.ok) return res;
  const items = itemsFromRetrieve(res.data);
  const formatted = formatInjection(items, { maxItems });
  return result(true, { ...formatted, items });
}

/** Search used by the side panel (returns items, no markdown). */
export async function search(query, { maxItems = 20 } = {}) {
  const auth = await getAuth();
  if (!auth) return result(false, { error: 'not_connected' });
  const base = await getCloudBase();
  const res = await request(cloudPaths(base).retrieve(auth.memoryId), {
    method: 'POST',
    body: {
      query: String(query || '').slice(0, 2000),
      recall_mode: 'hybrid',
      include_raw_chunks: false,
    },
  });
  if (!res.ok) return res;
  return result(true, { items: itemsFromRetrieve(res.data).slice(0, maxItems) });
}

// ---------------------------------------------------------------------------
// Browse (side panel).
// ---------------------------------------------------------------------------

export async function knowledgeCards({ limit = 30, offset = 0, category } = {}) {
  const auth = await getAuth();
  if (!auth) return result(false, { error: 'not_connected' });
  const base = await getCloudBase();
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (category) qs.set('category', category);
  const res = await request(`${cloudPaths(base).cards(auth.memoryId)}?${qs.toString()}`);
  if (!res.ok) return res;
  return result(true, { items: itemsFromRetrieve(res.data) });
}

export async function timeline({ limit = 50, offset = 0 } = {}) {
  const auth = await getAuth();
  if (!auth) return result(false, { error: 'not_connected' });
  const base = await getCloudBase();
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await request(`${cloudPaths(base).timeline(auth.memoryId)}?${qs.toString()}`);
  if (!res.ok) return res;
  return result(true, { items: itemsFromRetrieve(res.data) });
}

// Exported for tests that need the raw storage key names.
export { STORAGE };
