---
name: squad
description: Run one lead + N worker agents on a shared Awareness memory via the task board. Use when the user asks for multi-agent work, parallel agents, a squad, or agent handoff — includes the claim-first protocol (CAS), structured handoff, attestation, and 60-minute lease rules.
license: MIT
---

# Squad: one lead, N workers, one brain

Awareness cloud memory is the control plane. Agents never command each other
directly — they coordinate through the task board, so any worker can join,
leave, or crash and the work still moves.

Cloud mode is required for cross-machine squads (`AWARENESS_API_KEY` +
`AWARENESS_MEMORY_ID`); local mode shares one machine only and is free.

## Rules

1. Claim before working — never pick up an existing `claimed`/`doing` task.
2. Every claim uses `expect_status` (CAS). On `conflict`, pick another task.
3. Hand off with context, not vibes: `{goal, files, decisions, open_questions}`.
4. Claims are leased for 60 minutes. Renew with `expect_status:"doing"`; a dead
   worker's task returns to `open` automatically.
5. Finish with `done` | `blocked` | `failed`; a reviewer attaches `verified_by`
   (first verifier wins).

## Lead playbook

1. `awareness_task_board` — see what exists.
2. Decompose the goal into independent tasks and write them in one call:
   `awareness_record({insights: '{"action_items":[{"title":"...","priority":"high","status":"open","detail":"goal + files + acceptance"}]}'})`
3. Do NOT execute tasks yourself; monitor with `awareness_task_board`.
4. Re-plan on `blocked`/`failed`; re-queue with a new task when needed.
5. When all tasks are `done` and attested, record the squad summary.

## Worker playbook

1. `awareness_task_board` → pick an `open` task.
2. Claim: `awareness_task({task_id, status:"claimed", expect_status:"open", agent_role:"<role>"})`.
3. Start: `awareness_task({task_id, status:"doing", expect_status:"claimed"})`.
4. Work; record decisions as you go (`awareness_record`).
5. Hand off: `awareness_task({task_id, status:"open", expect_status:"doing", handoff:'{"goal":...,"files":[...],"decisions":[...],"open_questions":[...]}'})`.
6. Or finish: `awareness_task({task_id, status:"done", expect_status:"doing"})`.
7. Long task? renew every ~30 min: `{status:"doing", expect_status:"doing"}`.

## Progress visibility

- Inside HyperCode: `awareness_task_board` (columns + agent_role + handoff).
- In the browser: Awareness → memory detail → Task board tab (live).
- Speed: task ops are single-row updates; the board is one indexed query.
- Accuracy: CAS prevents duplicate work; handoff carries the reasoning so the
  next agent does not re-derive it; attestation keeps a two-person check.
