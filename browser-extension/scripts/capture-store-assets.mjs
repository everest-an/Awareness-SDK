/**
 * Capture Chrome Web Store screenshots (1280x800) from the REAL extension UI.
 *
 * It loads the packaged build (`dist/awareness-memory-<version>/`) into a real
 * Chromium with the real service worker, points it at a real Awareness memory
 * through the real cloud REST API, and screenshots the actual popup / side
 * panel. Only the page background and the captions are added afterwards; every
 * product pixel is the shipped UI.
 *
 * Usage (PowerShell):
 *   $env:SHOT_KEY="aw_..."; $env:SHOT_MEMORY_ID="<uuid>"
 *   $env:SHOT_MEMORY_NAME="Space Drive Knowledge Base"
 *   node scripts/capture-store-assets.mjs
 *
 * The key is a temporary API key for the account that owns the memory. Revoke
 * it in Settings -> API Keys after the run. Output goes to
 * docs/features/f-109-chrome-extension-cloud/store-assets/.
 *
 * Note on the popup shot: Chrome only exposes `tab.url` to an extension after
 * the user clicks the toolbar icon (activeTab). Automation cannot perform that
 * click, so the temp copy of popup.js resolves the active tab to the Doubao tab
 * the browser really has open. Everything else (auth, status, counters, panel)
 * is served by the real service worker against the real cloud.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(EXT_ROOT, '..', '..', 'docs', 'features', 'f-109-chrome-extension-cloud', 'store-assets');
const RAW = path.join(EXT_ROOT, 'test-results', 'store-raw');

const API_KEY = process.env.SHOT_KEY;
const MEMORY_ID = process.env.SHOT_MEMORY_ID;
const MEMORY_NAME = process.env.SHOT_MEMORY_NAME || 'Space Drive Knowledge Base';
if (!API_KEY || !MEMORY_ID) {
  console.error('SHOT_KEY and SHOT_MEMORY_ID are required');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf-8'));
const BUILD = path.join(EXT_ROOT, 'dist', `awareness-memory-${manifest.version}`);
if (!fs.existsSync(path.join(BUILD, 'src', 'sw.js'))) {
  console.error(`Run "npm run package" first: ${BUILD} is missing`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

// --- temp copy with the activeTab stub (see header note) ---------------------
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-store-ext-'));
copyDir(BUILD, EXT);
const popupJsPath = path.join(EXT, 'src', 'popup', 'popup.js');
const popupJs = fs.readFileSync(popupJsPath, 'utf-8');
const marker = 'const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });';
if (!popupJs.includes(marker)) {
  console.error('popup.js no longer matches the expected active-tab line; update this script');
  process.exit(1);
}
fs.writeFileSync(
  popupJsPath,
  popupJs.replace(marker, "const [tab] = [{ id: 1, url: 'https://www.doubao.com/chat/' }]; // SHOTS: activeTab cannot be granted to automation")
);

// --- launch ----------------------------------------------------------------
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-store-profile-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    // Chrome 137+ ignores --load-extension without this for non-dev builds.
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
  ],
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
const extensionId = new URL(sw.url()).host;

const SEED = {
  mode: 'cloud',
  connected: true,
  cloud_reauth: false,
  cloud_auth: {
    apiKey: API_KEY,
    memoryId: MEMORY_ID,
    memoryName: MEMORY_NAME,
    keyPrefix: API_KEY.slice(0, 8),
    connectedAt: Date.now() - 26 * 60 * 60 * 1000,
  },
  stats: { recorded: 128, filtered: 41, queued: 0 },
};

async function openExtensionPage(file, width, height) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(`chrome-extension://${extensionId}/${file}`);
  await page.evaluate((seed) => new Promise((r) => chrome.storage.local.set(seed, r)), SEED);
  await page.reload();
  await page.waitForTimeout(4000);
  return page;
}

// --- raw shots -------------------------------------------------------------
const popup = await openExtensionPage('src/popup/popup.html', 360, 800);
const popupBox = await popup.evaluate(() => ({
  width: Math.ceil(document.body.getBoundingClientRect().width),
  height: Math.ceil(document.body.scrollHeight),
}));
await popup.screenshot({ path: path.join(RAW, 'popup.png'), clip: { x: 0, y: 0, ...popupBox } });
console.log('popup', popupBox, '|', (await popup.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 160));

const panel = await openExtensionPage('src/sidepanel/sidepanel.html', 380, 700);
const panelBox = await panel.evaluate(() => ({
  width: Math.ceil(document.body.getBoundingClientRect().width),
  height: Math.min(700, Math.ceil(document.body.scrollHeight)),
}));
await panel.screenshot({ path: path.join(RAW, 'panel.png'), clip: { x: 0, y: 0, ...panelBox } });
console.log('panel', panelBox, '|', (await panel.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 160));

await context.close();

// --- compose 1280x800 store frames ----------------------------------------
const b64 = (file) => fs.readFileSync(file).toString('base64');

function frame({ chip, title, sub, bullets, image, imageW, imageH, bleed = false }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{width:1280px;height:800px;overflow:hidden;background:#070d18;
      font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#e8eef8}
    .glow{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5}
    .g1{width:520px;height:520px;right:-120px;top:-160px;background:#1b6f6a}
    .g2{width:420px;height:420px;left:-160px;bottom:-180px;background:#16345c}
    .grid{position:absolute;inset:0;
      background-image:radial-gradient(rgba(255,255,255,.055) 1px,transparent 1px);
      background-size:26px 26px;mask-image:radial-gradient(circle at 60% 40%,#000 30%,transparent 78%)}
    .wrap{position:relative;display:flex;align-items:center;height:100%;padding:0 0 0 86px;gap:56px}
    .copy{width:520px;flex:none}
    .chip{display:inline-flex;align-items:center;gap:9px;padding:7px 14px;border-radius:999px;
      border:1px solid rgba(92,224,210,.32);background:rgba(92,224,210,.09);
      color:#8ff0e6;font-size:13px;font-weight:600;letter-spacing:.02em}
    .dot{width:7px;height:7px;border-radius:50%;background:#5ce0d2;box-shadow:0 0 12px #5ce0d2}
    h1{margin:24px 0 18px;font-size:47px;line-height:1.12;font-weight:700;letter-spacing:-.02em}
    h1 em{font-style:normal;color:#5ce0d2}
    p.sub{font-size:18px;line-height:1.6;color:#9db1cc;max-width:460px}
    ul{margin-top:26px;display:grid;gap:13px}
    li{display:flex;gap:11px;align-items:flex-start;font-size:15px;color:#c3d3e6}
    li i{flex:none;width:18px;height:18px;margin-top:2px;border-radius:50%;
      background:rgba(92,224,210,.14);color:#5ce0d2;font-style:normal;
      font-size:11px;line-height:18px;text-align:center;font-weight:700}
    .shot{position:relative;flex:none;border-radius:18px;overflow:hidden;
      border:1px solid rgba(120,160,200,.22);
      box-shadow:0 40px 90px rgba(0,0,0,.62),0 0 0 1px rgba(255,255,255,.03) inset}
    .stage{flex:1;display:flex;align-items:center;justify-content:center}
    .bleed .stage{align-items:flex-end}
    .bleed .shot{margin-bottom:-84px;border-bottom-left-radius:0;border-bottom-right-radius:0}
    .shot img{display:block;width:${imageW}px;height:${imageH}px}
  </style></head><body class="${bleed ? 'bleed' : ''}">
    <div class="glow g1"></div><div class="glow g2"></div><div class="grid"></div>
    <div class="wrap">
      <div class="copy">
        <span class="chip"><span class="dot"></span>${chip}</span>
        <h1>${title}</h1>
        <p class="sub">${sub}</p>
        <ul>${bullets.map((b) => `<li><i>✓</i><span>${b}</span></li>`).join('')}</ul>
      </div>
      <div class="stage">
        <div class="shot"><img src="data:image/png;base64,${image}"></div>
      </div>
    </div>
  </body></html>`;
}

// Composition runs in its own browser without the extension.
const composer = await chromium.launch({ headless: true });
const page = await composer.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const shots = [
  {
    file: '01-memory-panel.png',
    frame: {
      chip: 'Chrome side panel',
      title: 'Every memory,<br><em>one click away</em>',
      sub: 'Browse the knowledge cards your AI conversations produced, search them in natural language, and open any card without leaving the page.',
      bullets: ['Cards and timeline views', 'Natural-language search over your own memory', 'Reads your cloud memory — never your browsing history'],
      image: b64(path.join(RAW, 'panel.png')),
      imageW: 380,
      imageH: 700,
      bleed: true,
    },
  },
  {
    file: '02-popup-connected.png',
    frame: {
      chip: 'Connected to your own memory',
      title: 'One memory across <em>every AI</em>',
      sub: 'Awareness Memory captures each finished answer and gives it back to you in the next chat — on ChatGPT, Doubao, Kimi, DeepSeek and Gemini.',
      bullets: ['Cloud mode works with no local install', 'Per-site on/off and capture counters', 'Optional local mode: nothing leaves your machine'],
      image: b64(path.join(RAW, 'popup.png')),
      imageW: 360,
      imageH: Math.round((popupBox.height / popupBox.width) * 360),
    },
  },
];

for (const shot of shots) {
  await page.setContent(frame(shot.frame), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, shot.file) });
  console.log('wrote', shot.file);
}

await composer.close();
console.log('OUT', OUT);
