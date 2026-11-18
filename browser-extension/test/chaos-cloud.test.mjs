/**
 * L3 · Cloud chaos triples — every external call gets happy / 5xx-HTML / timeout.
 *
 * Real HTTP server, real client. No mocks: the point is to prove the *shape* of
 * degradation (retry → queue, never throw, never inject "undefined").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeStub, withServer, json } from './harness.mjs';

import { recordCapture, fetchInjection } from '../src/lib/cloud-client.js';

function authed(base) {
  installChromeStub({
    cloud_base: base,
    cloud_auth: { apiKey: 'aw_k', memoryId: 'mem_1', base },
  });
}

// --------------------------------------------------------------- record
test('record · happy → ok', async () => {
  await withServer(async (_req, res) => json(res, 201, { status: 'success' }), async (base) => {
    authed(base);
    const out = await recordCapture({ content: 'x' });
    assert.equal(out.ok, true);
  });
});

test('record · 5xx HTML → retryable, no throw', async () => {
  await withServer(async (_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<html>oops</html>');
  }, async (base) => {
    authed(base);
    const out = await recordCapture({ content: 'x' });
    assert.equal(out.ok, false);
    assert.equal(out.retryable, true);
    assert.equal(out.httpStatus, 500);
  });
});

test('record · timeout → retryable, no throw', async () => {
  await withServer(async () => { /* hang */ }, async (base) => {
    authed(base);
    const out = await recordCapture({ content: 'x', timeoutMs: 60 });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'timeout');
    assert.equal(out.retryable, true);
  });
});

// ------------------------------------------------------------- retrieve
test('retrieve · happy → markdown, never "undefined"', async () => {
  await withServer(async (_req, res) => json(res, 200, {
    results: [{ title: 'A', content: 'B' }],
  }), async (base) => {
    authed(base);
    const out = await fetchInjection('q');
    assert.equal(out.ok, true);
    assert.match(out.markdown, /A/);
    assert.doesNotMatch(out.markdown, /undefined/);
  });
});

test('retrieve · 5xx HTML → retryable, empty markdown', async () => {
  await withServer(async (_req, res) => {
    res.writeHead(503, { 'Content-Type': 'text/html' });
    res.end('<html>down</html>');
  }, async (base) => {
    authed(base);
    const out = await fetchInjection('q');
    assert.equal(out.ok, false);
    assert.equal(out.retryable, true);
    assert.equal(out.markdown, undefined);
  });
});

test('retrieve · timeout → retryable, no throw', async () => {
  await withServer(async () => { /* hang */ }, async (base) => {
    authed(base);
    const out = await fetchInjection('q', { timeoutMs: 60 });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'timeout');
    assert.equal(out.retryable, true);
  });
});
