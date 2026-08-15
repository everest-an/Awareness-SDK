---
name: awareness-save
description: Persist work to Awareness memory after completing a meaningful step. Use after decisions, bug fixes, workflow changes, and discovered preferences.
---

# Awareness Save

Record what you did/decided/learned so the next session doesn't start from zero.

## Usage

Call the `awareness_record` tool after meaningful work:

```
awareness_record(content="Decided to use RS256 for JWT signing because the infra team already standardizes on it. Files: auth/token.py, auth/jwt.py")
```

For searchable knowledge cards in one step, pass structured insights as a JSON string:

```
awareness_record(
  content="Fixed the 502 deploy loop",
  insights='{"knowledge_cards":[{"category":"problem_solution","title":"Deploy 502 root cause","summary":"...","tags":["deploy","nginx"]}]}'
)
```

## What to record (high signal)

- Decisions + reasoning (chose X over Y because...)
- Bug fixes (symptom + root cause + fix)
- Workflows/conventions (ordered steps, gotchas)
- User preferences and hard constraints
- Pitfalls + workarounds

## What NOT to record (low signal)

- Greetings, "run tests", transient "building..." status
- Code restatement (code lives in git; record the *lesson* only)
- Test/debug turns verifying the memory tool itself works
