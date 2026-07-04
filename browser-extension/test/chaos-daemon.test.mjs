/**
 * F-085 (R3) · Chaos / failure-mode tests for the extension's daemon calls —
 * ACCEPTANCE Journey 3 + Failure Modes.
 *
 * The daemon-client contract is "never throw across the sendMessage boundary —
 * return a structured result so the UI can degrade or queue". This suite drives
 * each external call through the mandatory 3 cases (happy / 5xx HTML / timeout)
 * and asserts the caller gets a structured `{ok:false, error:<string>}` — never
 * a throw, never `undefined` — so the user sees a visible degraded state, not a
 * crash or an injected "undefined".
 *
 * Reuses scripts/chaos-helpers.mjs (stubFetchSequence + PRESETS). A stored bridge
 * token is mocked so recordMemory does a single fetch (no mint round-trip).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { recordMemory, fetchInjection } from '../src/lib/daemon-client.js';
import { refreshRemoteRulepack } from '../src/lib/rulepack.js';
import { STORAGE } from '../src/lib/config.js';
import { stubFetchSequence, PRESETS } from '../../../scripts/chaos-helpers.mjs';

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

let stub;

beforeEach(() => {
  // Stored token → ensureToken() short-circuits, so each call = a single fetch.
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ [STORAGE.token]: 'brg_testtoken' }),
        set: async () => {},
      },
    },
  };
});

afterEach(() => {
  stub?.restore();
  stub = null;
  delete globalThis.chrome;
});

describe('F-085 R3 · recordMemory failure modes', () => {
  it('happy: 200 → { ok:true, id }', async () => {
    stub = stubFetchSequence([
      { status: 200, body: '{"status":"ok","id":"m1"}', contentType: 'application/json' },
    ]);
    const out = await recordMemory({ content: 'hi', source: 'external_chat' });
    assert.equal(out.ok, true);
    assert.equal(out.id, 'm1');
  });

  it('5xx HTML: 502 → structured error, no throw, no undefined', async () => {
    stub = stubFetchSequence(PRESETS.html502());
    const out = await recordMemory({ content: 'hi', source: 'external_chat' });
    assert.equal(out.ok, false);
    assert.equal(out.httpStatus, 502);
    assert.equal(out.error, 'http_502'); // HTML body isn't parsed into "undefined"
  });

  it('timeout (AbortError) → { ok:false, error:"timeout" }', async () => {
    stub = stubFetchSequence([{ throw: abortError() }]);
    const out = await recordMemory({ content: 'hi', source: 'external_chat' });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'timeout');
  });

  it('network error (non-abort throw) → { ok:false, error:"network_error" }', async () => {
    stub = stubFetchSequence(PRESETS.timeout()); // plain Error("ETIMEDOUT")
    const out = await recordMemory({ content: 'hi', source: 'external_chat' });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'network_error');
  });
});

describe('F-085 R3 · fetchInjection failure modes', () => {
  it('happy: 200 → { ok:true, markdown }', async () => {
    stub = stubFetchSequence([
      { status: 200, body: '{"markdown":"# mem","card_count":2}', contentType: 'application/json' },
    ]);
    const out = await fetchInjection('topic');
    assert.equal(out.ok, true);
    assert.equal(out.markdown, '# mem');
  });

  it('5xx HTML: 502 → { ok:false, error:"http_502" } — never injects "undefined"', async () => {
    stub = stubFetchSequence(PRESETS.html502());
    const out = await fetchInjection('topic');
    assert.equal(out.ok, false);
    assert.equal(out.error, 'http_502');
    assert.notEqual(out.markdown, 'undefined');
    assert.equal(out.markdown, undefined); // caller renders "can't reach memory", not text
  });

  it('timeout / abort → { ok:false, error:"network_error" }', async () => {
    stub = stubFetchSequence([{ throw: abortError() }]);
    const out = await fetchInjection('topic');
    assert.equal(out.ok, false);
    assert.equal(out.error, 'network_error');
  });
});

describe('F-085 R3 · refreshRemoteRulepack failure modes (fallback to bundled)', () => {
  it('remote 5xx → { updated:false, reason:"http_500" }', async () => {
    stub = stubFetchSequence([{ status: 500, body: 'oops', contentType: 'text/html' }]);
    const out = await refreshRemoteRulepack(); // no trust key → shape-only path
    assert.equal(out.updated, false);
    assert.equal(out.reason, 'http_500');
  });

  it('remote fetch throws (timeout/offline) → { updated:false, reason:"fetch_failed" }', async () => {
    stub = stubFetchSequence([{ throw: abortError() }]);
    const out = await refreshRemoteRulepack();
    assert.equal(out.updated, false);
    assert.equal(out.reason, 'fetch_failed');
  });

  it('remote returns non-JSON → { updated:false, reason:"invalid_json" }', async () => {
    stub = stubFetchSequence([{ status: 200, body: '<html>not json</html>', contentType: 'text/html' }]);
    const out = await refreshRemoteRulepack();
    assert.equal(out.updated, false);
    assert.equal(out.reason, 'invalid_json');
  });
});
