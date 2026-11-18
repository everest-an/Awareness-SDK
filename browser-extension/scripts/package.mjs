#!/usr/bin/env node
/**
 * F-109 · Chrome Web Store packager (no dependencies).
 *
 * Produces `dist/awareness-memory-<version>.zip` containing ONLY runtime
 * files: manifest.json, src/**, rules/**, icons/**. Dev/test files never ship.
 *
 * Fails if the three version sources disagree (manifest / package.json /
 * CHANGELOG top entry) — a store upload with a stale version is unrecoverable.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const INCLUDE_FILES = ['manifest.json'];
const INCLUDE_DIRS = ['src', 'rules', 'icons'];

// ---------------------------------------------------------------------------
// Version guard.
// ---------------------------------------------------------------------------

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

function assertVersions(manifestVersion) {
  const pkg = readJson('package.json');
  if (pkg.version !== manifestVersion) {
    throw new Error(`version mismatch: package.json ${pkg.version} != manifest.json ${manifestVersion}`);
  }
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8');
  const first = changelog.match(/^##\s*\[([^\]]+)\]/m);
  if (!first) throw new Error('CHANGELOG.md has no "## [version]" heading');
  if (first[1] !== manifestVersion) {
    throw new Error(`version mismatch: CHANGELOG.md ${first[1]} != manifest.json ${manifestVersion}`);
  }
}

// ---------------------------------------------------------------------------
// File collection.
// ---------------------------------------------------------------------------

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

function collect() {
  const files = [...INCLUDE_FILES];
  for (const dir of INCLUDE_DIRS) files.push(...walk(path.join(ROOT, dir)));
  return files.sort();
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (deflate or store).
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function buildZip(entries) {
  const { time, day } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, eocd]);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const manifest = readJson('manifest.json');
assertVersions(manifest.version);

const files = collect();
const entries = files.map((rel) => ({ name: rel, data: fs.readFileSync(path.join(ROOT, rel)) }));
const zip = buildZip(entries);

fs.mkdirSync(DIST, { recursive: true });
const versionedDir = path.join(DIST, `awareness-memory-${manifest.version}`);
// Chrome can't load a .zip directly. Emit the same file set as an unpacked
// directory too: that is what `Load unpacked` uses for a final manual check,
// and what `test/e2e/packaged-artifact.spec.mjs` boots to prove the artifact
// (not just the source tree) is runnable.
fs.rmSync(versionedDir, { recursive: true, force: true });
for (const { name, data } of entries) {
  const target = path.join(versionedDir, ...name.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

const out = path.join(DIST, `awareness-memory-${manifest.version}.zip`);
fs.writeFileSync(out, zip);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`✓ ${path.relative(process.cwd(), out)}`);
console.log(`  version ${manifest.version} · ${files.length} files · ${kb(zip.length)}`);
console.log(`✓ ${path.relative(process.cwd(), versionedDir)}/ (unpacked, for Load unpacked)`);
for (const f of files) console.log(`  + ${f}`);
