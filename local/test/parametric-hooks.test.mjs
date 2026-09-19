/**
 * P2-1 · Parametric broker event hooks tests.
 *
 * Verifies:
 * 1. Both switches default OFF — no broker calls in any hook.
 * 2. consolidation_write ON + broker → onRecordSuccess writes to broker.
 * 3. consolidation_write ON + no broker → no-op (no error).
 * 4. conflict_forget ON + broker → onConflictSupersede forgets old + writes new.
 * 5. conflict_forget ON + no broker → no-op.
 * 6. consolidation_write ON + broker → onSessionEnd snapshots and saves file.
 * 7. Both switches OFF + broker attached → zero side effects.
 * 8. Broker errors are swallowed (never throw to caller).
 * 9. policyWrite preferred over plain write when available.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  getParametricSwitches,
  onRecordSuccess,
  onConflictSupersede,
  onSessionEnd,
} from '../src/daemon/parametric-hooks.mjs';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function mockDaemon(opts = {}) {
  const switches = opts.switches || {};
  const broker = opts.broker || null;
  return {
    _parametricBroker: broker,
    awarenessDir: opts.awarenessDir || '/tmp/test-awareness',
    _loadConfig: () => ({
      parametric: switches,
    }),
    _setSessionMetadata: opts.setSessionMetadata || (() => {}),
  };
}

function mockBroker(opts = {}) {
  const calls = { write: [], forget: [], snapshot: [], policyWrite: [] };
  return {
    calls,
    getActiveSessionId: () => opts.sessionId || 'sess-test',
    write: async (sid, key, value) => { calls.write.push({ sid, key, value }); },
    forget: async (sid, key) => { calls.forget.push({ sid, key }); },
    snapshot: async (sid) => {
      calls.snapshot.push({ sid });
      return opts.snapshotResult || { format: 'parametric-memory-v1', data: 'test' };
    },
    policyWrite: opts.hasPolicyWrite
      ? async (sid, event) => { calls.policyWrite.push({ sid, event }); }
      : undefined,
  };
}

// ------------------------------------------------------------------
// Switch defaults
// ------------------------------------------------------------------

test('P2-1 · getParametricSwitches defaults to both off', () => {
  const daemon = mockDaemon();
  const sw = getParametricSwitches(daemon);
  assert.equal(sw.consolidation_write, false);
  assert.equal(sw.conflict_forget, false);
});

test('P2-1 · getParametricSwitches reads config', () => {
  const daemon = mockDaemon({ switches: { consolidation_write: true, conflict_forget: true } });
  const sw = getParametricSwitches(daemon);
  assert.equal(sw.consolidation_write, true);
  assert.equal(sw.conflict_forget, true);
});

test('P2-1 · getParametricSwitches handles missing config', () => {
  const daemon = { _parametricBroker: null };
  const sw = getParametricSwitches(daemon);
  assert.equal(sw.consolidation_write, false);
  assert.equal(sw.conflict_forget, false);
});

// ------------------------------------------------------------------
// onRecordSuccess
// ------------------------------------------------------------------

test('P2-1 · onRecordSuccess: both switches off → no broker calls', async () => {
  const broker = mockBroker();
  const daemon = mockDaemon({ broker });
  await onRecordSuccess(daemon, { id: 'm1', content: 'hello', title: 'Hello' });
  assert.equal(broker.calls.write.length, 0);
  assert.equal(broker.calls.policyWrite.length, 0);
});

test('P2-1 · onRecordSuccess: consolidation_write on + policyWrite → uses policyWrite', async () => {
  const broker = mockBroker({ hasPolicyWrite: true });
  const daemon = mockDaemon({ broker, switches: { consolidation_write: true } });
  await onRecordSuccess(daemon, { id: 'm1', content: 'hello', title: 'Hello', type: 'message' });
  assert.equal(broker.calls.policyWrite.length, 1);
  assert.equal(broker.calls.policyWrite[0].sid, 'sess-test');
  assert.equal(broker.calls.policyWrite[0].event.id, 'm1');
  assert.equal(broker.calls.write.length, 0, 'should not use plain write when policyWrite exists');
});

test('P2-1 · onRecordSuccess: consolidation_write on + no policyWrite → falls back to write', async () => {
  const broker = mockBroker();
  const daemon = mockDaemon({ broker, switches: { consolidation_write: true } });
  await onRecordSuccess(daemon, { id: 'm1', content: 'hello world', title: 'Hello' });
  assert.equal(broker.calls.write.length, 1);
  assert.equal(broker.calls.write[0].key, 'Hello');
  assert.equal(broker.calls.write[0].value, 'hello world');
});

test('P2-1 · onRecordSuccess: no broker → no-op', async () => {
  const daemon = mockDaemon({ switches: { consolidation_write: true } });
  // Should not throw
  await onRecordSuccess(daemon, { id: 'm1', content: 'hello' });
});

test('P2-1 · onRecordSuccess: broker throws → swallowed', async () => {
  const broker = mockBroker();
  broker.write = async () => { throw new Error('boom'); };
  const daemon = mockDaemon({ broker, switches: { consolidation_write: true } });
  // Should not throw
  await onRecordSuccess(daemon, { id: 'm1', content: 'hello', title: 'T' });
});

// ------------------------------------------------------------------
// onConflictSupersede
// ------------------------------------------------------------------

test('P2-1 · onConflictSupersede: conflict_forget off → no broker calls', async () => {
  const broker = mockBroker();
  const daemon = mockDaemon({ broker });
  await onConflictSupersede(daemon, { id: 'old', title: 'Old' }, { id: 'new', title: 'New' });
  assert.equal(broker.calls.forget.length, 0);
  assert.equal(broker.calls.write.length, 0);
});

test('P2-1 · onConflictSupersede: conflict_forget on → forget old + write new', async () => {
  const broker = mockBroker();
  const daemon = mockDaemon({ broker, switches: { conflict_forget: true } });
  await onConflictSupersede(
    daemon,
    { id: 'old-card', title: 'Old Decision', summary: 'use pgvector' },
    { id: 'new-card', title: 'New Decision', summary: 'use pinecone', category: 'decision' },
  );
  assert.equal(broker.calls.forget.length, 1);
  assert.equal(broker.calls.forget[0].key, 'Old Decision');
  assert.equal(broker.calls.write.length, 1);
  assert.equal(broker.calls.write[0].key, 'New Decision');
  assert.equal(broker.calls.write[0].value, 'use pinecone');
});

test('P2-1 · onConflictSupersede: conflict_forget on + policyWrite → uses policyWrite for new', async () => {
  const broker = mockBroker({ hasPolicyWrite: true });
  const daemon = mockDaemon({ broker, switches: { conflict_forget: true } });
  await onConflictSupersede(
    daemon,
    { id: 'old', title: 'Old', summary: 'old val' },
    { id: 'new', title: 'New', summary: 'new val', category: 'decision' },
  );
  assert.equal(broker.calls.forget.length, 1, 'forget always uses plain forget');
  assert.equal(broker.calls.policyWrite.length, 1);
  assert.equal(broker.calls.policyWrite[0].event.id, 'new');
});

test('P2-1 · onConflictSupersede: no broker → no-op', async () => {
  const daemon = mockDaemon({ switches: { conflict_forget: true } });
  await onConflictSupersede(daemon, { title: 'old' }, { title: 'new' });
});

test('P2-1 · onConflictSupersede: broker throws → swallowed', async () => {
  const broker = mockBroker();
  broker.forget = async () => { throw new Error('boom'); };
  const daemon = mockDaemon({ broker, switches: { conflict_forget: true } });
  await onConflictSupersede(daemon, { title: 'old' }, { title: 'new' });
});

// ------------------------------------------------------------------
// onSessionEnd
// ------------------------------------------------------------------

test('P2-1 · onSessionEnd: consolidation_write off → null', async () => {
  const broker = mockBroker();
  const daemon = mockDaemon({ broker });
  const result = await onSessionEnd(daemon);
  assert.equal(result, null);
  assert.equal(broker.calls.snapshot.length, 0);
});

test('P2-1 · onSessionEnd: consolidation_write on → saves snapshot file', async () => {
  const broker = mockBroker();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-test-'));
  const daemon = mockDaemon({
    broker,
    switches: { consolidation_write: true },
    awarenessDir: tmpDir,
  });
  const result = await onSessionEnd(daemon);
  assert.ok(result, 'should return a file path');
  assert.ok(fs.existsSync(result), 'snapshot file should exist');
  const content = JSON.parse(fs.readFileSync(result, 'utf-8'));
  assert.equal(content.format, 'parametric-memory-v1');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('P2-1 · onSessionEnd: no broker → null', async () => {
  const daemon = mockDaemon({ switches: { consolidation_write: true } });
  const result = await onSessionEnd(daemon);
  assert.equal(result, null);
});

test('P2-1 · onSessionEnd: broker throws → null (swallowed)', async () => {
  const broker = mockBroker();
  broker.snapshot = async () => { throw new Error('boom'); };
  const daemon = mockDaemon({ broker, switches: { consolidation_write: true } });
  const result = await onSessionEnd(daemon);
  assert.equal(result, null);
});

// ------------------------------------------------------------------
// Dual-switch independence
// ------------------------------------------------------------------

test('P2-1 · consolidation_write on + conflict_forget off → record writes, conflict does not', async () => {
  const broker = mockBroker();
  const daemon = mockDaemon({ broker, switches: { consolidation_write: true } });
  await onRecordSuccess(daemon, { id: 'm1', content: 'hello', title: 'T' });
  assert.equal(broker.calls.write.length, 1, 'record should write');
  await onConflictSupersede(daemon, { title: 'old' }, { title: 'new' });
  assert.equal(broker.calls.forget.length, 0, 'conflict should NOT forget');
});

test('P2-1 · consolidation_write off + conflict_forget on → conflict acts, record does not', async () => {
  const broker = mockBroker();
  const daemon = mockDaemon({ broker, switches: { conflict_forget: true } });
  await onRecordSuccess(daemon, { id: 'm1', content: 'hello', title: 'T' });
  assert.equal(broker.calls.write.length, 0, 'record should NOT write');
  await onConflictSupersede(daemon, { title: 'old' }, { title: 'new', summary: 'val' });
  assert.equal(broker.calls.forget.length, 1, 'conflict should forget');
  assert.equal(broker.calls.write.length, 1, 'conflict should rewrite');
});

test('P2-1 · both switches off + broker attached → zero side effects', async () => {
  const broker = mockBroker();
  const daemon = mockDaemon({ broker });
  await onRecordSuccess(daemon, { id: 'm1', content: 'hello' });
  await onConflictSupersede(daemon, { title: 'old' }, { title: 'new' });
  const snapResult = await onSessionEnd(daemon);
  assert.equal(broker.calls.write.length, 0);
  assert.equal(broker.calls.forget.length, 0);
  assert.equal(broker.calls.snapshot.length, 0);
  assert.equal(snapResult, null);
});
