/**
 * L2 · Side-panel state machine (pure). Covers the four user-visible states.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialState, reduce, messageFor, TABS } from '../src/lib/panel-state.js';

test('initial state is idle on the cards tab', () => {
  const s = initialState();
  assert.equal(s.status, 'idle');
  assert.equal(s.tab, 'cards');
  assert.deepEqual(s.items, []);
});

test('LOAD_START → LOAD_OK transitions to ready', () => {
  let s = initialState();
  s = reduce(s, { type: 'LOAD_START' });
  assert.equal(s.status, 'loading');
  s = reduce(s, { type: 'LOAD_OK', items: [{ id: '1', body: 'x' }] });
  assert.equal(s.status, 'ready');
  assert.equal(s.items.length, 1);
});

test('an empty result set is "empty", not "ready"', () => {
  let s = reduce(initialState(), { type: 'LOAD_START' });
  s = reduce(s, { type: 'LOAD_OK', items: [] });
  assert.equal(s.status, 'empty');
  assert.match(messageFor(s), /没有找到|空的/);
});

test('UNAUTHORIZED clears data and explains the CTA', () => {
  let s = reduce(initialState(), { type: 'LOAD_OK', items: [{ id: '1' }] });
  s = reduce(s, { type: 'UNAUTHORIZED' });
  assert.equal(s.status, 'unauthorized');
  assert.deepEqual(s.items, []);
  assert.match(messageFor(s), /连接 Awareness/);
});

test('LOAD_ERR carries the error text', () => {
  const s = reduce(initialState(), { type: 'LOAD_ERR', error: 'http_502' });
  assert.equal(s.status, 'error');
  assert.match(messageFor(s), /http_502/);
});

test('SELECT / CLEAR_SELECT drive the detail view', () => {
  const item = { id: '1', body: 'hello' };
  let s = reduce(initialState(), { type: 'SELECT', item });
  assert.deepEqual(s.selected, item);
  s = reduce(s, { type: 'CLEAR_SELECT' });
  assert.equal(s.selected, null);
});

test('SET_TAB ignores unknown tabs and clears selection on valid ones', () => {
  let s = reduce(initialState(), { type: 'SELECT', item: { id: '1' } });
  s = reduce(s, { type: 'SET_TAB', tab: 'nope' });
  assert.equal(s.tab, 'cards');

  s = reduce(s, { type: 'SET_TAB', tab: 'timeline' });
  assert.equal(s.tab, 'timeline');
  assert.equal(s.selected, null);
  assert.ok(TABS.includes(s.tab));
});

test('RESET keeps the current tab but drops data', () => {
  let s = reduce(initialState(), { type: 'SET_TAB', tab: 'timeline' });
  s = reduce(s, { type: 'LOAD_OK', items: [{ id: '1' }] });
  s = reduce(s, { type: 'RESET' });
  assert.equal(s.tab, 'timeline');
  assert.equal(s.status, 'idle');
  assert.deepEqual(s.items, []);
});
