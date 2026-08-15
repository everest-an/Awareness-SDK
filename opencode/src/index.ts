// ---------------------------------------------------------------------------
// Awareness Memory — OpenCode plugin entry point.
//
// Modes (mirrors the OpenClaw plugin):
//   1. Cloud   — apiKey + memoryId present (from plugin options or env vars)
//   2. Local   — no apiKey, local daemon at http://localhost:37800
//   3. Setup   — neither reachable → register awareness_setup for device auth
//
// The plugin registers:
//   - custom tools (awareness_init / recall / record / lookup / skills)
//   - an event hook that auto-captures the session summary on session.idle
// ---------------------------------------------------------------------------

import { tool, type Hooks, type Plugin } from "@opencode-ai/plugin";
import { AwarenessClient } from "./client";
import { registerTools } from "./tools";
import { registerHooks } from "./hooks";
import type { PluginConfig } from "./types";

const DEFAULT_BASE_URL = "https://awareness.market/api/v1";
const DEFAULT_LOCAL_URL = "http://localhost:37800";

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveConfig(options: Record<string, unknown> | undefined): PluginConfig {
  const raw = options ?? {};
  const config: PluginConfig = {
    apiKey: String(raw.apiKey ?? ""),
    baseUrl: String(raw.baseUrl ?? DEFAULT_BASE_URL),
    memoryId: String(raw.memoryId ?? ""),
    agentRole: String(raw.agentRole ?? "builder_agent"),
    autoRecall: raw.autoRecall !== undefined ? Boolean(raw.autoRecall) : true,
    autoCapture: raw.autoCapture !== undefined ? Boolean(raw.autoCapture) : true,
    recallLimit: raw.recallLimit !== undefined ? Number(raw.recallLimit) : 8,
    localUrl: String(raw.localUrl ?? DEFAULT_LOCAL_URL),
    captureMinTurns: raw.captureMinTurns !== undefined ? Number(raw.captureMinTurns) : undefined,
  };

  // Environment variables take priority (for serverless/CI deployments)
  if (process.env.AWARENESS_API_KEY) config.apiKey = process.env.AWARENESS_API_KEY;
  if (process.env.AWARENESS_MEMORY_ID) config.memoryId = process.env.AWARENESS_MEMORY_ID;
  if (process.env.AWARENESS_BASE_URL) config.baseUrl = process.env.AWARENESS_BASE_URL;
  if (process.env.AWARENESS_AGENT_ROLE) config.agentRole = process.env.AWARENESS_AGENT_ROLE;
  if (process.env.AWARENESS_LOCAL_URL) config.localUrl = process.env.AWARENESS_LOCAL_URL;

  return config;
}

// ---------------------------------------------------------------------------
// Setup mode — when neither cloud credentials nor a local daemon is present
// ---------------------------------------------------------------------------

function registerSetupTool(config: PluginConfig) {
  return {
    awareness_setup: tool({
      description:
        "Awareness Memory is not configured. Call with action='start_auth' to begin " +
        "browser device-auth, or with no arguments for full setup instructions.",
      args: {
        action: tool.schema.string().optional().describe("'start_auth' to begin device auth flow"),
      },
      async execute(args) {
        if (args.action === "start_auth") {
          try {
            const resp = await fetch(`${config.baseUrl}/auth/device/init`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ client_id: "opencode-plugin" }),
              signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) {
              return { output: JSON.stringify({ status: "error", message: `Device auth init failed: ${resp.status}` }) };
            }
            const data = (await resp.json()) as Record<string, unknown>;
            const userCode = String(data.user_code ?? "");
            const verificationUri = String(data.verification_uri ?? "https://awareness.market/cli-auth");
            return {
              output: JSON.stringify(
                {
                  status: "pending",
                  auth_url: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
                  user_code: userCode,
                  message:
                    `Open this link in a browser and approve: ${verificationUri}?code=${encodeURIComponent(userCode)}\n` +
                    `After approving, set these env vars (or plugin options) and restart opencode:\n` +
                    `  AWARENESS_API_KEY=<your aw_ key>\n` +
                    `  AWARENESS_MEMORY_ID=<your memory id>\n` +
                    `  AWARENESS_BASE_URL=${config.baseUrl}`,
                },
                null,
                2,
              ),
            };
          } catch (err) {
            return { output: JSON.stringify({ status: "error", message: `Device auth start failed: ${String(err)}` }) };
          }
        }

        return {
          output: JSON.stringify(
            {
              status: "not_configured",
              setup_options: [
                {
                  method: "Cloud (recommended)",
                  steps: [
                    "1. Sign in at https://awareness.market",
                    "2. Copy your API key (aw_ prefix) and a Memory ID from the dashboard",
                    "3. Set env vars AWARENESS_API_KEY and AWARENESS_MEMORY_ID, or pass them as plugin options",
                    "4. Restart opencode",
                  ],
                },
                {
                  method: "Local daemon (privacy-first, offline)",
                  command: "npx @awareness-sdk/local start",
                  description: "Memory stays on your machine. No account needed.",
                },
              ],
            },
            null,
            2,
          ),
        };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export const awarenessPlugin: Plugin = async (input, options) => {
  const config = resolveConfig(options);
  const hooks: Hooks = {};

  if (config.apiKey && config.memoryId) {
    // Cloud mode
    const client = new AwarenessClient(config.baseUrl, config.apiKey, config.memoryId, config.agentRole);
    hooks.tool = registerTools(client);
    const eventHooks = registerHooks(client, config, input.client);
    if (eventHooks.event) hooks.event = eventHooks.event;
    return hooks;
  }

  // Local daemon mode
  const client = new AwarenessClient(
    `${config.localUrl}/api/v1`,
    "",
    config.memoryId || "local",
    config.agentRole,
  );
  hooks.tool = registerTools(client);
  const eventHooks = registerHooks(client, config, input.client);
  if (eventHooks.event) hooks.event = eventHooks.event;

  const hasEnvCreds = Boolean(process.env.AWARENESS_API_KEY && process.env.AWARENESS_MEMORY_ID);
  if (!hasEnvCreds) {
    // Best-effort background daemon health-check; fall back to setup mode.
    void (async () => {
      let running = false;
      try {
        const resp = await fetch(`${config.localUrl}/healthz`, { signal: AbortSignal.timeout(2000) });
        running = resp.ok;
      } catch {
        running = false;
      }
      if (!running) {
        hooks.tool = { ...(hooks.tool ?? {}), ...registerSetupTool(config) };
      }
    })();
  }

  return hooks;
};

export default awarenessPlugin;
export { AwarenessClient } from "./client";
export { registerTools } from "./tools";
export { registerHooks } from "./hooks";
export type { PluginConfig } from "./types";
