/**
 * L2 · Rule-pack matching (pure, no browser). Verifies the bundled default
 * rule-pack resolves each of the five supported sites' URLs to the right site
 * entry, and that `isValidRulepack` rejects malformed packs. `matchSite` /
 * `isValidRulepack` are pure functions that never touch chrome.* — safe to
 * import under `node --test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchSite, isValidRulepack, resolveRulepackUrl } from '../src/lib/rulepack.js';
import { DEFAULT_RULEPACK_URL } from '../src/lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulepack = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'rules', 'default-rulepack.json'), 'utf-8'),
);

describe('rule-pack: bundled default is valid', () => {
  it('passes isValidRulepack', () => {
    assert.equal(isValidRulepack(rulepack), true);
  });
  it('rejects malformed packs', () => {
    assert.equal(isValidRulepack(null), false);
    assert.equal(isValidRulepack({ schemaVersion: 1, sites: [] }), false);
    assert.equal(isValidRulepack({ schemaVersion: 2, sites: [{ id: 'x' }] }), false); // no match[]
    assert.equal(isValidRulepack({ schemaVersion: 2 }), false);
  });
});

describe('rule-pack: matchSite resolves each supported site', () => {
  const cases = [
    ['https://chat.deepseek.com/a/chat/s/xyz', 'deepseek'],
    ['https://chatgpt.com/c/abc', 'chatgpt'],
    ['https://chat.openai.com/c/abc', 'chatgpt'],
    ['https://gemini.google.com/app/123', 'gemini'],
    ['https://www.doubao.com/chat/456', 'doubao'],
    ['https://www.kimi.com/chat/789', 'kimi'],
    ['https://kimi.moonshot.cn/chat/789', 'kimi'],
  ];
  for (const [url, id] of cases) {
    it(`${url} → ${id}`, () => {
      const site = matchSite(rulepack, url);
      assert.ok(site, `expected a match for ${url}`);
      assert.equal(site.id, id);
    });
  }

  it('returns null for unsupported sites', () => {
    assert.equal(matchSite(rulepack, 'https://evil.example.com/x'), null);
    assert.equal(matchSite(rulepack, 'not-a-url'), null);
  });

  it('does not suffix-spoof (evildeepseek.com ≠ deepseek.com)', () => {
    assert.equal(matchSite(rulepack, 'https://evildeepseek.com/x'), null);
  });
});

describe('rule-pack: resolveRulepackUrl hot-update semantics', () => {
  it('unconfigured (undefined/null) → canonical default URL', () => {
    assert.equal(resolveRulepackUrl(undefined), DEFAULT_RULEPACK_URL);
    assert.equal(resolveRulepackUrl(null), DEFAULT_RULEPACK_URL);
  });
  it('empty / whitespace string → revert to default', () => {
    assert.equal(resolveRulepackUrl(''), DEFAULT_RULEPACK_URL);
    assert.equal(resolveRulepackUrl('   '), DEFAULT_RULEPACK_URL);
  });
  it('explicit URL → user override wins (trimmed)', () => {
    const custom = 'https://example.com/my-rulepack.json';
    assert.equal(resolveRulepackUrl(custom), custom);
    assert.equal(resolveRulepackUrl(`  ${custom}  `), custom);
  });
  it('non-string junk → falls back to default (never crashes)', () => {
    assert.equal(resolveRulepackUrl(42), DEFAULT_RULEPACK_URL);
    assert.equal(resolveRulepackUrl({}), DEFAULT_RULEPACK_URL);
  });
  it('canonical default points at the auto-synced public SDK repo on main', () => {
    assert.match(
      DEFAULT_RULEPACK_URL,
      /^https:\/\/raw\.githubusercontent\.com\/everest-an\/Awareness-SDK\/main\/browser-extension\/rules\/default-rulepack\.json$/,
    );
  });
});

describe('rule-pack: DeepSeek entry has the stable ds-* anchors', () => {
  it('assistantText targets ds-markdown; input is textarea#chat-input', () => {
    const ds = matchSite(rulepack, 'https://chat.deepseek.com/');
    assert.ok(ds.selectors.assistantText.some((s) => s.includes('ds-markdown')));
    assert.equal(ds.input.selector, 'textarea#chat-input');
    assert.equal(ds.input.injectStrategy, 'nativeValueSetter');
    assert.equal(ds.finishSignal.actionBar, '.ds-message-feedback-container');
  });
});
