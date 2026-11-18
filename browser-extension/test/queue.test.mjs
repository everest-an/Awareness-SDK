/**
 * L2 · Durable queue quota behaviour.
 *
 * chrome.storage.local is a real browser quota (~10 MB); a long AI turn can
 * push a full queue over it. The queue must compact instead of throwing into
 * the capture path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enqueue, getQueue, setQueue, queueSize } from '../src/lib/queue.js';

function installChrome({ maxItems = Infinity } = {}) {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return key in store ? { [key]: store[key] } : {};
        },
        async set(obj) {
          const [key, value] = Object.entries(obj)[0];
          if (Array.isArray(value) && value.length > maxItems) {
            throw new Error('QUOTA_BYTES quota exceeded');
          }
          store[key] = value;
        },
      },
    },
  };
  return store;
}

test('enqueue appends and returns the new size', async () => {
  installChrome();
  assert.equal(await enqueue({ payload: { content: 'a' } }), 1);
  assert.equal(await enqueue({ payload: { content: 'b' } }), 2);
  const q = await getQueue();
  assert.equal(q.length, 2);
  assert.equal(q[1].payload.content, 'b');
  assert.equal(q[0].attempts, 0);
});

test('a full queue is capped at 200 (oldest dropped)', async () => {
  installChrome();
  for (let i = 0; i < 205; i++) {
    await enqueue({ payload: { content: String(i) } });
  }
  const q = await getQueue();
  assert.equal(q.length, 200);
  assert.equal(q[0].payload.content, '5');
  assert.equal(q[199].payload.content, '204');
});

test('quota failure compacts to the newest 50 instead of throwing', async () => {
  installChrome({ maxItems: 100 });
  for (let i = 0; i < 151; i++) {
    await enqueue({ payload: { content: String(i) } });
  }
  // It never exceeded the quota and never threw.
  assert.ok((await getQueue()).length <= 100);

  // The next write overflows → compact to exactly 50, newest kept.
  await enqueue({ payload: { content: '152' } });
  const q = await getQueue();
  assert.equal(q.length, 50);
  assert.equal(q[49].payload.content, '152');
});

test('setQueue also compacts under quota pressure', async () => {
  installChrome({ maxItems: 80 });
  const items = Array.from({ length: 120 }, (_, i) => ({ payload: { content: String(i) } }));
  const size = await setQueue(items);
  assert.equal(size, 50);
  assert.equal(await queueSize(), 50);
});

test('a hard storage failure returns 0 and never throws', async () => {
  globalThis.chrome = {
    storage: {
      local: {
        async get() { return {}; },
        async set() { throw new Error('storage dead'); },
      },
    },
  };
  assert.equal(await enqueue({ payload: { content: 'x' } }), 0);
});
