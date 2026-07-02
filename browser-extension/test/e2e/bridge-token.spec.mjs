/**
 * L4 · E2E — Bridge token bootstrap (zero mock).
 *
 * Loads the UNPACKED extension into a real Chromium persistent context against a
 * REAL Awareness daemon on 37800. Asserts the service worker mints a bridge
 * token on install and that the token is actually valid against the live daemon
 * (`GET /api/v1/bridge/token` → has_token:true). Then opens the real popup page
 * and asserts it renders the connected state.
 *
 * No `page.route`, no HAR — the daemon is 100% real. The only non-production
 * surface is that the extension is loaded unpacked from a temp copy.
 */
import { test, expect } from '@playwright/test';
import {
  startDaemon,
  buildTestExtension,
  launchWithExtension,
  DAEMON_PORT,
} from './helpers.mjs';
import fs from 'node:fs';

let daemon;
let extPath;
let ctx;

test.beforeAll(async () => {
  daemon = await startDaemon();
  // A token bootstrap needs no fixture origin; reuse the build helper with a
  // throwaway origin so the extension is a self-contained temp copy.
  extPath = buildTestExtension('http://127.0.0.1:1');
});

test.afterAll(async () => {
  try { await ctx?.context?.close(); } catch { /* ignore */ }
  try { fs.rmSync(extPath, { recursive: true, force: true }); } catch { /* ignore */ }
  await daemon?.stop();
});

test('service worker mints a valid bridge token against the real daemon', async () => {
  ctx = await launchWithExtension(extPath);
  const { context, extensionId } = ctx;

  // Give the SW's onInstalled bootstrap (ping → ensureToken) time to mint.
  // Poll the REAL daemon until it reports a token exists — no arbitrary sleep.
  const tokenUrl = `http://127.0.0.1:${DAEMON_PORT}/api/v1/bridge/token`;
  await expect
    .poll(async () => {
      const res = await fetch(tokenUrl);
      if (!res.ok) return false;
      const body = await res.json();
      return body.has_token === true && body.count >= 1;
    }, { timeout: 20_000, intervals: [300, 500, 800] })
    .toBe(true);

  // The extension must have persisted a token that looks like a real one.
  const [sw] = context.serviceWorkers();
  const stored = await sw.evaluate(async () => {
    const { bridge_token } = await chrome.storage.local.get('bridge_token');
    return bridge_token || null;
  });
  expect(stored).toMatch(/^brg_[0-9a-f]{48}$/);

  // The popup renders the connected state (dot .on, offline note hidden).
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(popup.locator('#conn-dot')).toHaveClass(/on/, { timeout: 15_000 });
  await expect(popup.locator('#offline-note')).toHaveClass(/hidden/);
  await popup.close();
});
