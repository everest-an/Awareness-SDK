/**
 * F-085 (R2) · Rule-pack signature verification — ACCEPTANCE Journey 2.
 *
 * A remote rule-pack decides which DOM nodes the extension scrapes, so a
 * poisoned pack could target a password field. This suite proves verify-before-
 * apply: only a pack carrying a valid Ed25519 signature over its exact bytes is
 * applied; a tampered or unsigned pack is rejected and the bundled default is
 * kept.
 *
 * Two layers:
 *   - crypto core: verifyRulepackSignature with real ephemeral Ed25519 keys
 *     (valid → true, tampered body → false, missing sig → false)
 *   - wiring: refreshRemoteRulepack with mocked fetch + chrome.storage
 *     (valid sig → applied; tampered → bad_signature + NOT applied)
 *
 * Runs under `node --test` (Node's webcrypto supports Ed25519, same API MV3
 * service workers expose).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyRulepackSignature,
  refreshRemoteRulepack,
  signatureEnforced,
} from '../src/lib/rulepack.js';

// --- helpers: real ephemeral Ed25519 keypair + detached signing -------------
function bytesToB64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function makeKeypair() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { privateKey: kp.privateKey, pubB64: bytesToB64(rawPub) };
}

async function signDetached(privateKey, text) {
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(text)),
  );
  return bytesToB64(sig);
}

const PACK = JSON.stringify({
  schemaVersion: 2,
  updatedAt: '2026-07-05',
  sites: [{ id: 'x', match: ['*://x.com/*'] }],
});

// --- mock chrome.storage + fetch for the wiring tests -----------------------
function installMocks({ packBody, sigBody, packOk = true, sigOk = true }) {
  const applied = { value: null };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}), // no user override → default URL
        set: async (obj) => { applied.value = obj; },
      },
    },
  };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('.sig')) {
      return { ok: sigOk, status: sigOk ? 200 : 404, text: async () => sigBody };
    }
    return { ok: packOk, status: packOk ? 200 : 500, text: async () => packBody };
  };
  return applied;
}

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.fetch;
});

// ---------------------------------------------------------------------------
describe('F-085 R2 · verifyRulepackSignature (crypto core)', () => {
  it('accepts a valid detached signature over the exact bytes', async () => {
    const { privateKey, pubB64 } = await makeKeypair();
    const sig = await signDetached(privateKey, PACK);
    assert.equal(await verifyRulepackSignature(PACK, sig, pubB64), true);
  });

  it('rejects when the body is tampered (sig no longer covers it)', async () => {
    const { privateKey, pubB64 } = await makeKeypair();
    const sig = await signDetached(privateKey, PACK);
    const tampered = PACK.replace('x.com', 'evil.com'); // attacker changes a selector target
    assert.equal(await verifyRulepackSignature(tampered, sig, pubB64), false);
  });

  it('rejects a missing signature', async () => {
    const { pubB64 } = await makeKeypair();
    assert.equal(await verifyRulepackSignature(PACK, '', pubB64), false);
  });

  it('rejects when signed by a different (untrusted) key', async () => {
    const attacker = await makeKeypair();
    const trusted = await makeKeypair();
    const sig = await signDetached(attacker.privateKey, PACK);
    assert.equal(await verifyRulepackSignature(PACK, sig, trusted.pubB64), false);
  });

  it('never throws on garbage input → false', async () => {
    assert.equal(await verifyRulepackSignature(PACK, 'not-base64!!!', 'also-bad'), false);
    assert.equal(await verifyRulepackSignature(null, 'x', 'y'), false);
  });
});

describe('F-085 R2 · signatureEnforced', () => {
  it('OFF when no key embedded, ON once a key is present', () => {
    assert.equal(signatureEnforced(''), false);
    assert.equal(signatureEnforced('AAAA'), true);
  });
});

describe('F-085 R2 · refreshRemoteRulepack verify-before-apply', () => {
  it('applies a correctly-signed remote pack', async () => {
    const { privateKey, pubB64 } = await makeKeypair();
    const sig = await signDetached(privateKey, PACK);
    const applied = installMocks({ packBody: PACK, sigBody: sig });

    const out = await refreshRemoteRulepack({ publicKey: pubB64 });
    assert.equal(out.updated, true);
    assert.ok(applied.value, 'pack must be written to storage');
    const written = Object.values(applied.value)[0]; // keyed by STORAGE.rulepack
    assert.equal(written.sites[0].id, 'x');
  });

  it('REJECTS a tampered pack and does NOT apply it (fallback to bundled)', async () => {
    const { privateKey, pubB64 } = await makeKeypair();
    const sig = await signDetached(privateKey, PACK);
    const tampered = PACK.replace('x.com', 'evil.com');
    const applied = installMocks({ packBody: tampered, sigBody: sig });

    const out = await refreshRemoteRulepack({ publicKey: pubB64 });
    assert.equal(out.updated, false);
    assert.equal(out.reason, 'bad_signature');
    assert.equal(applied.value, null, 'a poisoned pack must never be written');
  });

  it('REJECTS an unsigned pack when enforcement is on', async () => {
    const { pubB64 } = await makeKeypair();
    const applied = installMocks({ packBody: PACK, sigBody: '', sigOk: false });

    const out = await refreshRemoteRulepack({ publicKey: pubB64 });
    assert.equal(out.updated, false);
    assert.equal(out.reason, 'bad_signature');
    assert.equal(applied.value, null);
  });

  it('without a trust key (dev default) applies by shape only — no regression', async () => {
    const applied = installMocks({ packBody: PACK, sigBody: '' });
    const out = await refreshRemoteRulepack(); // no publicKey, embedded const is ''
    assert.equal(out.updated, true);
    assert.ok(applied.value);
  });
});
