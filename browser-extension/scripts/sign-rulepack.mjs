#!/usr/bin/env node
/**
 * F-085 (T4) · Rule-pack signing CLI — the publish-side counterpart to the
 * extension's verify-before-apply (src/lib/rulepack.js `verifyRulepackSignature`).
 *
 * Ed25519 detached signatures over the EXACT rule-pack bytes. Signatures are
 * produced with node:crypto and verify under Web Crypto in the MV3 service
 * worker (both are standard 64-byte Ed25519 — interoperable; the interop test
 * proves it).
 *
 * ── One-time key setup ──────────────────────────────────────────────────────
 *   node scripts/sign-rulepack.mjs genkey
 *     → prints PUBLIC_KEY_B64 (paste into src/lib/rulepack.js RULEPACK_PUBLIC_KEY_B64)
 *     → writes the PRIVATE key (PKCS8 PEM) to ./rulepack-signing-key.pem
 *       ⚠️  MOVE it to your secret store (CI secret / keychain). NEVER commit it.
 *           It is already covered by .gitignore in this folder.
 *
 * ── Each publish ────────────────────────────────────────────────────────────
 *   AWARENESS_RULEPACK_SIGNING_KEY=/path/key.pem \
 *     node scripts/sign-rulepack.mjs sign rules/default-rulepack.json
 *     → writes rules/default-rulepack.json.sig  (base64 detached signature)
 *     Upload BOTH the .json and the .json.sig next to each other; the extension
 *     fetches `<url>.sig` and verifies before applying.
 *
 * ── Verify locally ──────────────────────────────────────────────────────────
 *   node scripts/sign-rulepack.mjs verify rules/default-rulepack.json <PUBLIC_KEY_B64>
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Raw 32-byte Ed25519 public key (base64) — the form the extension importKey('raw') wants. */
function rawPublicKeyB64(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' }); // jwk.x = base64url of the 32 raw bytes
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function loadPrivateKey() {
  const keyPath = process.env.AWARENESS_RULEPACK_SIGNING_KEY;
  if (!keyPath) {
    fail('Set AWARENESS_RULEPACK_SIGNING_KEY=/path/to/private-key.pem');
  }
  if (!fs.existsSync(keyPath)) fail(`Signing key not found: ${keyPath}`);
  return crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
}

function fail(msg) {
  console.error(`[sign-rulepack] ${msg}`);
  process.exit(1);
}

function cmdGenkey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubB64 = rawPublicKeyB64(publicKey);
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const outPath = path.resolve('rulepack-signing-key.pem');
  fs.writeFileSync(outPath, pem, { mode: 0o600 });
  console.log('Ed25519 keypair generated.\n');
  console.log('PUBLIC_KEY_B64 (paste into src/lib/rulepack.js RULEPACK_PUBLIC_KEY_B64):');
  console.log(`  ${pubB64}\n`);
  console.log(`PRIVATE key written to: ${outPath}`);
  console.log('  ⚠️  Move it to your secret store (CI secret / keychain). NEVER commit it.');
}

function cmdSign(file) {
  if (!file) fail('usage: sign <rulepack.json>');
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) fail(`Rule-pack not found: ${abs}`);
  const raw = fs.readFileSync(abs); // exact bytes — must match what the fetcher reads
  const privateKey = loadPrivateKey();
  const sig = crypto.sign(null, raw, privateKey); // Ed25519 → 64-byte signature
  const sigB64 = sig.toString('base64');
  const sigPath = `${abs}.sig`;
  fs.writeFileSync(sigPath, sigB64 + '\n');
  console.log(`Signed → ${sigPath}`);
  console.log(`  ${sigB64}`);
}

function cmdVerify(file, pubB64) {
  if (!file || !pubB64) fail('usage: verify <rulepack.json> <PUBLIC_KEY_B64>');
  const abs = path.resolve(file);
  const raw = fs.readFileSync(abs);
  const sigPath = `${abs}.sig`;
  if (!fs.existsSync(sigPath)) fail(`Missing signature: ${sigPath}`);
  const sig = Buffer.from(fs.readFileSync(sigPath, 'utf8').trim(), 'base64');
  const spkiDer = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), // Ed25519 SPKI prefix
    Buffer.from(pubB64, 'base64'),
  ]);
  const publicKey = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  const ok = crypto.verify(null, raw, publicKey, sig);
  console.log(ok ? 'VALID ✓' : 'INVALID ✗');
  process.exit(ok ? 0 : 1);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'genkey': cmdGenkey(); break;
  case 'sign': cmdSign(args[0]); break;
  case 'verify': cmdVerify(args[0], args[1]); break;
  default:
    console.log('usage: sign-rulepack.mjs <genkey|sign <file>|verify <file> <pubB64>>');
    process.exit(cmd ? 1 : 0);
}
