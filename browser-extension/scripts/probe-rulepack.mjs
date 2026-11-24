/**
 * Rule-pack health probe — does each supported site still match?
 *
 * Site DOMs change without notice: Doubao replaced its <textarea> composer with
 * a contenteditable rich editor in 2026 and the extension silently stopped
 * mounting there. This probe loads each supported site in a real Chromium and
 * checks the bundled rule-pack selectors against the live DOM, so a rename is
 * caught the day it ships instead of by a user.
 *
 * Usage:
 *   node scripts/probe-rulepack.mjs                # all sites
 *   SITES=doubao,kimi node scripts/probe-rulepack.mjs
 *
 * Exit codes: 0 = every reachable site has a composer, 1 = a reachable site has
 * none (rule-pack regression). Sites behind a login wall are reported as `skip`;
 * they must be verified with a logged-in profile by hand.
 *
 * Output is JSON per site. `chatgpt` / `gemini` need international network
 * access; without it they report `skip` (navigation error), not a failure.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, '..');
const rulepack = JSON.parse(
  fs.readFileSync(path.join(EXT_ROOT, 'rules', 'default-rulepack.json'), 'utf-8')
);

const URLS = {
  chatgpt: 'https://chatgpt.com/',
  deepseek: 'https://chat.deepseek.com/',
  doubao: 'https://www.doubao.com/chat/',
  kimi: 'https://www.kimi.com/',
  gemini: 'https://gemini.google.com/app',
};

const wanted = (process.env.SITES || Object.keys(URLS).join(',')).split(',').map((s) => s.trim());

/** Same candidate order the content script uses (primary + fallbacks). */
function composerCandidates(input) {
  const out = [];
  if (typeof input?.selector === 'string' && input.selector) out.push(input.selector);
  for (const fb of (Array.isArray(input?.fallbacks) ? input.fallbacks : [])) {
    if (typeof fb === 'string' && fb) out.push(fb);
    else if (fb && typeof fb.selector === 'string' && fb.selector) out.push(fb.selector);
  }
  return out;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  locale: 'en-US',
  viewport: { width: 1280, height: 900 },
});

let missing = 0;

for (const id of wanted) {
  const site = rulepack.sites.find((s) => s.id === id);
  if (!site) {
    console.log(JSON.stringify({ id, verdict: 'skip', reason: 'not_in_rulepack' }));
    continue;
  }

  const page = await context.newPage();
  const row = { id, url: URLS[id] };
  try {
    const resp = await page.goto(URLS[id], { waitUntil: 'domcontentloaded', timeout: 45000 });
    row.httpStatus = resp?.status();
    await page.waitForTimeout(7000);
    row.finalUrl = page.url();

    const composed = composerCandidates(site.input);
    row.composer = await page.evaluate((selectors) => {
      const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch { return -1; } };
      return selectors.map((sel) => ({ sel, n: count(sel) }));
    }, composed);

    const matches = row.composer.some((c) => c.n > 0);
    const loginWall = /sign_?in|login|passport/i.test(page.url());
    if (matches) {
      row.verdict = 'ok';
    } else if (loginWall) {
      row.verdict = 'skip';
      row.reason = 'login_wall';
    } else {
      row.verdict = 'missing';
      missing += 1;
    }
  } catch (err) {
    row.verdict = 'skip';
    row.reason = `nav_error: ${String(err && err.message ? err.message : err).slice(0, 120)}`;
  }
  console.log(JSON.stringify(row));
  await page.close();
}

await browser.close();
process.exit(missing > 0 ? 1 : 0);
