// L2+L3+L4 combined — zero mock, real backend on localhost:8000.
//
// Required env: AWARENESS_API_KEY, AWARENESS_MEMORY_ID, AWARENESS_HOST
// Skips all tests if backend health check fails — this is a live-only suite
// by design (per CLAUDE.md L4 rule: no page.route / HAR mocks in E2E).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli.mjs');
const HOST = process.env.AWARENESS_HOST || 'http://localhost:8000';
const API_KEY = process.env.AWARENESS_API_KEY;
const MEMORY_ID = process.env.AWARENESS_MEMORY_ID;

let BACKEND_UP = false;
let tmpDir;

before(async () => {
  try {
    const r = await fetch(`${HOST}/health`);
    BACKEND_UP = r.ok;
  } catch { BACKEND_UP = false; }
  tmpDir = await mkdtemp(join(tmpdir(), 'aw-cli-test-'));
});

function runCli(args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const p = spawn('node', [CLI, ...args], {
      env: {
        ...process.env,
        AWARENESS_HOST: HOST,
        AWARENESS_API_KEY: API_KEY || '',
        AWARENESS_MEMORY_ID: MEMORY_ID || '',
        ...env,
      },
    });
    let stdout = '', stderr = '';
    p.stdout.on('data', (c) => stdout += c);
    p.stderr.on('data', (c) => stderr += c);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function authGet(path) {
  const r = await fetch(`${HOST}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}

// ───────────────── Journey 1 + 2 ─────────────────

test('pack publish: creates draft + first version on new slug', async (t) => {
  if (!BACKEND_UP || !API_KEY) return t.skip('backend down or no API key');
  const slug = `cli-test-pack-${Date.now()}`;
  const manifest = {
    slug,
    version: '1.0.0',
    changelog: 'journey1 first version',
    pack: {
      title: 'CLI Test Pack',
      name_i18n: { en: 'CLI Test Pack', zh: 'CLI 测试包' },
      description_i18n: { en: 'auto-test pack', zh: '自动测试' },
      default_locale: 'en',
      supported_locales: ['en', 'zh'],
      category: 'workflows',
      tags: ['test'],
      delivery_mode: 'reference',
      price_credits: 0,
      price_usd_cents: 0,
    },
    contents: { cards: [{ title: 'journey1', body: 'hello' }] },
  };
  const path = join(tmpDir, `${slug}.json`);
  await writeFile(path, JSON.stringify(manifest));

  const r = await runCli(['pack', 'publish', path]);
  assert.equal(r.code, 0, `exit 0; stderr=${r.stderr}`);
  assert.match(r.stdout, /created draft pack/);
  assert.match(r.stdout, /"state": "published"/);

  // Backend verification — zero mock
  const detail = await authGet(`/packs/${slug}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.state, 'published');

  t.diagnostic(`slug=${slug} verified end-to-end`);
});

test('pack publish: skips create when pack already exists (second version)', async (t) => {
  if (!BACKEND_UP || !API_KEY) return t.skip('backend down or no API key');
  const slug = `cli-test-pack2-${Date.now()}`;

  // round 1 — create + v1
  const m1 = {
    slug, version: '1.0.0',
    pack: {
      title: 'Two-Version Test', default_locale: 'en', supported_locales: ['en'],
      category: 'workflows', delivery_mode: 'reference',
      name_i18n: { en: 'Two-Version Test' },
      description_i18n: { en: 'two versions' },
    },
    contents: { cards: [] },
  };
  const p1 = join(tmpDir, `${slug}-v1.json`);
  await writeFile(p1, JSON.stringify(m1));
  const r1 = await runCli(['pack', 'publish', p1]);
  assert.equal(r1.code, 0, `v1 failed: ${r1.stderr}`);
  assert.match(r1.stdout, /created draft pack/);

  // round 2 — same slug, no pack block, v2
  const m2 = { slug, version: '2.0.0', changelog: 'bump', contents: { cards: [] } };
  const p2 = join(tmpDir, `${slug}-v2.json`);
  await writeFile(p2, JSON.stringify(m2));
  const r2 = await runCli(['pack', 'publish', p2]);
  assert.equal(r2.code, 0, `v2 failed: ${r2.stderr}`);
  assert.doesNotMatch(r2.stdout, /created draft pack/, 'must NOT re-create');
  assert.match(r2.stdout, /"version": "2.0.0"/);
});

// ───────────────── Journey 3 ─────────────────

test('agent install: bumps install-ping counter by exactly 1', async (t) => {
  if (!BACKEND_UP) return t.skip('backend down');
  // Pick any seeded agent
  const list = await fetch(`${HOST}/api/v1/market/agents?limit=1`);
  const items = (await list.json()).items || [];
  if (items.length === 0) return t.skip('no seeded agents');
  const slug = items[0].slug;

  const before = await fetch(`${HOST}/api/v1/marketplace/agents/${slug}`).then(r => r.json());
  const r = await runCli(['agent', 'install', slug]);
  assert.equal(r.code, 0, `install failed: ${r.stderr}`);
  const after = await fetch(`${HOST}/api/v1/marketplace/agents/${slug}`).then(r => r.json());

  assert.equal(after.install_count, before.install_count + 1,
    `counter ${before.install_count} → ${after.install_count}, expected +1`);
  assert.match(r.stdout, new RegExp(slug));
});

// ───────────────── L3 Failure Modes ─────────────────

test('F1 · publish fails cleanly on missing manifest', async () => {
  const r = await runCli(['pack', 'publish', '/does/not/exist.json']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /cannot read manifest/);
});

test('F2 · publish rejects incomplete manifest', async () => {
  const path = join(tmpDir, 'bad.json');
  await writeFile(path, JSON.stringify({ slug: 'x' })); // no version/contents
  const r = await runCli(['pack', 'publish', path]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /slug, version, contents/);
});

test('F4 · agent install handles 404 cleanly', async (t) => {
  if (!BACKEND_UP) return t.skip('backend down');
  const r = await runCli(['agent', 'install', `nonexistent-slug-${Date.now()}`]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /agent not found/);
});

test('F5 · pack install surfaces 402 on insufficient credits', async (t) => {
  if (!BACKEND_UP || !API_KEY || !MEMORY_ID) return t.skip('missing live env');
  // Create a high-priced pack to force 402
  const slug = `cli-test-expensive-${Date.now()}`;
  const manifest = {
    slug, version: '1.0.0',
    pack: {
      title: 'Expensive', default_locale: 'en', supported_locales: ['en'],
      category: 'workflows', delivery_mode: 'reference',
      price_credits: 999999,
      name_i18n: { en: 'Expensive' },
      description_i18n: { en: 'too pricey' },
    },
    contents: { cards: [] },
  };
  const p = join(tmpDir, `${slug}.json`);
  await writeFile(p, JSON.stringify(manifest));
  const pubR = await runCli(['pack', 'publish', p]);
  assert.equal(pubR.code, 0, `prep publish failed: ${pubR.stderr}`);

  const r = await runCli(['pack', 'install', slug]);
  assert.equal(r.code, 1, 'CLI should exit non-zero on 402');
  assert.match(r.stderr, /HTTP 402/);
  assert.match(r.stderr, /insufficient_credits/);
});

test('F6 · record fails fast when API key missing', async () => {
  const r = await runCli(['record', 'hello'], { env: { AWARENESS_API_KEY: '' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /AWARENESS_API_KEY not set/);
});

// cleanup
test('cleanup tmp', async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });
