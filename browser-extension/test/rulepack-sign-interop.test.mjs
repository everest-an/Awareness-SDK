/**
 * F-085 (T4) · Publish↔verify interop.
 *
 * Proves the signing CLI's node:crypto Ed25519 signatures verify under the
 * extension's Web Crypto `verifyRulepackSignature`. If these two ever diverge
 * (different algo, key encoding, or byte handling), a legitimately-signed pack
 * would be rejected in the field — this test is the guard against that.
 *
 * Mirrors exactly what scripts/sign-rulepack.mjs does: raw public key via jwk.x,
 * detached signature over the exact pack bytes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { verifyRulepackSignature } from '../src/lib/rulepack.js';

const PACK = JSON.stringify({
  schemaVersion: 2,
  updatedAt: '2026-07-05',
  sites: [{ id: 'x', match: ['*://x.com/*'] }],
});

function publishSide() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  const pubB64 = Buffer.from(jwk.x, 'base64url').toString('base64');
  const sigB64 = crypto.sign(null, Buffer.from(PACK, 'utf8'), privateKey).toString('base64');
  return { pubB64, sigB64 };
}

describe('F-085 T4 · sign-rulepack (node:crypto) ↔ verifyRulepackSignature (Web Crypto)', () => {
  it('a CLI-signed pack verifies in the extension', async () => {
    const { pubB64, sigB64 } = publishSide();
    assert.equal(await verifyRulepackSignature(PACK, sigB64, pubB64), true);
  });

  it('any byte change breaks verification', async () => {
    const { pubB64, sigB64 } = publishSide();
    assert.equal(await verifyRulepackSignature(PACK + ' ', sigB64, pubB64), false);
    assert.equal(await verifyRulepackSignature(PACK.replace('x.com', 'evil.com'), sigB64, pubB64), false);
  });

  it('a signature from a different key is rejected', async () => {
    const a = publishSide();
    const b = publishSide();
    assert.equal(await verifyRulepackSignature(PACK, a.sigB64, b.pubB64), false);
  });
});
