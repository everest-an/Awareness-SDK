---
name: awareness-session-start
description: Load cross-session memory context at the start of every opencode session. Use when beginning new work to restore what was built, decided, and left pending last time.
---

# Awareness Session Start

Call the `awareness_init` tool ONCE at the start of a session to load persistent memory.

## Steps

1. Call `awareness_init` (optionally with `query` describing the current task).
2. Review what it returns:
   - `user_preferences` — identity, style, hard constraints (honor these first)
   - `open_tasks` — unfinished work; remind the user of stale/high-priority items
   - `knowledge_cards` — decisions and lessons relevant to the current context
   - `active_skills` — reusable procedures; apply one when it matches the task
3. If `attention_summary.needs_attention` is true, surface stale tasks and high risks before starting.

## Then

- Before implementing anything, call `awareness_recall(query="<what you're about to do>")` to check it hasn't already been solved.
