/**
 * L4 · E2E — Cloud mode: capture → cloud write → recall → inject (zero mock).
 *
 * The extension is real, Chromium is real, and the cloud is a REAL local HTTP
 * server (no `page.route`, no HAR). Only the OAuth *grant* is seeded into
 * chrome.storage — the interactive consent window cannot be driven headlessly,
 * and the PKCE/token contract is covered by `test/auth-pkce.test.mjs` plus the
 * backend suite.
 *
 * What this proves:
 *   1. content.js scrapes a finished turn and the SW writes it to the cloud
 *      endpoint with the OAuth `aw_` key (not the local daemon).
 *   2. The write is idempotent (message_id present).
 *   3. "找相关记忆" calls the cloud retrieve endpoint and injects the returned
 *      markdown into the site composer.
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestExtension, launchWithExtension, closeContext, removeDir } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTION = 'Where should cloud captures be stored for durability?';

let server;
let origin;
let ctx;
let extPath;
const captured = [];   // { auth, body, at }
let retrieveCalls = 0;

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
  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'deepseek.html'), 'utf-8');

  server = http.createServer(async (req, res) => {
    // Chat fixture (content script target).
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    // Cloud write.
    if (req.method === 'POST' && req.url === '/api/v1/memories/mem_1/content') {
      const raw = await readBody(req);
      captured.push({ auth: req.headers.authorization, body: JSON.parse(raw), at: Date.now() });
      json(res, 201, { status: 'success' });
      return;
    }
    // Cloud retrieve.
    if (req.method === 'POST' && req.url === '/api/v1/memories/mem_1/retrieve') {
      retrieveCalls += 1;
      json(res, 200, {
        results: [{ title: 'Durability decision', content: 'Use Postgres for durable capture storage.' }],
      });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  extPath = buildTestExtension(origin);
  // mode:null → leave the extension in its default cloud mode.
  ctx = await launchWithExtension(extPath, { mode: null });

  // Seed the OAuth grant, then drive the real SET_MODE message so the SW
  // recomputes its connection state (no storage poking of the SW cache).
  const page = await ctx.context.newPage();
  await page.goto(`chrome-extension://${ctx.extensionId}/src/popup/popup.html`);
  await page.evaluate(async (base) => {
    await chrome.storage.local.set({
      connection_mode: 'cloud',
      cloud_base: base,
      cloud_auth: { apiKey: 'aw_e2e_key', memoryId: 'mem_1', memoryName: 'E2E Memory', base },
      cloud_reauth_required: false,
    });
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SET_MODE', mode: 'cloud' }, resolve);
    });
  }, origin);
  await page.close();
});

test.afterAll(async () => {
  await closeContext(ctx);
  removeDir(extPath);
  await new Promise((resolve) => server?.close(resolve));
});

test('captures a finished turn into the cloud with the OAuth key', async () => {
  const page = await ctx.context.newPage();
  await page.goto(origin);
  await expect(page.locator('.aw-pill')).toBeVisible({ timeout: 15_000 });

  await page.locator('#chat-input').fill(QUESTION);
  await page.locator('#send-btn').click();
  await expect(page.locator('.ds-message-feedback-container')).toBeVisible({ timeout: 5_000 });

  await expect.poll(() => captured.length, { timeout: 15_000, intervals: [300, 500, 800] }).toBe(1);

  const record = captured[0];
  expect(record.auth).toBe('Bearer aw_e2e_key');
  expect(record.body.content).toContain(`Q: ${QUESTION}`);
  expect(record.body.content).toContain('A:');
  expect(record.body.message_id).toMatch(/^ext:mem_1:[0-9a-f]{40}$/);
  expect(record.body.kwargs.site).toBe('deepseek');

  // The same turn must not be written twice when the DOM re-renders.
  await page.waitForTimeout(1200);
  expect(captured.length).toBe(1);

  await page.close();
});

test('"找相关记忆" retrieves from the cloud and injects the markdown', async () => {
  const page = await ctx.context.newPage();
  await page.goto(origin);
  await expect(page.locator('.aw-pill')).toBeVisible({ timeout: 15_000 });

  await page.locator('.aw-pill').click();
  await expect(page.locator('.aw-bar')).toBeVisible({ timeout: 5_000 });

  await page.locator('#chat-input').fill('durable capture storage');
  await page.locator('.aw-find').click();

  await expect(page.locator('.aw-panel')).toBeVisible({ timeout: 15_000 });
  expect(retrieveCalls).toBeGreaterThan(0);
  await expect(page.locator('.aw-panel pre')).toContainText('Postgres');

  await page.locator('.aw-inject').click();
  await expect(page.locator('#chat-input')).toHaveValue(/Postgres for durable capture storage/);

  await page.close();
});
