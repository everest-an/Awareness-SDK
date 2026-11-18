/**
 * Cloud OAuth (PKCE) + credential lifecycle — service worker only.
 *
 * Reuses the F-084 authorization server (RFC 7591 DCR + S256 PKCE + the
 * `/authorize` consent page) and registers as a `browser_extension` client so
 * the token response also carries the grant's dedicated `aw_` key. That key is
 * what the REST client (`cloud-client.js`) uses; the `awmcp_` bearer is only
 * meaningful inside the MCP process.
 *
 * Nothing here is importable by the content script: the manifest's SW is the
 * only runtime that holds `identity` + the stored key.
 */
import { CLOUD_DEFAULT_BASE, CLOUD_OAUTH, STORAGE, cloudPaths } from './config.js';

const NET_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Small pure helpers (exported for tests).
// ---------------------------------------------------------------------------

export function base64UrlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function computeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Build the consent URL for `chrome.identity.launchWebAuthFlow`. */
export function buildAuthorizeUrl({ base, clientId, redirectUri, challenge, state }) {
  const paths = cloudPaths(base);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: CLOUD_OAUTH.scope,
    resource: CLOUD_OAUTH.resource,
  });
  return `${paths.authorize}?${params.toString()}`;
}

/** Parse the chromiumapp redirect URL into { code, state } or an error code. */
export function parseRedirect(redirectUrl) {
  let url;
  try {
    url = new URL(redirectUrl);
  } catch {
    return { error: 'bad_redirect' };
  }
  const params = url.searchParams;
  if (params.get('error')) {
    return { error: params.get('error'), description: params.get('error_description') || '' };
  }
  const code = params.get('code');
  if (!code) return { error: 'missing_code' };
  return { code, state: params.get('state') || '' };
}

// ---------------------------------------------------------------------------
// Storage helpers.
// ---------------------------------------------------------------------------

export async function getCloudBase() {
  const got = await chrome.storage.local.get(STORAGE.cloudBase);
  return String(got[STORAGE.cloudBase] || CLOUD_DEFAULT_BASE).replace(/\/+$/, '');
}

export async function setCloudBase(base) {
  const normalized = String(base || CLOUD_DEFAULT_BASE).replace(/\/+$/, '');
  await chrome.storage.local.set({ [STORAGE.cloudBase]: normalized });
  return normalized;
}

export async function getAuth() {
  const got = await chrome.storage.local.get(STORAGE.cloudAuth);
  const auth = got[STORAGE.cloudAuth];
  if (!auth || !auth.apiKey || !auth.memoryId) return null;
  return auth;
}

export async function isReauthRequired() {
  const got = await chrome.storage.local.get(STORAGE.cloudReauth);
  return !!got[STORAGE.cloudReauth];
}

export async function markReauthRequired(required) {
  await chrome.storage.local.set({ [STORAGE.cloudReauth]: !!required });
}

/** Public-safe account view for popup/side panel (never the full key). */
export async function getAccountView() {
  const auth = await getAuth();
  if (!auth) return null;
  return {
    memoryId: auth.memoryId,
    memoryName: auth.memoryName || '',
    keyPrefix: auth.keyPrefix || (auth.apiKey ? auth.apiKey.slice(0, 8) : ''),
    base: auth.base || CLOUD_DEFAULT_BASE,
    connectedAt: auth.connectedAt || 0,
    reauthRequired: await isReauthRequired(),
  };
}

async function saveAuth(auth) {
  const keyPrefix = auth.apiKey ? auth.apiKey.slice(0, 8) : '';
  await chrome.storage.local.set({
    [STORAGE.cloudAuth]: { ...auth, keyPrefix, connectedAt: Date.now() },
    [STORAGE.cloudReauth]: false,
  });
}

export async function logout() {
  await chrome.storage.local.remove([STORAGE.cloudAuth, STORAGE.cloudReauth]);
}

// ---------------------------------------------------------------------------
// Network (extension origin).
// ---------------------------------------------------------------------------

