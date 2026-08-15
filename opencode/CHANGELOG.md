# Changelog

## 0.1.0 — 2026-08-15

Initial release of the OpenCode plugin for Awareness Memory.

- **Auto-capture** — stores a concise session summary into Awareness when an opencode session goes idle (`session.idle` event + `client.session.messages()`).
- **Native tools** — registers `awareness_init`, `awareness_recall`, `awareness_record`, `awareness_lookup`, `awareness_apply_skill`, `awareness_mark_skill_used`, and `__awareness_workflow__` as opencode custom tools (no MCP config required).
- **Cloud + local modes** — works against the Awareness cloud (`aw_` API key) or the local daemon (`npx @awareness-sdk/local start`), mirroring the OpenClaw plugin's `AwarenessClient`.
- **Setup mode** — registers `awareness_setup` with browser device-auth when neither credentials nor a daemon are present.
- **Skills pack** — `setup`, `session-start`, `recall`, `save`, `done` guided workflows.
- **MCP config example** — `opencode.json.example` for the optional remote-MCP path.
