/**
 * L2 · OAuth PKCE helpers (pure) — RFC 7636 vector + redirect parsing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  base64UrlEncode,
  computeChallenge,
  buildAuthorizeUrl,
  parseRedirect,
  randomToken,
} from '../src/lib/auth.js';

// RFC 7636 Appendix B test vector.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

test('computeChallenge matches RFC 7636 S256 vector', async () => {
  assert.equal(await computeChallenge(VERIFIER), CHALLENGE);
});

test('base64UrlEncode is unpadded and URL-safe', () => {
  const encoded = base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]));
  assert.equal(encoded, '-__-');
  assert.ok(!encoded.includes('='));
});

test('randomToken produces unique URL-safe verifiers in the PKCE range', () => {
  const a = randomToken(48);
  const b = randomToken(48);
  assert.notEqual(a, b);
  assert.ok(a.length >= 43 && a.length <= 128);
  assert.match(a, /^[A-Za-z0-9\-._~]+$/);
});

test('buildAuthorizeUrl carries every mandatory OAuth param', () => {
  const url = new URL(buildAuthorizeUrl({
    base: 'https://awareness.market',
    clientId: 'awmci_client',
    redirectUri: 'https://abc.chromiumapp.org/oauth',
    challenge: CHALLENGE,
    state: 'state_1',
  }));

  assert.equal(url.origin + url.pathname, 'https://awareness.market/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'awmci_client');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://abc.chromiumapp.org/oauth');
  assert.equal(url.searchParams.get('code_challenge'), CHALLENGE);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state_1');
  assert.equal(url.searchParams.get('resource'), 'https://awareness.market/mcp');
  assert.equal(url.searchParams.get('scope'), 'awareness.recall awareness.record');
});

test('buildAuthorizeUrl honors a staging base URL', () => {
  const url = new URL(buildAuthorizeUrl({
    base: 'https://staging.awareness.market',
    clientId: 'c', redirectUri: 'r', challenge: 'x', state: 's',
  }));
  assert.equal(url.origin + url.pathname, 'https://staging.awareness.market/authorize');
});

test('parseRedirect extracts code + state', () => {
  const out = parseRedirect('https://abc.chromiumapp.org/oauth?code=awmcc_123&state=s1');
  assert.deepEqual(out, { code: 'awmcc_123', state: 's1' });
});

test('parseRedirect surfaces OAuth errors', () => {
  const out = parseRedirect('https://abc.chromiumapp.org/oauth?error=access_denied&state=s1');
  assert.equal(out.error, 'access_denied');
  assert.equal(out.state, undefined);
});

test('parseRedirect rejects a malformed or code-less redirect', () => {
  assert.equal(parseRedirect('not a url').error, 'bad_redirect');
  assert.equal(parseRedirect('https://abc.chromiumapp.org/oauth?state=s1').error, 'missing_code');
});
