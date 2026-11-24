/**
 * L1/L2 · Rule-pack composer fallbacks (0.3.1 regression guard).
 *
 * Doubao swapped its <textarea> composer for a contenteditable editor and the
 * extension silently stopped working there: the single `input.selector` never
 * matched, so the floating pill never mounted. Two things must stay true:
 *
 *   1. The bundled rule-pack declares well-formed fallback candidates, each with
 *      an inject strategy from the enum the content script can execute.
 *   2. The content script resolves the composer through the fallback chain
 *      (not just the primary selector) wherever it reads or writes the composer.
 *
 * This is a static contract test on purpose: content.js is a classic content
 * script (not an ES module), so it can't be imported into node:test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rulepack = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'default-rulepack.json'), 'utf-8'));
const contentJs = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf-8');

const STRATEGIES = new Set(['nativeValueSetter', 'execCommandInsertText']);

test('every site declares a usable primary composer selector + strategy', () => {
  for (const site of rulepack.sites) {
    assert.equal(typeof site.input?.selector, 'string', `${site.id}: input.selector`);
    assert.ok(site.input.selector.length > 0, `${site.id}: input.selector empty`);
    assert.ok(
      STRATEGIES.has(site.input.injectStrategy),
      `${site.id}: unknown injectStrategy ${site.input.injectStrategy}`
    );
  }
});

test('fallback candidates are well-formed and carry a valid strategy', () => {
  for (const site of rulepack.sites) {
    const fallbacks = site.input?.fallbacks;
    if (fallbacks === undefined) continue;
    assert.ok(Array.isArray(fallbacks), `${site.id}: input.fallbacks must be an array`);
    for (const fb of fallbacks) {
      const selector = typeof fb === 'string' ? fb : fb?.selector;
      assert.equal(typeof selector, 'string', `${site.id}: fallback selector must be a string`);
      assert.ok(selector.length > 0, `${site.id}: empty fallback selector`);
      const strategy = typeof fb === 'string' ? site.input.injectStrategy : fb.injectStrategy;
      assert.ok(STRATEGIES.has(strategy), `${site.id}: fallback strategy ${strategy} not executable`);
    }
  }
});

test('doubao routes a contenteditable fallback (site rebuilt its composer)', () => {
  const doubao = rulepack.sites.find((s) => s.id === 'doubao');
  assert.ok(doubao, 'doubao missing from rulepack');
  const selectors = (doubao.input.fallbacks || []).map((f) => (typeof f === 'string' ? f : f.selector));
  assert.ok(
    selectors.some((s) => s.includes('contenteditable')),
    'doubao needs a contenteditable fallback'
  );
  const strategies = (doubao.input.fallbacks || []).map((f) =>
    typeof f === 'string' ? doubao.input.injectStrategy : f.injectStrategy
  );
  assert.ok(
    strategies.includes('execCommandInsertText'),
    'a contenteditable composer cannot be filled with the native value setter'
  );
});

test('content script resolves the composer through the fallback chain', () => {
  assert.match(contentJs, /function resolveInput\s*\(/, 'resolveInput() helper was removed');
  assert.match(contentJs, /input\.fallbacks/, 'content.js no longer reads input.fallbacks');

  // The three places that touch the composer must go through resolveInput().
  const uses = contentJs.match(/resolveInput\(\)/g) || [];
  assert.ok(uses.length >= 3, `expected >=3 resolveInput() call sites, found ${uses.length}`);
  assert.doesNotMatch(
    contentJs,
    /qFirst\(\[SITE\.input\.selector\]\)/,
    'a direct SITE.input.selector lookup bypasses the fallback chain'
  );
});
