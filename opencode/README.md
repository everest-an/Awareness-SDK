# @awareness.market/opencode-plugin

[![LongMemEval R@5](https://img.shields.io/badge/LongMemEval_R%405-96.0%25-brightgreen)](https://arxiv.org/abs/2410.10813) [![Discord](https://img.shields.io/discord/1354000000000000000?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.com/invite/nMDrT538Qa)

Persistent cross-session memory for [OpenCode](https://opencode.ai) via [Awareness](https://awareness.market). Local-first — works offline, no account needed.

Gives OpenCode a long-term memory that survives across sessions — no more forgetting what was built, repeating architectural decisions, or losing track of open TODOs.

## What it does

- **Auto-capture** — when a session goes idle, the plugin stores a concise summary of the session into Awareness. Enterprise developer activity automatically becomes searchable memory.
- **Awareness tools** — registers `awareness_init`, `awareness_recall`, `awareness_record`, `awareness_lookup`, `awareness_apply_skill`, `awareness_mark_skill_used` as native opencode tools (no MCP config required).
- **Cloud or local** — works against the Awareness cloud (`aw_` API key) or a local daemon (`npx @awareness-sdk/local start`).

## Install

```bash
# Global config
# add to ~/.config/opencode/opencode.json:

{
  "plugin": ["@awareness.market/opencode-plugin"]
}
```

Then configure credentials (see below) and restart opencode.

## Configure

### Cloud (recommended)

```json
{
  "plugin": [
    ["@awareness.market/opencode-plugin", {
      "apiKey": "aw_your-api-key",
      "memoryId": "your-memory-id",
      "baseUrl": "https://awareness.market/api/v1",
      "agentRole": "builder_agent",
      "autoCapture": true,
      "recallLimit": 8
    }]
  ]
}
```

Or via environment variables (highest priority — good for CI/serverless):

```bash
export AWARENESS_API_KEY="aw_..."
export AWARENESS_MEMORY_ID="your-memory-id"
export AWARENESS_BASE_URL="https://awareness.market/api/v1"
export AWARENESS_AGENT_ROLE="builder_agent"
```

Get your API key and Memory ID from the [Awareness Dashboard](https://awareness.market/dashboard).

### Local (privacy-first, offline, no account)

```bash
npx @awareness-sdk/local start
```

The plugin auto-detects the daemon at `http://localhost:37800`. Memory stays on your machine. No credentials needed.

### One-command setup

When configured with neither credentials nor a reachable daemon, the plugin registers an `awareness_setup` tool. Ask the agent to "set up memory" and it will start a browser device-auth flow.

## Configuration reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | `""` | Awareness API key (`aw_` prefix) |
| `memoryId` | string | `""` | Target memory UUID |
| `baseUrl` | string | `https://awareness.market/api/v1` | Cloud API base URL |
| `agentRole` | string | `builder_agent` | Agent role for scoped recall |
| `autoCapture` | boolean | `true` | Auto-store a session summary on idle |
| `recallLimit` | integer | `8` | Max results for recall |

## Available tools

| Tool | Description |
|------|-------------|
| `__awareness_workflow__` | Step-by-step checklist for the memory workflow |
| `awareness_init` | Load cross-session project memory and context |
| `awareness_recall` | Semantic + keyword hybrid recall |
| `awareness_lookup` | Structured data: tasks, knowledge, risks, timeline |
| `awareness_record` | Write events with optional structured insights |
| `awareness_apply_skill` | Execute a learned skill |
| `awareness_mark_skill_used` | Report skill outcome (closes the learning loop) |

## Skills (optional)

The package bundles guided-workflow skills under `skills/`. Copy them into your project and register:

```bash
cp -r node_modules/@awareness.market/opencode-plugin/skills/* .opencode/skills/
```

Then add `"skills": { "paths": [".opencode/skills"] }` to `opencode.json` (see `opencode.json.example`).

Skills: `setup` · `session-start` · `recall` · `save` · `done`.

## MCP (optional)

The plugin already registers the tools — but if you prefer the MCP path, see `opencode.json.example` for a remote-MCP config pointing at `https://awareness.market/mcp` (cloud) or `http://localhost:37800/mcp` (local daemon).

## What makes Awareness different

- **Hybrid retrieval** — BM25 + vector + knowledge-graph 1-hop, fused with RRF. 96.0% R@5 on LongMemEval, zero LLM calls on the retrieval side.
- **Salience-aware extraction** — cards self-scored on `novelty`/`durability`/`specificity`; low-signal cards dropped server-side.
- **Project isolation** — memory scoped per project/workspace, so work memory doesn't leak into personal memory.
- **Zero-LLM backend** — extraction runs on the agent's LLM; the backend is a coordinator + storage layer.
- **One memory, many clients** — same memory reachable via OpenCode, Claude Code, OpenClaw, npm/pip SDKs, and a plain MCP server.

## License

Apache-2.0
