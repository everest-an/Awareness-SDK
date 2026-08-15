// ---------------------------------------------------------------------------
// Plugin configuration — mirrors the plugin options / env var surface
// ---------------------------------------------------------------------------

export interface PluginConfig {
  apiKey: string;
  baseUrl: string;
  memoryId: string;
  agentRole: string;
  autoRecall: boolean;
  autoCapture: boolean;
  recallLimit: number;
  localUrl: string;
  /** Minimum message count before auto-capture fires. Default: 0 (capture all). */
  captureMinTurns?: number;
}

// ---------------------------------------------------------------------------
// Awareness API response types (cloud REST + local daemon MCP share shapes)
// ---------------------------------------------------------------------------

export interface VectorResult {
  id?: string;
  type?: string;
  title?: string;
  summary?: string;
  content?: string;
  score?: number;
  tags?: string[];
  source?: string;
  created_at?: string;
  tokens_est?: number;
  metadata?: Record<string, unknown>;
}

export interface RecallResult {
  memory_id?: string;
  results?: VectorResult[];
  trace_id?: string;
}

export interface SessionSummary {
  session_id?: string;
  date?: string;
  summary?: string;
  event_count?: number;
}

export interface ActiveSkill {
  title?: string;
  summary?: string;
  methods?: string[];
}

export interface SessionContext {
  memory_id?: string;
  generated_at?: string;
  days_included?: number;
  last_sessions?: SessionSummary[];
  recent_days?: DayNarrative[];
  open_tasks?: ActionItem[];
  user_preferences?: KnowledgeCard[];
  knowledge_cards?: KnowledgeCard[];
  active_skills?: ActiveSkill[];
  attention_summary?: Record<string, unknown>;
  rendered_context?: string;
  trace_id?: string;
}

export interface DayNarrative {
  date?: string;
  narrative?: string;
  count?: number;
}

export interface KnowledgeCard {
  id?: string;
  category?: string;
  title?: string;
  summary?: string;
  tags?: string[];
  confidence?: number;
  status?: string;
  user_id?: string;
  agent_role?: string;
}

export interface ActionItem {
  id?: string;
  title?: string;
  priority?: string;
  status?: string;
  detail?: string;
  context?: string;
  estimated_effort?: string;
  user_id?: string;
  agent_role?: string;
}

export interface Risk {
  id?: string;
  title?: string;
  level?: string;
  status?: string;
  detail?: string;
  mitigation?: string;
  user_id?: string;
  agent_role?: string;
}

export interface PerceptionSignal {
  type?: "contradiction" | "resonance" | "pattern" | "staleness" | "related_decision";
  title?: string;
  summary?: string;
  category?: string;
  card_id?: string;
  message?: string;
  days_ago?: number;
  days_since_update?: number;
  count?: number;
}

export interface IngestResponse {
  accepted?: number;
  written?: number;
  failed?: number;
  duplicates?: number;
  status?: string;
  trace_id?: string;
  perception?: PerceptionSignal[];
}

export interface KnowledgeBaseResponse {
  total?: number;
  cards?: KnowledgeCard[];
}

export interface ActionItemsResponse {
  action_items?: ActionItem[];
  total?: number;
}

export interface RisksResponse {
  risks?: Risk[];
  total?: number;
}

export interface SupersedeResponse {
  id?: string;
  status?: string;
  updated_at?: string;
}

export interface SessionEvent {
  content?: string;
  event_type?: string;
  actor?: string;
  session_id?: string;
  created_at?: string;
}

export interface SessionHistoryResult {
  memory_id?: string;
  session_id?: string;
  event_count?: number;
  events?: SessionEvent[];
}
