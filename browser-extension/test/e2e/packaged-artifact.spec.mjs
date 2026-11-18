/**
 * L4 · E2E — the PACKAGED artifact boots in a real Chromium.
 *
 * Every other spec loads the source tree. A store upload ships the zip, so this
 * one runs the real packager, checks the file set, and loads the generated
 * `dist/awareness-memory-<version>/` directory as an unpacked extension.
 *
 * It proves: manifest version, popup version + connect CTA, side-panel page,
 * minimal permissions, and that dev-only files never made it into the artifact.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithExtension, closeContext } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, '..', '..');

let ctx;
let version;
let unpacked;

test.beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: EXT_ROOT, stdio: 'ignore' });
  version = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf-8')).version;
  unpacked = path.join(EXT_ROOT, 'dist', `awareness-memory-${version}`);
  // mode:null → keep the shipped default (cloud, not connected).
  ctx = await launchWithExtension(unpacked, { mode: null });
});

test.afterAll(async () => {
  await closeContext(ctx);
});

test('zip + unpacked artifact contain runtime files only', () => {
  const zip = path.join(EXT_ROOT, 'dist', `awareness-memory-${version}.zip`);
  expect(fs.existsSync(zip)).toBe(true);
  expect(fs.statSync(zip).size).toBeGreaterThan(10_000);

  for (const forbidden of ['test', 'node_modules', 'scripts', 'package.json', 'package-lock.json', 'playwright.config.mjs']) {
    expect(fs.existsSync(path.join(unpacked, forbidden)), `${forbidden} must not ship`).toBe(false);
  }
  for (const required of ['manifest.json', 'src/sw.js', 'src/content.js', 'src/popup/popup.html', 'src/sidepanel/sidepanel.html', 'rules/default-rulepack.json', 'icons/icon-128.png']) {
    expect(fs.existsSync(path.join(unpacked, ...required.split('/'))), `${required} missing`).toBe(true);
  }
});

test('packaged manifest is minimal and versioned', async () => {
  const [sw] = ctx.context.serviceWorkers();
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());

  expect(manifest.version).toBe(version);
  expect(manifest.permissions.sort()).toEqual(
    ['activeTab', 'alarms', 'identity', 'sidePanel', 'storage'].sort()
  );
  expect(manifest.host_permissions.join(' ')).toContain('https://awareness.market/*');
  expect(manifest.host_permissions.join(' ')).toContain('http://127.0.0.1:37800/*');
  expect(manifest.side_panel.default_path).toBe('src/sidepanel/sidepanel.html');
});

test('popup and side panel render from the packaged build', async () => {
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/src/popup/popup.html`);
  await expect(popup.locator('#version')).toHaveText(`v${version}`, { timeout: 15_000 });
  // Fresh install, cloud mode, no grant yet → the connect CTA is shown.
  await expect(popup.locator('#connect')).toBeVisible({ timeout: 15_000 });
  await expect(popup.locator('#login')).toHaveText(/连接 Awareness|重新连接/);
  await popup.close();

  const panel = await ctx.context.newPage();
  await panel.goto(`chrome-extension://${ctx.extensionId}/src/sidepanel/sidepanel.html`);
  await expect(panel.locator('h1')).toHaveText('Awareness', { timeout: 15_000 });
  await expect(panel.locator('#connect')).toBeVisible({ timeout: 15_000 });
  await panel.close();
});
