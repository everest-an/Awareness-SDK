const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let telemetry;

test.before(async () => {
  telemetry = await import("../src/telemetry.mjs");
});

test("telemetryEnabled defaults on and honours explicit opt-out", () => {
  assert.equal(telemetry.telemetryEnabled({}), true);
  assert.equal(telemetry.telemetryEnabled({ AWARENESS_TELEMETRY: "1" }), true);
  for (const value of ["0", "false", "no", "off", "OFF"]) {
    assert.equal(telemetry.telemetryEnabled({ AWARENESS_TELEMETRY: value }), false);
  }
});

test("buildSetupCompletedEvent only emits whitelisted properties", () => {
  const event = telemetry.buildSetupCompletedEvent({
    mode: "local",
    ides: ["cursor", "claude-code", "codex", "windsurf", "cline"],
    version: "0.6.1",
    installation: "setup-test-1234",
    now: new Date("2026-11-25T00:00:00Z"),
  });

  assert.equal(event.event_type, "onboarding_completed");
  assert.equal(event.installation_id, "setup-test-1234");
  assert.equal(event.timestamp, "2026-11-25T00:00:00.000Z");
  assert.equal(event.properties.step_name, "setup_cli");
  assert.equal(event.properties.tool_name, "setup");
  assert.equal(event.properties.success, 1);
  assert.equal(event.properties.mode, "local");
  assert.equal(event.properties.step_number, 5);
  assert.equal(event.properties.scope, "cursor,claude-code,codex,windsurf");
  assert.equal(event.properties.daemon_version, "0.6.1");
  assert.ok(event.properties.node_version.startsWith("v"));
  assert.ok(event.properties.os.includes("-"));
  assert.ok(!("secret" in event.properties));
});

test("sendSetupCompleted posts to the telemetry endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  const result = await telemetry.sendSetupCompleted({
    mode: "cloud",
    ides: ["cursor"],
    version: "0.6.1",
    fetchImpl,
    env: {
      AWARENESS_TELEMETRY_ENDPOINT: "https://example.test/api/v1",
      AWARENESS_INSTALLATION_ID: "setup-test-1234",
    },
  });

  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.test/api/v1/telemetry/events");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].properties.mode, "cloud");
  assert.equal(body.events[0].properties.scope, "cursor");
});

test("sendSetupCompleted is silent when disabled or opted out", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200 };
  };

  const disabled = await telemetry.sendSetupCompleted({ disabled: true, fetchImpl });
  assert.equal(disabled.sent, false);
  assert.equal(disabled.reason, "disabled");

  const optedOut = await telemetry.sendSetupCompleted({
    fetchImpl,
    env: { AWARENESS_TELEMETRY: "0", AWARENESS_INSTALLATION_ID: "setup-test-1234" },
  });
  assert.equal(optedOut.sent, false);
  assert.equal(optedOut.reason, "disabled");
  assert.equal(calls, 0);
});

test("sendSetupCompleted swallows network failures", async () => {
  const result = await telemetry.sendSetupCompleted({
    fetchImpl: async () => {
      throw new Error("offline");
    },
    env: {
      AWARENESS_TELEMETRY_ENDPOINT: "https://example.test/api/v1",
      AWARENESS_INSTALLATION_ID: "setup-test-1234",
    },
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "network");
});

test("installationId persists an anonymous id under ~/.awareness", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "awareness-setup-tel-"));
  const first = telemetry.installationId({ homeDir, env: {} });
  const second = telemetry.installationId({ homeDir, env: {} });
  assert.equal(first, second);
  assert.ok(first.startsWith("setup-"));
  assert.ok(fs.existsSync(path.join(homeDir, ".awareness", "setup-installation-id")));
  fs.rmSync(homeDir, { recursive: true, force: true });
});
