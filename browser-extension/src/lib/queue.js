/**
 * Durable write queue (FM-2). When POST /memories 5xx's or times out, the
 * payload is stashed in chrome.storage.local and retried on the retry alarm.
 * Bounded so a permanently-offline daemon can't grow storage unbounded.
 *
 * `chrome.storage.local` has a ~10 MB quota. A handful of long AI turns can
 * exceed it; an unhandled quota rejection would drop the capture silently.
 * On a write failure we compact to the newest `COMPACT_QUEUE` items and retry.
 */
import { STORAGE } from './config.js';

const MAX_QUEUE = 200;
const COMPACT_QUEUE = 50;

export async function getQueue() {
  const got = await chrome.storage.local.get(STORAGE.queue);
  return Array.isArray(got[STORAGE.queue]) ? got[STORAGE.queue] : [];
}

export async function enqueue(item) {
  const q = await getQueue();
  q.push({ ...item, queued_at: Date.now(), attempts: 0 });
  // Drop oldest if over cap.
  const trimmed = q.slice(-MAX_QUEUE);
  return writeQueue(trimmed);
}

export async function setQueue(items) {
  return writeQueue(items.slice(-MAX_QUEUE));
}

export async function queueSize() {
  return (await getQueue()).length;
}

async function writeQueue(items) {
  try {
    await chrome.storage.local.set({ [STORAGE.queue]: items });
    return items.length;
  } catch {
    // Quota exceeded (or a transient storage failure): keep the newest slice.
    const compact = items.slice(-COMPACT_QUEUE);
    try {
      await chrome.storage.local.set({ [STORAGE.queue]: compact });
      return compact.length;
    } catch {
      // Never throw into a capture path — losing the queue beats breaking chat.
      return 0;
    }
  }
}
