<p align="center">
  <img src="assets/awareness-wordmark.svg" alt="Awareness SDK — Persistent Memory for AI Agents" width="760"/>
</p>

<p align="center">
  <img src="assets/local-20s.gif" alt="Awareness — Long-Term Memory for AI Agents" width="100%"/>
</p>

<p align="center">
  <a href="https://awareness.market/"><img src="https://img.shields.io/badge/Website-awareness.market-0EA5E9?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Website"/></a>
  <a href="https://awareness.market/docs"><img src="https://img.shields.io/badge/Docs-awareness.market%2Fdocs-14B8A6?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Docs"/></a>
  <a href="https://pypi.org/project/awareness-memory-cloud/"><img src="https://img.shields.io/badge/PyPI-awareness--memory--cloud-00D4FF?style=for-the-badge&logo=pypi&logoColor=white" alt="PyPI"/></a>
  <a href="https://www.npmjs.com/package/@awareness-sdk/memory-cloud"><img src="https://img.shields.io/badge/npm-memory--cloud-7B68EE?style=for-the-badge&logo=npm&logoColor=white" alt="npm memory cloud"/></a>
  <a href="https://www.npmjs.com/package/@awareness-sdk/local"><img src="https://img.shields.io/badge/npm-local-22C55E?style=for-the-badge&logo=npm&logoColor=white" alt="npm local"/></a>
  <a href="https://discord.com/invite/nMDrT538Qa"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-2563EB?style=for-the-badge" alt="License Apache 2.0"/></a>
</p>

<p align="center">
  <strong>Give your AI agent persistent memory across sessions.</strong><br/>
  Local-first MCP memory platform for AI coding agents, SDK apps, and production workflows.<br/>
  <a href="https://awareness.market/docs">Docs</a> · <a href="https://awareness.market">Cloud</a> · <a href="https://discord.com/invite/nMDrT538Qa">Discord</a> · <a href="#quick-start">Quick Start</a>
</p>

---

## Why Awareness?

AI agents forget everything when a session ends. Your agent spent hours making architectural decisions, fixing bugs, and planning next steps — and the next session starts from zero.

**Awareness gives your AI agent persistent memory** — it remembers what it built, what it decided, what's still pending, and why.

### How It Works

```
Session 1: Agent makes decisions, fixes bugs, creates TODOs
    → awareness_record() saves everything as structured knowledge

Session 2: Agent starts fresh
    → awareness_init() loads context: "Last time you were working on JWT auth..."
    → awareness_recall() finds relevant past decisions
    → Agent picks up where it left off — no re-explaining needed
```

---

## Quick Start

### Option 1: One Command Setup (Recommended)

Works with **Claude Code, Cursor, Windsurf, Cline, GitHub Copilot, Codex, and 7 more IDEs**.

```bash
npx @awareness-sdk/setup
```

That's it. Your AI agent now has persistent memory. No account needed. Works offline.

Want cloud features later? `npx @awareness-sdk/setup --cloud`

### Option 2: Zero-Code Interceptor (Python/TypeScript SDK)

**The fastest way to add memory to existing AI apps.** One line — zero code changes.

#### Python — `AwarenessInterceptor.wrap_openai()` / `.wrap_anthropic()`

```bash
pip install awareness-memory-cloud
```

```python
from openai import OpenAI
from memory_cloud import AwarenessInterceptor

client = OpenAI()

# Local mode (no API key needed — data stays on your machine)
interceptor = AwarenessInterceptor(mode="local")

# Cloud mode (team collaboration, semantic search, multi-device sync)
interceptor = AwarenessInterceptor(api_key="aw_...", memory_id="...")

# One line — all conversations automatically remembered
interceptor.wrap_openai(client)

# Use OpenAI as normal — memory happens in the background
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Refactor the auth module"}]
)
```

#### TypeScript — `AwarenessInterceptor.wrapOpenAI()` / `.wrapAnthropic()`

```bash
npm install @awareness-sdk/memory-cloud
```

```typescript
import OpenAI from "openai";
import { AwarenessInterceptor } from "@awareness-sdk/memory-cloud";

const openai = new OpenAI();

// Local mode (no API key needed — data stays on your machine)
const interceptor = new AwarenessInterceptor({ mode: "local" });

// Cloud mode (team collaboration, semantic search, multi-device sync)
const interceptor = new AwarenessInterceptor({ apiKey: "aw_...", memoryId: "..." });

// One line — all conversations automatically remembered
interceptor.wrapOpenAI(openai);

// Use as normal — memory happens in the background
const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "What did we decide about the database?" }],
});
```

