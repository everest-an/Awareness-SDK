/**
 * L4 · E2E — F-111 page save: the pill saves the page the user clicked on.
 *
 * Real extension, real Chromium, real local HTTP (no `page.route`, no HAR).
 * The cloud is a real server that records the request body; only the OAuth grant
 * is seeded into storage (the interactive consent window cannot be driven
 * headlessly — covered by the backend suite + auth-pkce tests).
 *
 * What this proves:
 *   1. Turning the site on registers the content script → the pill appears.
 *   2. Nothing is captured until the user clicks 保存 (no background capture).
 *   3. The write carries source=web_page + the source URL + the article text.
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { buildTestExtension, launchWithExtension, closeContext, removeDir } from './helpers.mjs';

const ARTICLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Durable capture notes</title></head>
<body>
  <nav>site nav (must not be captured)</nav>
  <article>
    <h1>Durable capture notes</h1>
    <p>Cloud captures belong in Postgres so a browser restart cannot lose them.</p>
    <p>Recall reads from the same store the capture wrote to.</p>
  </article>
  <footer>footer noise</footer>
</body></html>`;

let server;
let origin;
let ctx;
let extPath;
const captured = [];

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(raw));
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/article') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ARTICLE_HTML);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/memories/mem_1/content') {
      const raw = await readBody(req);
      captured.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      json(res, 201, { status: 'success' });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  extPath = buildTestExtension(origin);
  ctx = await launchWithExtension(extPath, { mode: null });

  const page = await ctx.context.newPage();
  await page.goto(`chrome-extension://${ctx.extensionId}/src/popup/popup.html`);
  await page.evaluate(async (base) => {
    await chrome.storage.local.set({
      connection_mode: 'cloud',
      cloud_base: base,
      cloud_auth: { apiKey: 'aw_e2e_key', memoryId: 'mem_1', memoryName: 'E2E Memory', base },
      cloud_reauth_required: false,
    });
    await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'cloud' }, resolve));
    // The test build already holds the fixture host permission, so enabling the
    // long-term icon does not need a permission prompt here.
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'PAGE_SITE_ENABLE', origin: base }, resolve);
    });
  }, origin);
  await page.close();
});

test.afterAll(async () => {
  await closeContext(ctx);
  removeDir(extPath);
  await new Promise((resolve) => server?.close(resolve));
});

test('the pill is present and captures nothing until the user saves', async () => {
  const page = await ctx.context.newPage();
  await page.goto(`${origin}/article`);

  await expect(page.locator('.aw-save')).toBeVisible({ timeout: 15_000 });

  // No background capture: waiting must not produce a write.
  await page.waitForTimeout(1500);
  expect(captured.length).toBe(0);

  await page.locator('.aw-save').click();
  await expect(page.locator('.aw-card')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.aw-preview')).toContainText('Postgres');

  await page.locator('[data-act="save"]').click();

  await expect.poll(() => captured.length, { timeout: 15_000, intervals: [300, 500, 800] }).toBe(1);
  const record = captured[0];
  expect(record.auth).toBe('Bearer aw_e2e_key');
  expect(record.body.kwargs.source).toBe('web_page');
  expect(record.body.kwargs.url).toBe(`${origin}/article`);
  expect(record.body.kwargs.title).toContain('Durable capture notes');
  expect(record.body.content).toContain('Postgres so a browser restart cannot lose them');
  // The extractor prefers <article>, so page chrome must not leak in.
  expect(record.body.content).not.toContain('site nav (must not be captured)');

  await page.close();
});
