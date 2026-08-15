---
name: awareness-done
description: Close an opencode session with a final memory summary. Use before ending a session or when the user says they're done, so the next session has a clean handoff.
---

# Awareness Done

Write a final session summary so the next session can resume cleanly.

## Steps

1. Summarize what was accomplished, what's still open, and any decisions.
2. Call `awareness_record` with the summary:

```
awareness_record(content="Session summary: implemented X, decided Y, left Z unfinished. Next: ...")
```

3. If there are open tasks the next session should pick up, include them as insights action_items.

The plugin also auto-captures the session on idle — this is a belt-and-suspenders final handoff with explicit "next steps".
