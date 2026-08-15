// ---------------------------------------------------------------------------
// Lifecycle hooks: auto-capture the session summary into Awareness when a
// session goes idle (completes). Best-effort — a capture failure never breaks
// the opencode session.
//
// opencode's `session.idle` event carries only the sessionID, so we fetch the
// session messages through the opencode SDK client and distill a turn brief.
// ---------------------------------------------------------------------------

import type { Event, OpencodeClient } from "@opencode-ai/sdk";
import type { AwarenessClient } from "./client";
import type { PluginConfig, PerceptionSignal } from "./types";

// ---------------------------------------------------------------------------
// Metadata envelope stripper (ported from sdks/_shared/js/envelope-strip.mjs)
// ---------------------------------------------------------------------------

const ENVELOPE_BLOCK_PATTERNS = [
  /^\s*Sender\s*\(untrusted metadata\)\s*:[^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
  /^\s*\[Operational context metadata[^\]]*\][^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
  /^\s*\[Subagent Context\][^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
];
const LINE_PREFIX_PATTERN = /^\s*(?:Request|Result|Send)\s*:\s*/i;
const MAX_OUTPUT_CHARS = 2000;

function stripMetadataEnvelope(input: unknown): string {
  if (typeof input !== "string") return "";
  let text = input.slice(0, 200_000);
  for (let i = 0; i < 5; i++) {
    let matched = false;
    for (const pattern of ENVELOPE_BLOCK_PATTERNS) {
      const next = text.replace(pattern, "");
      if (next !== text) {
        text = next;
        matched = true;
      }
    }
    const stripped = text.replace(LINE_PREFIX_PATTERN, "");
    if (stripped !== text) {
      text = stripped;
      matched = true;
    }
    if (!matched) break;
  }
  const trimmed = text.trim();
  if (trimmed.length > MAX_OUTPUT_CHARS) return trimmed.slice(0, MAX_OUTPUT_CHARS);
  return trimmed;
}

// ---------------------------------------------------------------------------
// Capture dedup — prevent recording identical summaries within a window
// ---------------------------------------------------------------------------

const _captureHashCache = new Map<string, number>();
const CAPTURE_DEDUP_WINDOW_MS = 5 * 60 * 1000;

function shouldCapture(content: string): boolean {
  const now = Date.now();
  for (const [k, ts] of _captureHashCache) {
    if (now - ts > CAPTURE_DEDUP_WINDOW_MS) _captureHashCache.delete(k);
  }
  const key = `${content.slice(0, 120)}|${content.length}`;
  if (_captureHashCache.has(key)) return false;
  _captureHashCache.set(key, now);
  return true;
}

// ---------------------------------------------------------------------------
// Message extraction
// ---------------------------------------------------------------------------

interface RawMessage {
  role: string;
  content: string;
}

/** Extract text from an opencode Part (text parts carry `.text`). */
function partText(part: Record<string, unknown>): string {
  if (typeof part.text === "string") return part.text;
  return "";
}

/** Flatten `{ info, parts }[]` (opencode session.messages shape) into RawMessage[]. */
function flattenMessages(list: Array<{ info: { role: string }; parts: unknown[] }>): RawMessage[] {
  const out: RawMessage[] = [];
  for (const item of list) {
    if (!item) continue;
    const role = item.info?.role ?? "unknown";
    const content = (item.parts ?? [])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map(partText)
      .join("\n");
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

/** Build a concise turn brief from a message list (mirrors the OpenClaw plugin). */
function buildTurnBrief(messages: RawMessage[]): string {
  let firstUserContent = "";
  let lastAssistantContent = "";
  let messageCount = 0;

  for (const m of messages) {
    const content = stripMetadataEnvelope(m.content);
    if (content.length < 30) continue;
    messageCount++;
    if (m.role === "user" && !firstUserContent) {
      firstUserContent = content;
    }
    if (m.role === "assistant") {
      lastAssistantContent = content;
    }
  }

  if (messageCount === 0) return "";

  const parts: string[] = [];
  if (firstUserContent) parts.push(`Request: ${firstUserContent.slice(0, 300)}`);
  if (lastAssistantContent) parts.push(`Result: ${lastAssistantContent.slice(0, 400)}`);
  parts.push(`Turns: ${messageCount} messages`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Register the auto-capture event hook.
// ---------------------------------------------------------------------------

export function registerHooks(
  client: AwarenessClient,
  config: PluginConfig,
  oc: OpencodeClient,
) {
  if (!config.autoCapture) return {};

  return {
    event: async ({ event }: { event: Event }) => {
      if (event.type !== "session.idle") return;
      try {
        const sessionID = event.properties.sessionID;
        const res = await oc.session.messages({
          path: { id: sessionID },
          query: { limit: 200 },
        });
        const list = res.data ?? [];
        const summary = buildTurnBrief(flattenMessages(list as Array<{ info: { role: string }; parts: unknown[] }>));
        if (!summary || !shouldCapture(summary)) return;

        const captureResult = await client.record(summary, {
          event_type: "turn_brief",
          source: "opencode-plugin",
        });

        const perception = (captureResult as Record<string, unknown>)?.perception;
        void (perception as PerceptionSignal[] | undefined);

        try {
          await client.closeSession();
        } catch {
          // Session close is best-effort — insights generate on next query.
        }
      } catch {
        // Auto-capture must never break the session.
      }
    },
  };
}
