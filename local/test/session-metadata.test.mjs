/**
 * F-075 · session-metadata store tests.
 *
 * Covers: set/get roundtrip, JSON persistence across "restarts"
 * (re-load from disk), corrupt-file recovery, multiple sessions/keys,
 * and atomicity of the temp+rename save.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  metadataFilePath,
  loadSessionMetadata,
  saveSessionMetadata,
  setSessionMetadata,
  getSessionMetadata,
} from '../src/daemon/session-metadata.mjs';

function tmpAwarenessDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-meta-'));
}

test('set/get roundtrip in memory', () => {
  const meta = {};
  setSessionMetadata(meta, 'sess-1', 'parametric_snapshot_path', '/tmp/x.json');
  assert.equal(getSessionMetadata(meta, 'sess-1').parametric_snapshot_path, '/tmp/x.json');
});

test('get on unknown session returns null', () => {
  assert.equal(getSessionMetadata({}, 'nope'), null);
});

test('persists to disk and survives reload (daemon "restart")', () => {
  const dir = tmpAwarenessDir();
  let meta = loadSessionMetadata(dir);
  setSessionMetadata(meta, 'sess-1', 'parametric_snapshot_path', '/tmp/s1.json');
  saveSessionMetadata(dir, meta);

  // Simulate restart: fresh load from disk.
  const reloaded = loadSessionMetadata(dir);
  assert.equal(getSessionMetadata(reloaded, 'sess-1').parametric_snapshot_path, '/tmp/s1.json');
  assert.equal(metadataFilePath(dir), path.join(dir, 'session-metadata.json'));
});

test('multiple sessions and keys are independent', () => {
  const meta = {};
  setSessionMetadata(meta, 'a', 'k1', 'v1');
  setSessionMetadata(meta, 'a', 'k2', 'v2');
  setSessionMetadata(meta, 'b', 'k1', 'other');
  assert.equal(getSessionMetadata(meta, 'a').k1, 'v1');
  assert.equal(getSessionMetadata(meta, 'a').k2, 'v2');
  assert.equal(getSessionMetadata(meta, 'b').k1, 'other');
});

test('corrupt file treated as empty (no throw), then overwritten on save', () => {
  const dir = tmpAwarenessDir();
  fs.writeFileSync(metadataFilePath(dir), '{ not valid json', 'utf-8');
  const meta = loadSessionMetadata(dir);
  assert.deepEqual(meta, {});
  setSessionMetadata(meta, 's', 'k', 'v');
  saveSessionMetadata(dir, meta);
  assert.equal(getSessionMetadata(loadSessionMetadata(dir), 's').k, 'v');
});

test('save is atomic (no leftover .tmp files)', () => {
  const dir = tmpAwarenessDir();
  const meta = loadSessionMetadata(dir);
  setSessionMetadata(meta, 's', 'k', 'v');
  saveSessionMetadata(dir, meta);
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('save creates awarenessDir if missing', () => {
  const parent = tmpAwarenessDir();
  const dir = path.join(parent, 'nested', '.awareness');
  const meta = {};
  setSessionMetadata(meta, 's', 'k', 'v');
  saveSessionMetadata(dir, meta);
  assert.ok(fs.existsSync(metadataFilePath(dir)));
});
