/**
 * Shared type definitions — mirrors ../../../src/types/workflow.ts
 * Keep in sync with the backend types.
 */

export type StepKind =
  | "trigger"
  | "cron_trigger"
  | "interval_trigger"
  | "llm"
  | "knowledge"
  | "transform"
  | "merge"
  | "loop"
  | "switch"
  | "filter"
  | "data_table"
  | "stop_error"
  | "wait"
  | "condition"
  | "action"
  | "output"
  | "agent"
  | "sub_workflow"
  | "approval"
  | "mcp"
  | "file_trigger"
  | "form_trigger"
  | "error_trigger"
  | "chat_trigger"
  | "sub_workflow_trigger";

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "string[]"
  | "object[]";

export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  defaultValue?: unknown;
  description?: string;
  options?: string[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  kind: StepKind;
  description: string;
  inputKeys: string[];
  outputKeys: string[];
  promptTemplate?: string;
  llmConfigId?: string;
  // For LLM / agent steps: explicit tier override (bypasses the classifier).
  llmTier?: "lite" | "standard" | "power";
  condition?: string;
  action?: string;
  config?: Record<string, unknown>;
  // knowledge step
  knowledgeBaseIds?: string[];
  knowledgeQuery?: string;
  knowledgeLimit?: number;
  knowledgeMinScore?: number;
  // cron_trigger step
  cronExpression?: string;
  timezone?: string;
  // interval_trigger step
  intervalMinutes?: number;
  // agent step
  agentModel?: string;
  agentInstructions?: string;
  subAgentSlots?: number;
  agentRoleKey?: string;
  agentSkills?: string[];
  agentBudgetMonthlyUsd?: number;
  agentScheduleType?: "manual" | "interval" | "cron";
  agentScheduleValue?: string;
  // approval step
  approvalAssignee?: string;
  approvalMessage?: string;
  approvalTimeoutMinutes?: number;
  approvalRequestChangesStepId?: string;
  // mcp step
  mcpServerUrl?: string;
  mcpTool?: string;
  // file_trigger step
  acceptedFileTypes?: string[];
}

/**
 * HEL-687: a free-floating canvas annotation ("sticky note"). NOT a workflow
 * step — the engine ignores annotations entirely; they only document the graph.
 * Persisted on the template and (when the doc-graph is on) synced over Yjs.
 */
export interface WorkflowAnnotation {
  id: string;
  text: string;
  /** One of the named sticky-note colors (see workflowAnnotations.ts). */
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: "support" | "sales" | "content" | "operations" | "marketing" | "finance" | "engineering" | "custom";
  version: string;
  configFields: ConfigField[];
  steps: WorkflowStep[];
  sampleInput: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  /** HEL-687: free-floating canvas sticky notes (optional, non-executable). */
  annotations?: WorkflowAnnotation[];
}

export interface WorkflowRun {
  id: string;
  templateId: string;
  templateName: string;
  routineId?: string;
  workflowVersionId?: string;
  workflowVersion?: number;
  // HEL-175: 'cancelling' is the intermediate state after the cancel
  // request is accepted but before the worker's next checkpoint flips it
  // to 'canceled'. Always converges to 'canceled' or 'completed'.
  status: "queued" | "pending" | "running" | "completed" | "failed" | "escalated" | "awaiting_approval" | "canceled" | "cancelling";
  startedAt: string;
  completedAt?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  stepResults: StepResult[];
  error?: string;
  failureReason?: string;
  failedAt?: string;
  /** HEL-704: run tags for grouping/filtering. */
  tags?: string[];
}

/** A message exchanged between the manager agent and a worker slot */
export interface AgentMessage {
  from: "manager" | "worker";
  slotIndex: number;
  content: string;
  timestamp: string;
}

/** Result of one parallel worker slot in an agent step */
export interface AgentSlotResult {
  slotIndex: number;
  status: "running" | "success" | "failure";
  output: Record<string, unknown>;
  durationMs: number;
  error?: string;
  messages: AgentMessage[];
}

export interface StepResult {
  stepId: string;
  stepName: string;
  status: "success" | "failure" | "skipped" | "running";
  output: Record<string, unknown>;
  durationMs: number;
  error?: string;
  /** Populated for agent steps — one entry per parallel worker slot */
  agentSlotResults?: AgentSlotResult[];
  /**
   * Per-step cost telemetry written by the engine (cost_log_json column).
   * `estimatedCostUsd` is the dollar cost of this step's LLM/tool calls;
   * undefined for steps that didn't incur a measurable cost.
   */
  costLog?: {
    estimatedCostUsd?: number;
    [key: string]: unknown;
  };
  /** HEL-706: structured log lines emitted during this step's execution. */
  logs?: StepLogEntry[];
}

/** HEL-706: a structured per-step log line. */
export interface StepLogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}
