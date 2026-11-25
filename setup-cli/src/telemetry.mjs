/**
 * Setup CLI telemetry — anonymous, opt-out, fire-and-forget.
 *
 * Reuses the daemon's existing whitelisted event type (`onboarding_completed`)
 * and the F-040 ingestion endpoint, so no server schema changes are needed.
 * The event answers one question: did a free-tool visitor actually complete
 * setup? Properties are limited to whitelisted keys (ides count / scope, mode,
 * versions, platform).
 *
 * Opt-out: AWARENESS_TELEMETRY=0/false/no/off or --no-telemetry.
 * Network sends are disabled during `node --test` against the production
 * endpoint (structural guard mirroring the daemon telemetry module).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_ENDPOINT = 'https://awareness.market/api/v1';
const IS_TEST_RUN = Boolean(process.env.NODE_TEST_CONTEXT);
const EVENT_TYPE = 'onboarding_completed';

export function telemetryEnabled(env = process.env) {
  const value = String(env.AWARENESS_TELEMETRY ?? '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

export function telemetryEndpoint(env = process.env) {
  return String(env.AWARENESS_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '');
}

export function readSetupVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function installationId({ homeDir = os.homedir(), env = process.env } = {}) {
  if (env.AWARENESS_INSTALLATION_ID) return String(env.AWARENESS_INSTALLATION_ID);
  const dir = path.join(homeDir, '.awareness');
  const file = path.join(dir, 'setup-installation-id');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 8) return existing;
  } catch {
    /* first run */
  }
  const id = 'setup-' + crypto.randomBytes(12).toString('hex');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, id + '\n', { mode: 0o600 });
  } catch {
    /* best-effort persistence */
  }
  return id;
}

export function buildSetupCompletedEvent({
  mode = 'local',
  ides = [],
  version = '0.0.0',
  installation = 'setup-unknown',
  now = new Date(),
}) {
  const safeIdes = Array.isArray(ides) ? ides.filter((item) => typeof item === 'string') : [];
  return {
    event_type: EVENT_TYPE,
    installation_id: installation,
    timestamp: now.toISOString(),
    properties: {
      step_name: 'setup_cli',
      tool_name: 'setup',
      success: 1,
      mode,
      step_number: safeIdes.length,
      scope: safeIdes.slice(0, 4).join(',').slice(0, 100),
      daemon_version: version,
      node_version: process.version,
      os: `${os.platform()}-${os.arch()}`,
    },
  };
}

export async function sendSetupCompleted({
  mode = 'local',
  ides = [],
  version = '0.0.0',
  disabled = false,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 1500,
  now = new Date(),
} = {}) {
  if (disabled || !telemetryEnabled(env)) return { sent: false, reason: 'disabled' };
  const endpoint = telemetryEndpoint(env);
  if (IS_TEST_RUN && endpoint === DEFAULT_ENDPOINT) {
    return { sent: false, reason: 'test_guard' };
  }

  const event = buildSetupCompletedEvent({
    mode,
    ides,
    version,
    installation: installationId({ env }),
    now,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint}/telemetry/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [event] }),
      signal: controller.signal,
    });
    return { sent: Boolean(response?.ok), reason: response?.ok ? null : `http_${response?.status ?? 'unknown'}` };
  } catch {
    return { sent: false, reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
