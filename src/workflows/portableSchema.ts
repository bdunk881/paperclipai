import { z } from "zod";
import { WorkflowTemplate } from "../types/workflow";

export const PORTABLE_WORKFLOW_FORMAT = "autoflow.workflow-template";
export const PORTABLE_WORKFLOW_SCHEMA_VERSION = "2026-04-19";
export const PORTABLE_WORKFLOW_SUPPORTED_STEP_KINDS = [
  "trigger",
  "cron_trigger",
  "interval_trigger",
  "llm",
  "transform",
  "condition",
  "action",
  "output",
  "agent",
  "approval",
  "mcp",
  "file_trigger",
] as const;
export const PORTABLE_WORKFLOW_SUPPORTED_CATEGORIES = [
  "support",
  "sales",
  "content",
  "operations",
  "marketing",
  "finance",
  "engineering",
  "custom",
] as const;

const configFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "object", "string[]", "object[]"]),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
  description: z.string().optional(),
  options: z.array(z.string()).optional(),
});

const retryPolicySchema = z.object({
  type: z.enum(["constant", "exponential", "random"]),
  maxAttempts: z.number().int().min(1),
  maxDuration: z.number().int().positive().optional(),
  intervalMs: z.number().int().min(0).optional(),
  delayFactor: z.number().positive().optional(),
  maxInterval: z.number().int().min(0).optional(),
  warningOnRetry: z.boolean().optional(),
});

const workflowStepSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(PORTABLE_WORKFLOW_SUPPORTED_STEP_KINDS),
    description: z.string().min(1),
    inputKeys: z.array(z.string()),
    outputKeys: z.array(z.string()),
    promptTemplate: z.string().optional(),
    llmConfigId: z.string().optional(),
    llmTier: z.enum(["lite", "standard", "power"]).optional(),
    condition: z.string().optional(),
    action: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    mcpServerUrl: z.string().optional(),
    mcpTool: z.string().optional(),
    agentModel: z.string().optional(),
    agentInstructions: z.string().optional(),
    subAgentSlots: z.number().int().positive().optional(),
    approvalAssignee: z.string().optional(),
    approvalAssignees: z.array(z.string().min(1)).optional(),
    approvalMessage: z.string().optional(),
    approvalTimeoutMinutes: z.number().int().positive().optional(),
    approvalRequestChangesStepId: z.string().optional(),
    acceptedFileTypes: z.array(z.string()).optional(),
    cronExpression: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    intervalMinutes: z.number().int().positive().optional(),
    retry: retryPolicySchema.optional(),
  })
  .superRefine((step, ctx) => {
    if (step.kind === "cron_trigger" && !step.cronExpression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cron_trigger steps require cronExpression",
        path: ["cronExpression"],
      });
    }

    if (step.kind === "interval_trigger" && !step.intervalMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "interval_trigger steps require intervalMinutes",
        path: ["intervalMinutes"],
      });
    }
  });

const workflowTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(PORTABLE_WORKFLOW_SUPPORTED_CATEGORIES),
  version: z.string().min(1),
  configFields: z.array(configFieldSchema).min(1),
  steps: z.array(workflowStepSchema).min(4),
  retry: retryPolicySchema.optional(),
  errors: z.array(workflowStepSchema).optional(),
  _finally: z.array(workflowStepSchema).optional(),
  sampleInput: z.record(z.unknown()),
  expectedOutput: z.record(z.unknown()),
});

export const portableWorkflowBundleSchema = z.object({
  format: z.literal(PORTABLE_WORKFLOW_FORMAT),
  schemaVersion: z.literal(PORTABLE_WORKFLOW_SCHEMA_VERSION),
  exportedAt: z.string().datetime(),
  template: workflowTemplateSchema,
});

export type PortableWorkflowBundle = z.infer<typeof portableWorkflowBundleSchema>;

export function createPortableWorkflowBundle(template: WorkflowTemplate): PortableWorkflowBundle {
  return {
    format: PORTABLE_WORKFLOW_FORMAT,
    schemaVersion: PORTABLE_WORKFLOW_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    template,
  };
}

export function parsePortableWorkflowBundle(payload: unknown): PortableWorkflowBundle {
  return portableWorkflowBundleSchema.parse(payload);
}

export function getPortableWorkflowSchemaDescriptor() {
  return {
    format: PORTABLE_WORKFLOW_FORMAT,
    schemaVersion: PORTABLE_WORKFLOW_SCHEMA_VERSION,
    supportedCategories: [...PORTABLE_WORKFLOW_SUPPORTED_CATEGORIES],
    supportedStepKinds: [...PORTABLE_WORKFLOW_SUPPORTED_STEP_KINDS],
    requiredTemplateFields: Object.keys(workflowTemplateSchema.shape),
  };
}