### Option 3: IDE Plugins

#### Claude Code

```bash
/plugin marketplace add edwin-hao-ai/Awareness-SDK
/plugin install awareness-memory@awareness
```

Skills: `/awareness-memory:session-start` · `/awareness-memory:recall` · `/awareness-memory:save` · `/awareness-memory:done`

[Documentation](claudecode/README.md) · [Online docs](https://awareness.market/docs?doc=ide-plugins)

#### OpenClaw

```bash
# Plugin (full integration):
openclaw plugins install @awareness-sdk/openclaw-memory

# Or Skill (via ClawHub):
npx clawhub@latest install awareness-memory
```

Auto-recall on session start. Auto-capture on session end. Zero configuration.

[Documentation](openclaw/README.md) · [npm](https://www.npmjs.com/package/@awareness-sdk/openclaw-memory)

---

## Features

| Feature | Local | + Cloud |
|---------|-------|---------|
| Persistent memory across sessions | ✅ | ✅ |
| 13+ IDE support (Claude Code, Cursor, Windsurf...) | ✅ | ✅ |
| Zero-code interceptor (`wrap_openai` / `wrap_anthropic`) | — | ✅ |
| Knowledge card extraction (decisions, solutions, risks) | ✅ | ✅ + LLM |
| Workflow rules injection (agent auto-recalls) | ✅ | ✅ |
| Full-text + semantic search | ✅ | ✅ |
| Progressive disclosure (summary → full) | ✅ | ✅ |
| Cross-device sync | Git | Real-time |
| Semantic vector search (100+ languages) | — | ✅ |
| Multi-agent collaboration | ✅ | ✅ |
| Memory marketplace | — | ✅ |
| Team collaboration | — | ✅ |

### Local-First Architecture

```
Your machine                          Cloud (optional)
┌─────────────────────┐              ┌─────────────────┐
│  .awareness/        │   sync →     │  Awareness Cloud │
│  ├── memories/*.md  │   ← sync    │  (semantic search│
│  ├── knowledge/     │              │   team sync,     │
│  └── index.db       │              │   marketplace)   │
│                     │              └─────────────────┘
│  Daemon :37800      │
│  ├── FTS5 search    │
│  ├── MCP server     │
│  └── Web dashboard  │
└─────────────────────┘
```

- **Data stays on your machine** by default
- **Works offline** — no internet required
- **Markdown files** — human-readable, git-friendly, portable
- **Cloud is optional** — one click to enable sync, semantic search, team features

---

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@awareness-sdk/local`](https://www.npmjs.com/package/@awareness-sdk/local) | Local daemon + MCP server | `npx @awareness-sdk/local start` |
| [`@awareness-sdk/setup`](https://www.npmjs.com/package/@awareness-sdk/setup) | CLI setup for all 13+ IDEs | `npx @awareness-sdk/setup` |
| [`awareness-memory-cloud`](https://pypi.org/project/awareness-memory-cloud/) | Python SDK with interceptors | `pip install awareness-memory-cloud` |
| [`@awareness-sdk/memory-cloud`](https://www.npmjs.com/package/@awareness-sdk/memory-cloud) | TypeScript SDK with interceptors | `npm i @awareness-sdk/memory-cloud` |
| [`@awareness-sdk/openclaw-memory`](https://www.npmjs.com/package/@awareness-sdk/openclaw-memory) | OpenClaw plugin | `openclaw plugins install @awareness-sdk/openclaw-memory` |
| [`claudecode/`](claudecode/README.md) | Claude Code plugin | `/plugin marketplace add edwin-hao-ai/Awareness-SDK` then `/plugin install awareness-memory@awareness` |

---

## Integrations

Works with any AI framework:

- **LangChain** — [Integration guide](https://awareness.market/docs?doc=langchain)
- **CrewAI** — [Integration guide](https://awareness.market/docs?doc=crewai)
- **AutoGen** — [Integration guide](https://awareness.market/docs?doc=autogen)
- **PraisonAI** — [Integration guide](https://awareness.market/docs?doc=praisonai)
- **Custom agents** — MCP protocol or REST API

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AWARENESS_MCP_URL` | MCP endpoint | `http://localhost:37800/mcp` |
| `AWARENESS_API_KEY` | Cloud API key (`aw_...`) | — (local mode: not needed) |
| `AWARENESS_MEMORY_ID` | Cloud memory ID | — (local mode: auto) |
| `AWARENESS_AGENT_ROLE` | Agent role filter | `builder_agent` |

---

## Contributing

Contributions welcome! Please open an issue or pull request.

## License

Apache 2.0
