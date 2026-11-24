/**
 * L2 · F-111 web page capture — extraction and payload shape.
 *
 * The extractor runs in the page, so it is written as a self-contained function
 * over a Document. These tests drive it with a fake document: no DOM library, no
 * network, and the same code path the extension injects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PAGE_CHARS,
  cleanPageText,
  buildPageContent,
  extractPageText,
} from '../src/lib/page-extract.js';

function fakeDoc({ title = 'Page title', href = 'https://example.com/a', article = '', main = '', body = '' }) {
  const node = (text) => ({ innerText: text, textContent: text });
  return {
    title,
    location: { href },
    querySelector(sel) {
      if (sel === 'article' && article) return node(article);
      if (sel === 'main' && main) return node(main);
      if (sel === '[role="main"]') return null;
      return null;
    },
    body: node(body),
  };
}

test('cleanPageText normalises CRLF, trailing spaces and blank-line runs', () => {
  const input = 'A  \r\nB\r\n\r\n\r\n\r\nC\t \n';
  assert.equal(cleanPageText(input), 'A\nB\n\nC');
});

test('cleanPageText never throws on non-strings', () => {
  assert.equal(cleanPageText(undefined), '');
  assert.equal(cleanPageText(null), '');
  assert.equal(cleanPageText(42), '42');
});

test('MAX_PAGE_CHARS matches the cap baked into the injected function', () => {
  // extractPageText is serialized into the page and cannot close over module
  // scope, so its 20000 literal must stay in sync with this constant.
  assert.equal(MAX_PAGE_CHARS, 20000);
});

test('extractPageText prefers <article> over <main> and body', () => {
  const page = extractPageText(fakeDoc({ article: 'Article body', main: 'Main body', body: 'Body text' }));
  assert.equal(page.text, 'Article body');
  assert.equal(page.title, 'Page title');
  assert.equal(page.url, 'https://example.com/a');
});

test('extractPageText falls back to <main> then body', () => {
  assert.equal(extractPageText(fakeDoc({ main: 'Main body', body: 'Body text' })).text, 'Main body');
  assert.equal(extractPageText(fakeDoc({ body: 'Body text' })).text, 'Body text');
});

test('extractPageText trims the title and caps the body', () => {
  const page = extractPageText(fakeDoc({ title: '   Padded   ', article: 'x'.repeat(MAX_PAGE_CHARS + 500) }));
  assert.equal(page.title, 'Padded');
  assert.equal(page.text.length, MAX_PAGE_CHARS + 1); // + the ellipsis
  assert.ok(page.text.endsWith('…'));
});

test('buildPageContent keeps the source URL and a heading', () => {
  const out = buildPageContent({ title: 'Doc', url: 'https://example.com/x', text: 'hello' });
  assert.ok(out.startsWith('# Doc\nhttps://example.com/x\n\nhello'));
});

test('buildPageContent falls back to the URL when the title is empty', () => {
  const out = buildPageContent({ title: '', url: 'https://example.com/x', text: 'hello' });
  assert.ok(out.startsWith('# https://example.com/x'));
});
