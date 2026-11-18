/**
 * L2 · Cloud REST client against a REAL local HTTP server.
 *
 * No `page.route`, no fetch mocking: the client's fetch, headers, body,
 * idempotency key and error classification all run for real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeStub, withServer, readBody, json } from './harness.mjs';

import {
  request,
  recordCapture,
  messageIdFor,
  fetchInjection,
  itemsFromRetrieve,
  formatInjection,
  listMemories,
  knowledgeCards,
  timeline,
} from '../src/lib/cloud-client.js';

function authedStore(base, extra = {}) {
  return installChromeStub({
    cloud_base: base,
    cloud_auth: { apiKey: 'aw_test_key', memoryId: 'mem_1', base },
    ...extra,
  });
}

test('recordCapture POSTs content with the OAuth key + idempotency id', async () => {
  let seen = null;
  await withServer(async (req, res) => {
    seen = { method: req.method, url: req.url, auth: req.headers.authorization, body: await readBody(req) };
    json(res, 201, { status: 'success' });
  }, async (base) => {
    authedStore(base);
    const out = await recordCapture({ content: 'Q: hi\n\nA: hello', title: 'hi', site: 'deepseek' });

    assert.equal(out.ok, true);
    assert.equal(out.status, 'ok');
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/api/v1/memories/mem_1/content');
    assert.equal(seen.auth, 'Bearer aw_test_key');

    const body = JSON.parse(seen.body);
    assert.equal(body.content, 'Q: hi\n\nA: hello');
    assert.equal(body.async_vectorize, true);
    assert.match(body.message_id, /^ext:mem_1:[0-9a-f]{40}$/);
    assert.equal(body.kwargs.site, 'deepseek');
    assert.equal(body.kwargs.source, 'external_chat');
  });
});

test('recordCapture keeps the same message_id across retries (no double write)', async () => {
  const ids = [];
  await withServer(async (req, res) => {
    ids.push(JSON.parse(await readBody(req)).message_id);
    json(res, 201, { status: 'success' });
  }, async (base) => {
    authedStore(base);
    await recordCapture({ content: 'same turn' });
    await recordCapture({ content: 'same turn' });
    assert.equal(ids[0], ids[1]);
  });
});

test('messageIdFor is stable and namespaced by memory', async () => {
  const a = await messageIdFor('mem_1', 'hello');
  const b = await messageIdFor('mem_1', 'hello');
  const c = await messageIdFor('mem_2', 'hello');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a.startsWith('ext:mem_1:'));
});

test('duplicate delivery is reported as duplicate, not a second write', async () => {
  await withServer(async (_req, res) => {
    json(res, 201, { status: 'success', duplicate: true });
  }, async (base) => {
    authedStore(base);
    const out = await recordCapture({ content: 'x' });
    assert.equal(out.ok, true);
    assert.equal(out.status, 'duplicate');
  });
});

test('an async-vectorize "queued" response counts as accepted', async () => {
  await withServer(async (_req, res) => {
    json(res, 201, { status: 'queued', job_id: 'job_1' });
  }, async (base) => {
    authedStore(base);
    const out = await recordCapture({ content: 'x' });
    assert.equal(out.ok, true);
    assert.equal(out.status, 'ok');
  });
});

test('5xx HTML is classified retryable (queue, not drop)', async () => {
  await withServer(async (_req, res) => {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end('<html>bad gateway</html>');
  }, async (base) => {
    authedStore(base);
    const out = await recordCapture({ content: 'x' });
    assert.equal(out.ok, false);
    assert.equal(out.httpStatus, 502);
    assert.equal(out.retryable, true);
  });
});

test('401 marks reauth required and is never retryable', async () => {
  await withServer(async (_req, res) => {
    json(res, 401, { detail: 'Invalid API key' });
  }, async (base) => {
    const store = authedStore(base);
    const out = await recordCapture({ content: 'x' });
    assert.equal(out.ok, false);
    assert.equal(out.reauthRequired, true);
    assert.equal(out.retryable, false);
    assert.equal(store.cloud_reauth_required, true);
  });
});

test('timeout is classified retryable', async () => {
  await withServer(async () => { /* never respond */ }, async (base) => {
    authedStore(base);
    const out = await request('/api/v1/slow', { timeoutMs: 60 });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'timeout');
    assert.equal(out.retryable, true);
  });
});

