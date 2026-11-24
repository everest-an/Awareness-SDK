/**
 * Shared harness for the extension E2E specs.
 *
 * Provides: spawn a real daemon on 37800, build a test copy of the extension
 * (manifest + rule-pack patched so the content script also injects on the local
 * DeepSeek fixture origin), start a static fixture server, and launch a
 * Chromium persistent context with the extension loaded.
 */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
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
  // The same origin also stands in for the cloud REST host in F-109 specs, so
  // the service worker needs host permission to fetch it.
  manifest.host_permissions.push(fixtureGlob);
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
export async function launchWithExtension(extPath, { mode = 'local' } = {}) {
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
      // Chrome 137+ ignores --load-extension unless this feature is disabled.
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
    ],
  });

  // Wait for the service worker to register, then derive the extension id.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;

  // F-109 installs default to cloud. The F-064 E2E suite exercises the local
  // daemon chain, so drive the real SET_MODE message from an extension page
  // (not storage poking) — this also covers the mode-switch path itself.
  if (mode) await setMode(context, extensionId, mode);
  return { context, extensionId, userDataDir };
}

/**
 * Close a persistent context with a bound, then hard-kill the browser if the
 * graceful close hung (Windows occasionally leaves the extension SW holding a
 * profile lock). A hung afterAll must not fail an otherwise-green suite.
 */
export async function closeContext(target, timeoutMs = 10_000) {
  const context = target?.context || target;
  const userDataDir = target?.userDataDir;
  if (!context) return;

  let hung = false;
  let timer;
  try {
    await Promise.race([
      context.close().catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(() => { hung = true; resolve(); }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (hung && userDataDir) killBrowserForProfile(userDataDir);
}

/** Last-resort cleanup: kill the browser process launched with this profile. */
function killBrowserForProfile(userDataDir) {
  try {
    if (process.platform === 'win32') {
      const escaped = String(userDataDir).replace(/'/g, "''");
      const script = [
        "$p = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\"",
        `| Where-Object { $_.CommandLine -like '*--user-data-dir=${escaped}*' }`,
        "| Select-Object -First 1",
        "; if ($p) { taskkill /F /T /PID $p.ProcessId }",
      ].join(' ');
      execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        stdio: 'ignore',
        timeout: 15_000,
      });
    } else {
      execFileSync('pkill', ['-f', `--user-data-dir=${userDataDir}`], { stdio: 'ignore' });
    }
  } catch { /* best-effort */ }
}

/** Zero out a temp extension build without letting EBUSY fail the suite. */
export function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows lock */ }
}

/** Switch the extension's transport via its public message API. */
export async function setMode(context, extensionId, mode) {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    const res = await page.evaluate(
      (m) => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'SET_MODE', mode: m }, resolve)),
      mode
    );
    if (!res?.ok) throw new Error(`SET_MODE ${mode} failed: ${JSON.stringify(res)}`);

    // onInstalled's bootstrap may still be in flight and can overwrite the
    // connected flag; wait for the mode's own heartbeat to settle.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const status = await page.evaluate(
        () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATUS' }, resolve))
      );
      if (status?.mode === mode && (mode === 'off' || status.connected)) return;
      await page.waitForTimeout(200);
    }
    if (mode === 'local') throw new Error('SET_MODE local did not reach the daemon within 10s');
  } finally {
    await page.close();
  }
}
