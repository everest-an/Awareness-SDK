#!/usr/bin/env node
/**
 * `awareness` — minimal user-facing CLI.
 *
 * Auth:
 *   AWARENESS_API_KEY   — required (Bearer)
 *   AWARENESS_MEMORY_ID — required for record/install
 *   AWARENESS_HOST      — default http://localhost:8000
 *
 * Commands:
 *   awareness doctor
 *   awareness balance
 *   awareness recall "<query>" [--limit 5] [--detail summary|full]
 *   awareness record "<content>"
 *   awareness pack install <slug>
 *   awareness pack list [--locale zh-CN] [--delivery reference]
 *   awareness pack publish <manifest.json>
 *   awareness agent list  [--locale zh-CN] [--runtime claude-code]
 *   awareness agent install <slug> [--runtime claude-code]
 */

import process from 'node:process';
import { argv, env, exit } from 'node:process';
import { readFile } from 'node:fs/promises';

const HOST = env.AWARENESS_HOST || 'http://localhost:8000';
const API_KEY = env.AWARENESS_API_KEY;
const MEMORY_ID = env.AWARENESS_MEMORY_ID;

function die(msg, code = 1) {
  process.stderr.write(`awareness: ${msg}\n`);
  exit(code);
}

function requireKey() {
  if (!API_KEY) die('AWARENESS_API_KEY not set');
}

function requireMemory() {
  if (!MEMORY_ID) die('AWARENESS_MEMORY_ID not set');
}

async function req(method, path, { json, memoryHeader = false } = {}) {
  const headers = { 'Authorization': `Bearer ${API_KEY}` };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (memoryHeader) headers['X-Memory-Id'] = MEMORY_ID;
  const res = await fetch(`${HOST}/api/v1${path}`, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) die(`HTTP ${res.status} ${path} → ${typeof body === 'string' ? body : JSON.stringify(body)}`, res.status >= 500 ? 2 : 1);
  return body;
}

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { flags[a.slice(2)] = args[i + 1]; i += 1; }
    else rest.push(a);
  }
  return { flags, rest };
}

async function cmdDoctor() {
  console.log(`host        : ${HOST}`);
  console.log(`api_key     : ${API_KEY ? API_KEY.slice(0, 8) + '…' : '(missing)'}`);
  console.log(`memory_id   : ${MEMORY_ID || '(missing)'}`);
  try {
    const r = await fetch(`${HOST}/health`);
    console.log(`health      : ${r.status === 200 ? 'OK' : 'FAIL ' + r.status}`);
  } catch (e) {
    console.log(`health      : UNREACHABLE ${e.message}`);
  }
  if (API_KEY) {
    const bal = await req('GET', '/credits/balance');
    console.log(`credits     : wallet=${bal.wallet} burn=${bal.burn} total=${bal.total}`);
  }
}

async function cmdBalance() {
  requireKey();
  const b = await req('GET', '/credits/balance');
  console.log(JSON.stringify(b, null, 2));
}

async function cmdRecall(args) {
  requireKey();
  requireMemory();
  const { flags, rest } = parseFlags(args);
  const query = rest.join(' ');
  if (!query) die('usage: awareness recall "<query>" [--limit N] [--detail summary|full]');
  const limit = Number(flags.limit || 5);
  const detail = flags.detail || 'summary';
  const body = { query, custom_kwargs: { limit, detail } };
  const out = await req('POST', `/memories/${MEMORY_ID}/retrieve`, { json: body });
  console.log(JSON.stringify(out, null, 2));
}

async function cmdRecord(args) {
  requireKey();
  requireMemory();
  const content = args.join(' ');
  if (!content) die('usage: awareness record "<content>"');
  const out = await req('POST', `/memories/${MEMORY_ID}/content`, { json: { content } });
  console.log(JSON.stringify(out, null, 2));
}

