/**
 * Rule-pack loader (remote-updatable, MV3-compliant).
 *
 * MV3 red line: remote CODE is banned, but remote DATA (inert JSON) is allowed
 * and Chrome docs explicitly endorse remote config for feature flags. So the
 * selector rule-pack is fetched as INERT JSON — never eval'd, never imported as
 * a module, never turned into a Function. Selectors are only ever passed to
 * `document.querySelector`. If the remote is unavailable or malformed, we fall
 * back to the bundled default shipped in the extension.
 *
 * Hardening: an optional remote URL is user-configured; we validate the parsed
 * shape (schemaVersion + sites[]) before swapping. We do NOT trust arbitrary
 * fields — anything that looks like code is ignored by construction (we only
 * read known string/array selector fields downstream).
 */
import { STORAGE, DEFAULT_RULEPACK_URL } from './config.js';

/** Load the bundled default rule-pack that ships inside the extension. */
export async function loadBundledRulepack() {
  const url = chrome.runtime.getURL('rules/default-rulepack.json');
  const res = await fetch(url);
  return res.json();
}

/** Shallow structural validation — reject anything that isn't a v2 rule-pack. */
export function isValidRulepack(obj) {
  return !!obj
    && typeof obj === 'object'
    && Number(obj.schemaVersion) >= 2
    && Array.isArray(obj.sites)
    && obj.sites.every((s) => s && typeof s.id === 'string' && Array.isArray(s.match));
}

/**
 * Return the active rule-pack: cached (possibly remote-updated) if valid, else
 * the bundled default. Never throws.
 */
export async function getActiveRulepack() {
  try {
    const got = await chrome.storage.local.get(STORAGE.rulepack);
    const cached = got[STORAGE.rulepack];
    if (isValidRulepack(cached)) return cached;
  } catch { /* fall through to bundled */ }
  return loadBundledRulepack();
}

/**
 * Resolve which remote URL to fetch from the user-configured storage value.
 * Pure (no chrome.*), so the hot-update semantics are unit-testable:
 *   - undefined / null / '' (never set, or cleared) → canonical DEFAULT_RULEPACK_URL,
 *     so hot-update works out of the box AND clearing the popup reverts to default.
 *   - '<url>' (user override)                        → that URL takes precedence.
 * Any non-string junk falls back to the default rather than crashing.
 */
export function resolveRulepackUrl(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim();
  return DEFAULT_RULEPACK_URL;
}

/**
 * Fetch a remote rule-pack (inert JSON) and cache it if valid. Called from the
 * rulepack alarm. Uses DEFAULT_RULEPACK_URL out of the box; a user may override
 * it via the popup, or clear the field to revert to the default. Silently no-ops
 * when fetch fails — bundled default keeps working (FM: remote unavailable → fallback).
 */
export async function refreshRemoteRulepack() {
  const got = await chrome.storage.local.get(STORAGE.rulepackUrl);
  const url = resolveRulepackUrl(got[STORAGE.rulepackUrl]);
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return { updated: false, reason: `http_${res.status}` };
    const json = await res.json(); // inert data only — never executed
    if (!isValidRulepack(json)) return { updated: false, reason: 'invalid_shape' };
    await chrome.storage.local.set({ [STORAGE.rulepack]: json });
    return { updated: true, updatedAt: json.updatedAt };
  } catch {
    return { updated: false, reason: 'fetch_failed' };
  }
}

/** Find the site rule whose match globs cover the given URL. */
export function matchSite(rulepack, urlStr) {
  if (!rulepack || !Array.isArray(rulepack.sites)) return null;
  let host, pathname;
  try {
    const u = new URL(urlStr);
    host = u.host;
    pathname = u.pathname;
  } catch {
    return null;
  }
  for (const site of rulepack.sites) {
    for (const glob of site.match) {
      if (globMatches(glob, host, pathname)) return site;
    }
  }
  return null;
}

/** Minimal glob matcher for `*://host/path*` patterns (no code, pure string). */
function globMatches(glob, host, pathname) {
  // Strip scheme portion `*://` or `https://`.
  const withoutScheme = glob.replace(/^\*:\/\//, '').replace(/^https?:\/\//, '');
  const slash = withoutScheme.indexOf('/');
  const hostPart = slash === -1 ? withoutScheme : withoutScheme.slice(0, slash);
  const pathPart = slash === -1 ? '/*' : withoutScheme.slice(slash);
  const hostRe = new RegExp('^' + escapeGlob(hostPart) + '$');
  const pathRe = new RegExp('^' + escapeGlob(pathPart));
  return hostRe.test(host) && pathRe.test(pathname);
}

function escapeGlob(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
}
