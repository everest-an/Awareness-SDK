/**
 * Shared harness for the extension E2E specs.
 *
 * Provides: spawn a real daemon on 37800, build a test copy of the extension
 * (manifest + rule-pack patched so the content script also injects on the local
 * DeepSeek fixture origin), start a static fixture server, and launch a
 * Chromium persistent context with the extension loaded.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXT_ROOT = path.resolve(__dirname, '..', '..');           // sdks/browser-extension
const DAEMON_BIN = path.resolve(EXT_ROOT, '..', 'local', 'bin', 'awareness-local.mjs');
export const DAEMON_PORT = 37800; // extension hard-codes this in src/lib/config.js

/** Poll a URL until it responds 200 or times out. */
async function waitForHttp(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`daemon did not become healthy at ${url}`);
}

/** Spawn a real daemon rooted at a fresh temp project. Returns {proc, projectDir, stop}. */
export async function startDaemon() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-ext-e2e-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-ext-home-'));
  const proc = spawn(process.execPath, [
    DAEMON_BIN, 'start', '--project', projectDir, '--port', String(DAEMON_PORT), '--foreground',
  ], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  await waitForHttp(`http://127.0.0.1:${DAEMON_PORT}/healthz`);
  const stop = async () => {
    try { proc.kill('SIGTERM'); } catch { /* best-effort */ }
    await new Promise((r) => setTimeout(r, 800));
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  return { proc, projectDir, home, stop };
}

/**
 * Build a temp copy of the extension whose manifest + rule-pack ALSO match the
 * local fixture origin, so the real content script injects there and resolves
 * the page to the `deepseek` adapter. Returns the temp extension path.
 */
export function buildTestExtension(fixtureOrigin) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-ext-build-'));
  copyDir(EXT_ROOT, dest, ['node_modules', 'test', '.git']);

  // Patch manifest matches.
  const manifestPath = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const fixtureGlob = `${fixtureOrigin}/*`;
  manifest.content_scripts[0].matches.push(fixtureGlob);
  manifest.host_permissions.push(`http://127.0.0.1:${DAEMON_PORT}/*`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Patch rule-pack: add the fixture origin glob to the deepseek entry.
  const rpPath = path.join(dest, 'rules', 'default-rulepack.json');
  const rp = JSON.parse(fs.readFileSync(rpPath, 'utf-8'));
  const ds = rp.sites.find((s) => s.id === 'deepseek');
  ds.match.push(`*://${fixtureOrigin.replace(/^https?:\/\//, '')}/*`);
  fs.writeFileSync(rpPath, JSON.stringify(rp, null, 2));

  return dest;
}

function copyDir(src, dest, skip = []) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

/** Serve the DeepSeek DOM fixture on an ephemeral port. Returns {origin, stop}. */
export async function startFixtureServer() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'deepseek.html'), 'utf-8');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  return { origin, stop: () => new Promise((r) => server.close(r)) };
}

/** Launch a persistent context with the extension loaded; return {context, extensionId}. */
export async function launchWithExtension(extPath) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-ext-profile-'));
  const headless = process.env.HEADLESS === '1';
  // MV3 extensions (service workers) do NOT load under Playwright's default
  // `headless:true` — that uses chromium-headless-shell, which has no extension
  // support. `channel:'chromium'` forces the FULL chromium binary in the new
  // headless mode, which DOES register extension service workers. Headed runs
  // work with the bundled chromium directly.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    ...(headless ? { channel: 'chromium' } : {}),
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
    ],
  });

  // Wait for the service worker to register, then derive the extension id.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;
  return { context, extensionId, userDataDir };
}