test('fetchInjection formats cloud results into markdown', async () => {
  let body = null;
  await withServer(async (req, res) => {
    body = JSON.parse(await readBody(req));
    json(res, 200, {
      results: [
        { title: 'Decision', content: 'Use Postgres for durability.' },
        { title: 'Pitfall', content: 'Do not use plainto_tsquery for Chinese.' },
      ],
    });
  }, async (base) => {
    authedStore(base);
    const out = await fetchInjection('database choice');
    assert.equal(out.ok, true);
    assert.equal(out.card_count, 2);
    assert.match(out.markdown, /相关记忆/);
    assert.match(out.markdown, /Use Postgres/);
    assert.equal(body.recall_mode, 'structured');
    assert.equal(body.query, 'database choice');
  });
});

test('fetchInjection with no results returns empty markdown (no "undefined")', async () => {
  await withServer(async (_req, res) => json(res, 200, { results: [] }), async (base) => {
    authedStore(base);
    const out = await fetchInjection('nothing');
    assert.equal(out.ok, true);
    assert.equal(out.card_count, 0);
    assert.equal(out.markdown, '');
  });
});

test('itemsFromRetrieve tolerates strings and drops empty rows', () => {
  const items = itemsFromRetrieve({ results: ['plain text', { title: 'T', content: 'C' }, null, {}] });
  assert.equal(items.length, 2);
  assert.equal(items[0].body, 'plain text');
  assert.equal(items[1].title, 'T');
});

test('itemsFromRetrieve understands cards + timeline envelopes', () => {
  const cards = itemsFromRetrieve({
    cards: [{ id: 'c1', title: 'Decision', summary: 'Use Postgres', category: 'decision', updated_at: '2026-01-01' }],
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].body, 'Use Postgres');
  assert.equal(cards[0].category, 'decision');

  const timeline = itemsFromRetrieve({
    entries: [{ id: 'e1', content: 'Q: hi\nA: hello', event_type: 'turn_summary', timestamp: '2026-01-02' }],
  });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].category, 'turn_summary');
  assert.equal(timeline[0].updatedAt, '2026-01-02');
});

test('itemsFromRetrieve accepts a bare array', () => {
  const items = itemsFromRetrieve([{ id: 'm1', name: 'Work memory' }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Work memory');
});

test('formatInjection respects the character budget', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: '', body: 'x'.repeat(500), category: '', updatedAt: '' }));
  const out = formatInjection(items, { maxItems: 6, maxChars: 1200 });
  assert.ok(out.markdown.length <= 1300);
  assert.ok(out.card_count < 6);
});

test('listMemories maps the cloud list shape', async () => {
  await withServer(async (req, res) => {
    assert.equal(req.url, '/api/v1/memories');
    json(res, 200, [{ id: 'mem_1', name: 'Work', owner_id: 'u1' }]);
  }, async (base) => {
    authedStore(base);
    const out = await listMemories();
    assert.equal(out.ok, true);
    assert.deepEqual(out.memories, [{ id: 'mem_1', name: 'Work', ownerId: 'u1', updatedAt: '' }]);
  });
});

test('knowledgeCards and timeline hit the granted memory paths', async () => {
  const urls = [];
  await withServer(async (req, res) => {
    urls.push(req.url);
    json(res, 200, []);
  }, async (base) => {
    authedStore(base);
    await knowledgeCards({ limit: 10, offset: 5, category: 'decision' });
    await timeline({ limit: 20 });

    assert.equal(urls[0], '/api/v1/memories/mem_1/insights/knowledge-cards?limit=10&offset=5&category=decision');
    assert.equal(urls[1], '/api/v1/memories/mem_1/timeline?limit=20&offset=0');
  });
});

test('requests without a grant fail closed and do not touch the network', async () => {
  let hit = 0;
  await withServer(async (_req, res) => { hit += 1; json(res, 200, {}); }, async (base) => {
    installChromeStub({ cloud_base: base });
    const out = await recordCapture({ content: 'x' });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'not_connected');
    assert.equal(hit, 0);
  });
});
