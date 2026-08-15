---
name: awareness-setup
description: Configure Awareness Memory for opencode. Use when memory tools report "not_configured", when the user wants to enable cross-session memory, or on first install.
---

# Awareness Memory Setup

Link this opencode install to an Awareness memory so the agent remembers across sessions.

## Cloud (recommended)

1. Sign in at https://awareness.market
2. Copy your API key (starts with `aw_`) and a Memory ID from the dashboard
3. Configure via plugin options in `opencode.json`:

```json
{
  "plugin": [
    ["@awareness.market/opencode-plugin", {
      "apiKey": "aw_...",
      "memoryId": "your-memory-id",
      "baseUrl": "https://awareness.market/api/v1",
      "agentRole": "builder_agent"
    }]
  ]
}
```

Or set environment variables (highest priority):

```bash
export AWARENESS_API_KEY="aw_..."
export AWARENESS_MEMORY_ID="your-memory-id"
export AWARENESS_BASE_URL="https://awareness.market/api/v1"
```

## Local (privacy-first, offline, no account)

```bash
npx @awareness-sdk/local start
```

The plugin auto-detects the local daemon at http://localhost:37800. Memory stays on your machine.

After configuring, restart opencode. Then run `/awareness-session-start` to load context.