async function cmdPack(args) {
  const [sub, ...rest] = args;
  const { flags, rest: pos } = parseFlags(rest);
  if (sub === 'install') {
    requireKey();
    requireMemory();
    const slug = pos[0];
    if (!slug) die('usage: awareness pack install <slug>');
    const out = await req('POST', `/packs/${slug}/install`, { memoryHeader: true, json: {} });
    console.log(JSON.stringify(out, null, 2));
  } else if (sub === 'list') {
    const q = new URLSearchParams();
    if (flags.locale) q.set('locale', flags.locale);
    if (flags.delivery) q.set('delivery_mode', flags.delivery);
    if (flags.category) q.set('category', flags.category);
    if (flags.limit) q.set('limit', flags.limit);
    const out = await req('GET', `/market/packs?${q.toString()}`);
    for (const item of out.items) {
      console.log(`${item.slug.padEnd(30)} ${item.title.padEnd(40)} · ${item.delivery_mode} · ${item.price_credits ?? 0}cr`);
    }
  } else if (sub === 'publish') {
    requireKey();
    const path = pos[0];
    if (!path) die('usage: awareness pack publish <manifest.json>');
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      die(`cannot read manifest: ${e.message}`);
    }
    const { slug, version, contents, changelog, pack } = manifest;
    if (!slug || !version || !contents) die('manifest needs: slug, version, contents (object). optional: changelog, pack{...} for first-time create');

    const existing = await fetch(`${HOST}/api/v1/packs/${slug}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    if (existing.status === 404) {
      if (!pack) die(`pack '${slug}' does not exist; manifest must include 'pack' object for first-time publish`);
      const createBody = { slug, ...pack };
      await req('POST', '/packs', { json: createBody });
      console.log(`created draft pack: ${slug}`);
    } else if (!existing.ok) {
      die(`HTTP ${existing.status} checking pack existence`);
    }

    const out = await req('POST', `/packs/${slug}/versions`, {
      json: { version, contents, changelog: changelog || null },
    });
    console.log(JSON.stringify(out, null, 2));
  } else {
    die('usage: awareness pack {install|list|publish}');
  }
}

async function cmdAgent(args) {
  const [sub, ...rest] = args;
  const { flags, rest: pos } = parseFlags(rest);
  if (sub === 'list') {
    const q = new URLSearchParams();
    if (flags.locale) q.set('locale', flags.locale);
    if (flags.runtime) q.set('runtime', flags.runtime);
    if (flags.category) q.set('category', flags.category);
    if (flags.limit) q.set('limit', flags.limit);
    const out = await req('GET', `/market/agents?${q.toString()}`);
    for (const item of out.items) {
      console.log(`${(item.emoji || '🤖')} ${item.slug.padEnd(35)} ${item.name} [${item.locale_used}]`);
    }
  } else if (sub === 'install') {
    const slug = pos[0];
    if (!slug) die('usage: awareness agent install <slug> [--runtime claude-code]');
    const runtime = flags.runtime || 'claude-code';
    const detailRes = await fetch(`${HOST}/api/v1/marketplace/agents/${slug}`);
    if (detailRes.status === 404) die(`agent not found: ${slug}`);
    if (!detailRes.ok) die(`HTTP ${detailRes.status} fetching agent detail`);
    const detail = await detailRes.json();
    const ping = await fetch(`${HOST}/api/v1/marketplace/agents/${slug}/install-ping`, { method: 'POST' });
    const pingBody = ping.ok ? await ping.json() : null;

    console.log(`${detail.emoji || '🤖'} ${detail.name}  (${slug})`);
    if (detail.tagline) console.log(`   ${detail.tagline}`);
    if (pingBody) console.log(`   installs: ${pingBody.install_count}`);
    console.log('');
    const variants = detail.install_variants || detail.install || {};
    const hostPaths = detail.host_install_paths || {};
    const hint = variants[runtime] || variants.default || hostPaths[runtime] || detail.install_url;
    if (hint) {
      console.log(`install (${runtime}):`);
      console.log(typeof hint === 'string' ? `  ${hint}` : JSON.stringify(hint, null, 2));
    } else {
      console.log(`runtime '${runtime}' has no preset install hint — install-ping recorded.`);
      if (detail.tools?.length) console.log(`tools: ${detail.tools.join(', ')}`);
    }
  } else {
    die('usage: awareness agent {list|install}');
  }
}

async function main() {
  const [cmd, ...rest] = argv.slice(2);
  switch (cmd) {
    case 'doctor':  await cmdDoctor();         break;
    case 'balance': await cmdBalance();        break;
    case 'recall':  await cmdRecall(rest);     break;
    case 'record':  await cmdRecord(rest);     break;
    case 'pack':    await cmdPack(rest);       break;
    case 'agent':   await cmdAgent(rest);      break;
    case '-h':
    case '--help':
    case undefined:
      console.log('awareness <cmd>  — doctor | balance | recall | record | pack {install|list|publish} | agent {list|install}');
      break;
    default:
      die(`unknown command: ${cmd}`);
  }
}

main().catch((e) => die(e.message || String(e), 2));
