import { defineConfig } from '@playwright/test';

/**
 * F-064 Phase 3 · Extension E2E (zero mock).
 *
 * Loads the UNPACKED extension into a real Chromium persistent context and
 * drives it against a REAL Awareness daemon (spawned per-spec on port 37800 —
 * the port the extension hard-codes). No `page.route`, no HAR — the only
 * non-production surface is a local DeepSeek DOM fixture standing in for the
 * chat site we cannot log into in CI (the daemon itself is 100% real).
 *
 * MV3 extensions need a headed context (or Chromium's new headless). Set
 * HEADLESS=1 to try the new headless path locally.
 */
export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  // Daemon + extension + fixture server are all managed inside the specs so we
  // can control the project dir and recall afterward — no global webServer.
});
