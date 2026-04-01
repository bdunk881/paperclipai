/**
 * Core workflow type definitions for AutoFlow.
 * All workflow templates are expressed in terms of these types.
 */

export type StepKind =
  | "trigger"
  | "llm"
  | "transform"
  | "condition"
  | "action"
  | "output";

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "string[]"
  | "object[]";

/** A single configurable field exposed in the dashboard UI */
export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  defaultValue?: unknown;
  description?: string;
  /** For string fields: restrict to these options */
  options?: string[];
}

/** One step in a workflow */
export interface WorkflowStep {
  id: string;
  name: string;
  kind: StepKind;
  /** Human-readable description shown in the dashboard */
  description: string;
  /**
   * Input keys expected from previous steps or the trigger.
   * Used by the runtime to wire data between steps.
   */
  inputKeys: string[];
  /**
   * Output keys produced by this step and made available downstream.
   */
  outputKeys: string[];
  /**
   * For LLM steps: the prompt template. Supports {{key}} interpolation.
   */
  promptTemplate?: string;
  /**
   * For condition steps: a simple expression evaluated by the runtime.
   * e.g. "intent === 'refund'" or "leadScore >= 70"
   */
  condition?: string;
  /**
   * For action steps: identifies the integration target.
   * e.g. "crm.upsertLead", "email.send", "queue.push"
   */
  action?: string;
  /** Step-level configuration overrides */
  config?: Record<string, unknown>;
}

/** A complete workflow definition */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  /** Category used for filtering in the dashboard */
  category: "support" | "sales" | "content" | "custom";
  version: string;
  /** Fields surfaced in the dashboard configuration UI */
  configFields: ConfigField[];
  /** Ordered list of steps; runtime executes them in sequence unless branched */
  steps: WorkflowStep[];
  /** Example input payload used for previewing in the dashboard */
  sampleInput: Record<string, unknown>;
  /** Expected output shape for test assertions */
  expectedOutput: Record<string, unknown>;
}

/** A runtime workflow instance (one execution of a template) */
export interface WorkflowRun {
  id: string;
  templateId: string;
  status: "pending" | "running" | "completed" | "failed" | "escalated";
  startedAt: string;
  completedAt?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  stepResults: StepResult[];
  error?: string;
}

/** Result of executing a single step */
export interface StepResult {
  stepId: string;
  status: "success" | "failure" | "skipped";
  output: Record<string, unknown>;
  durationMs: number;
  error?: string;
}
