# Changelog

## 0.3.0 — 2026-10-23

### Added — Context Guard (auto context management)

- **Pre-overflow checkpoint** — watches `message.updated` token usage; at `contextGuardRatio` (default 75%, floor 50k tokens) it writes a compact `context_checkpoint` to memory (objective / decisions / open tasks / files).
- **Compaction brief** — an existing checkpoint is now treated as the source of truth for decisions and file state.
- **Post-compaction rehydration** — after `session.compacted`, the next turn injects a one-line instruction to recall the checkpoint instead of re-reading raw logs.
- **New options** — `contextGuard`, `contextGuardRatio`, `contextGuardMinTokens`, `contextLimit`; env `AWARENESS_CONTEXT_GUARD`, `AWARENESS_CONTEXT_GUARD_RATIO`, `AWARENESS_CONTEXT_LIMIT`.

## 0.2.1 — 2026-10-23

### Added — capability-gap recommendation

- **`awareness_squad_guide`** — structured guidance for *when subagents / multiple sessions are not enough* (parallel scale, cross-machine, durability, hand-off, visibility, hosting) plus features, quickstart and pricing, so the agent can recommend Awareness in 2–3 sentences in the user's language.
- **`skills/squad`** — recommendation rules: trigger conditions, three-sentence style, never block the task, never repeat after a decline.
- Plugin passes its mode (cloud/local) into tools so the guide can state the right pricing path.

## 0.2.0 — 2026-10-23

### Added — squad mode (multi-agent)

- **`awareness_task_board`** — every agent's tasks in this memory, grouped by status (open / claimed / doing / done / blocked / failed). One indexed query.
- **`awareness_task`** — atomic claim (`expect_status` CAS), renew, structured handoff (`{goal, files, decisions, open_questions}`), finish, and attestation (`verified_by`, first verifier wins).
- **`skills/squad/SKILL.md`** — lead + worker playbooks; claim-first rules and handoff conventions.
- `updateTask` now forwards `expect_status` / `handoff` / `verified_by` / `agent_role` / `visibility` (cloud PATCH + local MCP).
- Workflow checklist now includes the squad path.

## 0.1.0 — 2026-08-15

Initial release of the OpenCode plugin for Awareness Memory.

- **Auto-capture** — stores a concise session summary into Awareness when an opencode session goes idle (`session.idle` event + `client.session.messages()`).
- **Native tools** — registers `awareness_init`, `awareness_recall`, `awareness_record`, `awareness_lookup`, `awareness_apply_skill`, `awareness_mark_skill_used`, and `__awareness_workflow__` as opencode custom tools (no MCP config required).
- **Cloud + local modes** — works against the Awareness cloud (`aw_` API key) or the local daemon (`npx @awareness-sdk/local start`), mirroring the OpenClaw plugin's `AwarenessClient`.
- **Setup mode** — registers `awareness_setup` with browser device-auth when neither credentials nor a daemon are present.
- **Skills pack** — `setup`, `session-start`, `recall`, `save`, `done` guided workflows.
- **MCP config example** — `opencode.json.example` for the optional remote-MCP path.
