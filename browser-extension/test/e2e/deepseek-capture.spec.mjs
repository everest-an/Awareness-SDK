/**
 * L4 · E2E — DeepSeek capture → daemon write → recall → inject (zero mock).
 *
 * The full bidirectional bridge chain against a REAL daemon:
 *   1. Load the unpacked extension (rule-pack patched so the content script
 *      resolves the local DeepSeek fixture to the `deepseek` adapter).
 *   2. Open the fixture, type a question, send it. The fixture appends an
 *      assistant answer then (~500ms later) the `.ds-message-feedback-container`
 *      finish signal — exactly the actionBarAppears anchor the adapter watches.
 *   3. The content script scrapes the finished Q&A and relays CAPTURE to the SW,
 *      which writes it to the REAL daemon with the bridge token.
 *   4. Assert the daemon persisted it (`GET /api/v1/memories?source=external_chat`)
 *      and that it is recallable (`GET /api/v1/memories/search`).
 *   5. Inject round-trip: click "找相关记忆" → SW → daemon prompt/inject → the
 *      in-page bar reflects the daemon's answer.
 *
 * The daemon is 100% real — no `page.route`, no HAR. Only the third-party chat
 * site (which we cannot log into in CI) is stood in for by a local DOM fixture.
 */
import { test, expect } from '@playwright/test';
import {
  startDaemon,
  buildTestExtension,
  startFixtureServer,
  launchWithExtension,
  DAEMON_PORT,
} from './helpers.mjs';
import fs from 'node:fs';

const QUESTION = 'How should I store external-chat captures so they survive workspace switches?';
const BASE = `http://127.0.0.1:${DAEMON_PORT}/api/v1`;

let daemon;
let fixture;
let extPath;
let ctx;

test.beforeAll(async () => {
  daemon = await startDaemon();
  fixture = await startFixtureServer();
  extPath = buildTestExtension(fixture.origin);
  ctx = await launchWithExtension(extPath);

  // Wait for the SW to mint a token against the real daemon before capturing,
  // otherwise the first write races the bootstrap.
  await expect
    .poll(async () => {
      const res = await fetch(`${BASE}/bridge/token`);
      return res.ok ? (await res.json()).has_token === true : false;
    }, { timeout: 20_000 })
    .toBe(true);
});

test.afterAll(async () => {
  try { await ctx?.context?.close(); } catch { /* ignore */ }
  try { fs.rmSync(extPath, { recursive: true, force: true }); } catch { /* ignore */ }
  await fixture?.stop();
  await daemon?.stop();
});

test('captures a finished DeepSeek turn and writes it to the real daemon', async () => {
  const { context } = ctx;
  const page = await context.newPage();
  await page.goto(fixture.origin);

  // The content script mounts its floating widget (a collapsed pill inside an
  // open shadow root) once it resolves the adapter — this is the signal that
  // GET_BOOTSTRAP succeeded and the page matched `deepseek`. Playwright's CSS
  // engine pierces open shadow roots, so `.aw-pill` resolves through the host.
  await expect(page.locator('.aw-pill')).toBeVisible({ timeout: 15_000 });

  // Ask a question; the fixture streams an answer then appends the finish signal.
  await page.locator('#chat-input').fill(QUESTION);
  await page.locator('#send-btn').click();

  // The assistant answer + feedback bar appear — the adapter's actionBarAppears
  // finish signal — and the content script auto-captures the turn.
  await expect(page.locator('.ds-message-feedback-container')).toBeVisible({ timeout: 5_000 });

  // Assert the REAL daemon persisted the capture with source=external_chat. The
  // memories table stores the text in a markdown file (not a `content` column),
  // so we match on the title (= question) the adapter set.
  let captured;
  await expect
    .poll(async () => {
      const res = await fetch(`${BASE}/memories?source=external_chat&limit=20`);
      if (!res.ok) return 0;
      const body = await res.json();
      captured = (body.items || []).find((m) => m.title === QUESTION);
      return captured ? 1 : 0;
    }, { timeout: 20_000, intervals: [400, 600, 800] })
    .toBe(1);

  expect(captured.source).toBe('external_chat');
  const meta = JSON.parse(captured.metadata || '{}');
  expect(meta.site).toBe('deepseek');

  // Recall: the full Q&A is retrievable via search and carries both turns.
  const search = await (await fetch(`${BASE}/memories/search?q=${encodeURIComponent('workspace switches')}`)).json();
  const hit = (search.items || []).find((m) => (m.summary || '').includes(QUESTION));
  expect(hit, 'captured turn is recallable via search').toBeTruthy();
  expect(hit.summary).toContain('Q:');
  expect(hit.summary).toContain('A:');

  await page.close();
});

test('inject round-trip: "找相关记忆" reaches the daemon and updates the bar', async () => {
  const { context } = ctx;
  const page = await context.newPage();
  await page.goto(fixture.origin);
  await expect(page.locator('.aw-pill')).toBeVisible({ timeout: 15_000 });

  // The widget defaults to the collapsed pill — expand it to reach the controls.
  await page.locator('.aw-pill').click();
  await expect(page.locator('.aw-bar')).toBeVisible({ timeout: 5_000 });

  // Seed the composer with a topic so the inject query is meaningful.
  await page.locator('#chat-input').fill('external-chat captures workspace switches');
  await page.locator('.aw-find').click();

  // The SW relays INJECT to the real daemon's prompt/inject; the bar must reflect
  // the daemon's answer — either an injectable panel or the explicit no-match
  // label. Both prove the full relay completed without error. (`.aw-panel` /
  // `.aw-label` live in the open shadow root; Playwright's CSS engine pierces it.)
  await expect(async () => {
    const label = (await page.locator('.aw-label').textContent()) || '';
    const hasPanel = await page.locator('.aw-panel').count();
    expect(hasPanel > 0 || /未找到相关记忆|记忆/.test(label)).toBe(true);
  }).toPass({ timeout: 15_000 });

  await page.close();
});
