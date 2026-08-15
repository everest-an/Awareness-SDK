// ---------------------------------------------------------------------------
// Register Awareness memory tools as opencode custom tools.
//
// These mirror the MCP tools (awareness_init/recall/record/lookup) but are
// registered directly by the plugin so they work with NO MCP config. They are
// backed by the same AwarenessClient (cloud REST or local daemon MCP).
//
// Tool results follow opencode's ToolResult shape: a JSON string of the data
// (so the agent receives structured-but-serializable output).
// ---------------------------------------------------------------------------

import { tool } from "@opencode-ai/plugin";
import type { AwarenessClient } from "./client";

function toOutput(result: unknown): { output: string } {
  const out = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  return { output: out };
}

export function registerTools(client: AwarenessClient) {
  return {
    // 0. Workflow checklist — call when unsure what to do next
    __awareness_workflow__: tool({
      description:
        "Call when you're unsure what to do next with Awareness memory tools. " +
        "Returns a step-by-step checklist (init → recall → record) so you always " +
        "know the right next action. Low-cost — use anytime.",
      args: {},
      async execute() {
        return toOutput({
          workflow: [
            { step: 1, action: "awareness_init", when: "FIRST thing every session", what: "Get session_id + past context + active skills" },
            { step: 2, action: "awareness_recall", when: "BEFORE starting work", what: 'awareness_recall(query="<natural-language question>")' },
            { step: 3, action: "awareness_record", when: "AFTER every meaningful change", what: 'awareness_record(content="<detailed description with reasoning, files changed>")' },
            { step: 4, action: "awareness_record session end", when: "BEFORE ending session", what: 'awareness_record(content="<final session summary>")' },
          ],
          tips: {
            recall_vs_lookup: "awareness_recall = search by meaning. awareness_lookup = get by type (<50ms).",
            record_rule: "Record decisions, bug fixes, workflows, and user preferences — NOT every small edit.",
          },
        });
      },
    }),

    // 1. awareness_init — load cross-session context
    awareness_init: tool({
      description:
        "Load cross-session project memory ONCE at session start. Returns session_id, " +
        "recent progress, open tasks, knowledge cards, active skills, and user preferences.",
      args: {
        days: tool.schema.number().optional().describe("Days to look back (default 7, max 90)"),
        max_cards: tool.schema.number().optional().describe("Max knowledge cards (default 20)"),
        max_tasks: tool.schema.number().optional().describe("Max tasks (default 20)"),
        query: tool.schema.string().optional().describe("Optional focus query"),
      },
      async execute(args) {
        return toOutput(
          await client.init(
            typeof args.days === "number" ? args.days : undefined,
            typeof args.max_cards === "number" ? args.max_cards : undefined,
            typeof args.max_tasks === "number" ? args.max_tasks : undefined,
            typeof args.query === "string" ? args.query : undefined,
          ),
        );
      },
    }),

    // 2. awareness_recall — semantic search
    awareness_recall: tool({
      description:
        "Search persistent memory by meaning (hybrid BM25 + vector). Call BEFORE starting " +
        "work to avoid re-solving solved problems. Usage: awareness_recall(query=\"why did we choose pgvector?\")",
      args: {
        query: tool.schema.string().describe("Natural-language query"),
        limit: tool.schema.number().optional().describe("Max results (default 6, max 30)"),
        agent_role: tool.schema.string().optional().describe("Override agent role"),
      },
      async execute(args) {
        return toOutput(
          await client.search({
            query: String(args.query ?? ""),
            limit: typeof args.limit === "number" ? args.limit : undefined,
            agentRole: typeof args.agent_role === "string" ? args.agent_role : undefined,
          }),
        );
      },
    }),

    // 3. awareness_lookup — structured data retrieval
    awareness_lookup: tool({
      description:
        "Fast DB lookup — use instead of awareness_recall when you know WHAT you want. " +
        "type: tasks | knowledge | risks | session_history | timeline | context | handoff | rules | graph | agents.",
      args: {
        type: tool.schema.string().describe("Data type to retrieve"),
        query: tool.schema.string().optional().describe("Keyword filter"),
        category: tool.schema.string().optional().describe("Category filter for knowledge cards"),
        status: tool.schema.string().optional().describe("Status filter (pending/in_progress/completed)"),
        priority: tool.schema.string().optional().describe("Priority filter (high/medium/low)"),
        level: tool.schema.string().optional().describe("Risk level filter (high/medium/low)"),
        session_id: tool.schema.string().optional().describe("Session ID for session_history"),
        limit: tool.schema.number().optional().describe("Max items (default 50)"),
      },
      async execute(args) {
        return toOutput(
          await client.getData(String(args.type ?? "context"), args as Record<string, unknown>),
        );
      },
    }),

    // 4. awareness_record — unified write
    awareness_record: tool({
      description:
        "Save memory — ONE call stores the event and any structured insights. " +
        "Call AFTER every meaningful action (decision, bug fix, workflow, preference). " +
        "If you don't record it, it's lost. " +
        "Pass `insights` as a JSON string of {knowledge_cards:[{category,title,summary,tags}], " +
        "action_items:[], risks:[], skills:[]} for searchable cards in one step.",
      args: {
        content: tool.schema.string().describe("Detailed natural-language description of what you did/decided/learned"),
        insights: tool.schema.string().optional().describe("JSON string of structured insights (knowledge_cards/action_items/risks/skills)"),
        user_id: tool.schema.string().optional().describe("User ID for multi-user attribution"),
      },
      async execute(args) {
        const content = String(args.content ?? "");
        let insights: Record<string, unknown> | undefined;
        if (typeof args.insights === "string" && args.insights.trim()) {
          try {
            insights = JSON.parse(args.insights) as Record<string, unknown>;
          } catch {
            insights = undefined;
          }
        }
        return toOutput(
          await client.record(
            content,
            { source: "opencode-plugin", event_type: "turn_brief" },
            typeof args.user_id === "string" ? args.user_id : undefined,
            insights,
          ),
        );
      },
    }),

    // 5. awareness_apply_skill — execute a learned skill
    awareness_apply_skill: tool({
      description:
        "Apply a learned skill (from awareness_init active skills) — returns a step-by-step " +
        "execution plan. Call when a task matches an active skill's domain.",
      args: {
        skill_id: tool.schema.string().describe("Skill ID from active skills"),
        context: tool.schema.string().optional().describe("Current task context"),
      },
      async execute(args) {
        return toOutput(
          await client.applySkill(
            String(args.skill_id ?? ""),
            typeof args.context === "string" ? args.context : undefined,
          ),
        );
      },
    }),

    // 6. awareness_mark_skill_used — skill outcome feedback
    awareness_mark_skill_used: tool({
      description:
        "Report skill usage outcome after applying a skill. success (default) resets decay; " +
        "partial gives reduced boost; failed decreases confidence.",
      args: {
        skill_id: tool.schema.string().describe("Skill ID to mark"),
        outcome: tool.schema.string().optional().describe("success | partial | failed (default success)"),
      },
      async execute(args) {
        const outcome = (args.outcome === "partial" || args.outcome === "failed" ? args.outcome : "success") as
          | "success"
          | "partial"
          | "failed";
        return toOutput(
          await client.markSkillUsed(String(args.skill_id ?? ""), outcome),
        );
      },
    }),
  };
}
