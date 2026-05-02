/**
 * Shared type definitions — mirrors ../../../src/types/workflow.ts
 * Keep in sync with the backend types.
 */

export type StepKind =
  | "trigger"
  | "cron_trigger"
  | "interval_trigger"
  | "llm"
  | "transform"
  | "condition"
  | "action"
  | "output"
  | "agent"
  | "approval"
  | "mcp"
  | "file_trigger";

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
  condition?: string;
  action?: string;
  config?: Record<string, unknown>;
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
  // mcp step
  mcpServerUrl?: string;
  mcpTool?: string;
  // file_trigger step
  acceptedFileTypes?: string[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: "support" | "sales" | "content" | "operations" | "marketing" | "engineering" | "custom";
  version: string;
  configFields: ConfigField[];
  steps: WorkflowStep[];
  sampleInput: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
}

export interface WorkflowRun {
  id: string;
  templateId: string;
  templateName: string;
  status: "pending" | "running" | "completed" | "failed" | "escalated" | "awaiting_approval";
  startedAt: string;
  completedAt?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  stepResults: StepResult[];
  error?: string;
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
}
