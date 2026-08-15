---
name: awareness-recall
description: Search Awareness persistent memory before implementing something. Use when starting a feature, fixing a bug, or making a decision that may already have precedent.
---

# Awareness Recall

Check persistent memory before re-solving a solved problem.

## Usage

Call the `awareness_recall` tool with a natural-language query:

```
awareness_recall(query="why did we choose pgvector over Pinecone?")
```

## When to use

- Before starting a new feature (has this been attempted before?)
- Before making an architectural decision (was one already made?)
- Before fixing a bug (was a similar root cause already diagnosed?)

## recall vs lookup

- `awareness_recall` = search by meaning (hybrid BM25 + vector)
- `awareness_lookup` = get by type, <50ms (e.g. `type="tasks"`, `type="knowledge"`, `type="risks"`)

If results are empty, that's a signal to proceed and record the outcome — don't re-query repeatedly.
