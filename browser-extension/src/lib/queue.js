/**
 * Durable write queue (FM-2). When POST /memories 5xx's or times out, the
 * payload is stashed in chrome.storage.local and retried on the retry alarm.
 * Bounded so a permanently-offline daemon can't grow storage unbounded.
 */
import { STORAGE } from './config.js';

const MAX_QUEUE = 200;

export async function getQueue() {
  const got = await chrome.storage.local.get(STORAGE.queue);
  return Array.isArray(got[STORAGE.queue]) ? got[STORAGE.queue] : [];
}

export async function enqueue(item) {
  const q = await getQueue();
  q.push({ ...item, queued_at: Date.now(), attempts: 0 });
  // Drop oldest if over cap.
  const trimmed = q.slice(-MAX_QUEUE);
  await chrome.storage.local.set({ [STORAGE.queue]: trimmed });
  return trimmed.length;
}

export async function setQueue(items) {
  await chrome.storage.local.set({ [STORAGE.queue]: items.slice(-MAX_QUEUE) });
}

export async function queueSize() {
  return (await getQueue()).length;
}