async function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NET_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Ensure this install has a DCR client for the current base + redirect URI. */
async function ensureClient(base, redirectUri) {
  const got = await chrome.storage.local.get(STORAGE.cloudClient);
  const all = got[STORAGE.cloudClient] || {};
  const cached = all[base];
  if (cached?.client_id && cached.redirect_uri === redirectUri) return cached.client_id;

  let res;
  try {
    res = await timedFetch(`${base}${CLOUD_OAUTH.registerPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        client_name: CLOUD_OAUTH.clientName,
        client_kind: CLOUD_OAUTH.clientKind,
        scope: CLOUD_OAUTH.scope,
      }),
    });
  } catch (err) {
    throw new AuthError('registration_failed', err?.name === 'AbortError' ? 'timeout' : 'network_error');
  }
  if (!res.ok) throw new AuthError('registration_failed', `http_${res.status}`);

  const data = await res.json().catch(() => null);
  const clientId = data?.client_id;
  if (!clientId) throw new AuthError('registration_failed', 'missing_client_id');

  all[base] = { client_id: clientId, redirect_uri: redirectUri, registered_at: Date.now() };
  await chrome.storage.local.set({ [STORAGE.cloudClient]: all });
  return clientId;
}

export class AuthError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Login / logout.
// ---------------------------------------------------------------------------

/**
 * Run the whole OAuth dance and persist the grant.
 * @returns {Promise<{ok:boolean, account?:object, error?:string, detail?:string}>}
 */
export async function login() {
  try {
    const base = await getCloudBase();
    const redirectUri = chrome.identity.getRedirectURL('oauth');
    const clientId = await ensureClient(base, redirectUri);

    const verifier = randomToken(48);
    const challenge = await computeChallenge(verifier);
    const state = randomToken(16);

    const authUrl = buildAuthorizeUrl({ base, clientId, redirectUri, challenge, state });

    let redirected;
    try {
      redirected = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    } catch (err) {
      const msg = String(err?.message || err);
      if (/did not approve|cancel|closed/i.test(msg)) throw new AuthError('auth_cancelled');
      throw new AuthError('auth_failed', msg);
    }
    if (!redirected) throw new AuthError('auth_cancelled');

    const parsed = parseRedirect(redirected);
    if (parsed.error) throw new AuthError(parsed.error === 'access_denied' ? 'auth_cancelled' : 'auth_failed', parsed.error);
    if (parsed.state !== state) throw new AuthError('state_mismatch');

    let res;
    try {
      res = await timedFetch(`${base}${CLOUD_OAUTH.tokenPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: parsed.code,
          code_verifier: verifier,
          client_id: clientId,
          redirect_uri: redirectUri,
          resource: CLOUD_OAUTH.resource,
        }).toString(),
      });
    } catch (err) {
      throw new AuthError('token_failed', err?.name === 'AbortError' ? 'timeout' : 'network_error');
    }

    const body = await res.json().catch(() => null);
    if (!res.ok) throw new AuthError('token_failed', body?.error || `http_${res.status}`);

    // A server that predates F-109 returns only the MCP bearer. Fail loudly
    // instead of storing a credential the REST client cannot use.
    if (!body?.api_key || !body?.memory_id) {
      throw new AuthError('not_extension_client', 'token response has no api_key/memory_id');
    }

    const memoryName = await fetchMemoryName(base, body.api_key, body.memory_id);
    await saveAuth({
      base,
      apiKey: body.api_key,
      memoryId: body.memory_id,
      memoryName,
    });
    await chrome.storage.local.set({ [STORAGE.mode]: 'cloud' });
    return { ok: true, account: await getAccountView() };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: err.code, detail: err.detail };
    return { ok: false, error: 'auth_failed', detail: String(err?.message || err) };
  }
}

/** Best-effort memory name for the popup; a failure must not fail the login. */
async function fetchMemoryName(base, apiKey, memoryId) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${cloudPaths(base).memory(memoryId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return '';
    const data = await res.json().catch(() => null);
    return data?.name || '';
  } catch {
    return '';
  }
}
