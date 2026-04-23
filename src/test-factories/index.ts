/**
 * Test data factories for AutoFlow.
 *
 * Use these helpers in tests and seed scripts to create realistic
 * workflow entities without hard-coding repetitive fixtures.
 *
 * Usage:
 *   import { makeWorkflowRun, makeStepResult, makeSupportTicketInput } from "../test-factories";
 */

import { randomUUID } from "node:crypto";
import {
  WorkflowRun,
  StepResult,
  WorkflowTemplate,
  WorkflowStep,
  ConfigField,
} from "../types/workflow";

// ---------------------------------------------------------------------------
// WorkflowRun factory
// ---------------------------------------------------------------------------

export interface WorkflowRunOverrides {
  id?: string;
  templateId?: string;
  templateName?: string;
  status?: WorkflowRun["status"];
  startedAt?: string;
  completedAt?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  stepResults?: StepResult[];
  error?: string;
}

export function makeWorkflowRun(overrides: WorkflowRunOverrides = {}): WorkflowRun {
  return {
    id: overrides.id ?? `run-${randomUUID()}`,
    templateId: overrides.templateId ?? "tpl-support-bot",
    templateName: overrides.templateName ?? "Customer Support Bot",
    status: overrides.status ?? "pending",
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    completedAt: overrides.completedAt,
    input: overrides.input ?? {},
    output: overrides.output,
    stepResults: overrides.stepResults ?? [],
    error: overrides.error,
  };
}

export function makeCompletedRun(overrides: WorkflowRunOverrides = {}): WorkflowRun {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 1200).toISOString();
  return makeWorkflowRun({
    status: "completed",
    startedAt,
    completedAt: now.toISOString(),
    output: { result: "processed" },
    ...overrides,
  });
}

export function makeFailedRun(error = "Simulated failure", overrides: WorkflowRunOverrides = {}): WorkflowRun {
  return makeWorkflowRun({
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// StepResult factory
// ---------------------------------------------------------------------------

export interface StepResultOverrides {
  stepId?: string;
  stepName?: string;
  status?: StepResult["status"];
  output?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

export function makeStepResult(overrides: StepResultOverrides = {}): StepResult {
  return {
    stepId: overrides.stepId ?? "step_trigger",
    stepName: overrides.stepName ?? "Trigger",
    status: overrides.status ?? "success",
    output: overrides.output ?? {},
    durationMs: overrides.durationMs ?? 42,
    error: overrides.error,
  };
}

// ---------------------------------------------------------------------------
// Template input factories — one per template
// ---------------------------------------------------------------------------

/** Valid input payload for the Customer Support Bot template */
export function makeSupportTicketInput(
  overrides: Partial<{
    ticketId: string;
    customerEmail: string;
    subject: string;
    body: string;
    channel: string;
  }> = {}
): Record<string, unknown> {
  return {
    ticketId: overrides.ticketId ?? `TKT-${Math.floor(Math.random() * 99999).toString().padStart(5, "0")}`,
    customerEmail: overrides.customerEmail ?? "customer@example.com",
    subject: overrides.subject ?? "I need help with my account",
    body: overrides.body ?? "I have been having trouble logging in. Please help.",
    channel: overrides.channel ?? "email",
  };
}

/** Valid input payload for the Lead Enrichment template */
export function makeLeadInput(
  overrides: Partial<{
    leadId: string;
    email: string;
    firstName: string;
    lastName: string;
    company: string;
    linkedinUrl: string;
  }> = {}
): Record<string, unknown> {
  return {
    leadId: overrides.leadId ?? `LEAD-${randomUUID().slice(0, 8).toUpperCase()}`,
    email: overrides.email ?? "lead@example.com",
    firstName: overrides.firstName ?? "Jane",
    lastName: overrides.lastName ?? "Doe",
    company: overrides.company ?? "Acme Corp",
    linkedinUrl: overrides.linkedinUrl ?? "https://linkedin.com/in/janedoe",
  };
}

/** Valid input payload for the Content Generator template */
export function makeContentBriefInput(
  overrides: Partial<{
    topic: string;
    keywords: string[];
    audience: string;
    format: string;
    wordCount: number;
  }> = {}
): Record<string, unknown> {
  return {
    topic: overrides.topic ?? "The Future of AI in Business",
    keywords: overrides.keywords ?? ["AI", "automation", "productivity"],
    audience: overrides.audience ?? "Business leaders and decision-makers",
    format: overrides.format ?? "blog",
    wordCount: overrides.wordCount ?? 800,
  };
}

// ---------------------------------------------------------------------------
// WorkflowTemplate / WorkflowStep factories (for unit tests needing custom templates)
// ---------------------------------------------------------------------------

export function makeWorkflowStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: overrides.id ?? `step_${randomUUID().slice(0, 6)}`,
    name: overrides.name ?? "Test Step",
    kind: overrides.kind ?? "trigger",
    description: overrides.description ?? "A test step",
    inputKeys: overrides.inputKeys ?? [],
    outputKeys: overrides.outputKeys ?? [],
    promptTemplate: overrides.promptTemplate,
    condition: overrides.condition,
    action: overrides.action,
    config: overrides.config,
  };
}

export function makeConfigField(overrides: Partial<ConfigField> = {}): ConfigField {
  return {
    key: overrides.key ?? "testField",
    label: overrides.label ?? "Test Field",
    type: overrides.type ?? "string",
    required: overrides.required ?? false,
    defaultValue: overrides.defaultValue,
    description: overrides.description,
    options: overrides.options,
  };
}

export function makeWorkflowTemplate(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  const triggerStep = makeWorkflowStep({
    id: "step_trigger",
    kind: "trigger",
    name: "Trigger",
    outputKeys: ["input"],
  });
  const outputStep = makeWorkflowStep({
    id: "step_output",
    kind: "output",
    name: "Output",
    inputKeys: ["input"],
    outputKeys: ["result"],
  });

  return {
    id: overrides.id ?? `tpl-test-${randomUUID().slice(0, 6)}`,
    name: overrides.name ?? "Test Template",
    description: overrides.description ?? "A test workflow template",
    category: overrides.category ?? "custom",
    version: overrides.version ?? "1.0.0",
    configFields: overrides.configFields ?? [makeConfigField({ key: "apiKey", required: true })],
    steps: overrides.steps ?? [triggerStep, outputStep],
    sampleInput: overrides.sampleInput ?? { input: "test" },
    expectedOutput: overrides.expectedOutput ?? { result: "test" },
  };
}

// ---------------------------------------------------------------------------
// Seed helpers — for local development environment setup
// ---------------------------------------------------------------------------

/**
 * Returns an array of diverse sample WorkflowRun records for seeding a
 * local dashboard or integration test database.
 */
export function seedWorkflowRuns(): WorkflowRun[] {
  return [
    makeCompletedRun({
      templateId: "tpl-support-bot",
      input: makeSupportTicketInput({ ticketId: "TKT-00001", subject: "Billing query" }),
      output: { resolution: "auto_responded", escalated: false },
    }),
    makeCompletedRun({
      templateId: "tpl-support-bot",
      input: makeSupportTicketInput({ ticketId: "TKT-00002", subject: "Bug report", body: "App crashes" }),
      output: { resolution: "escalated", escalated: true },
    }),
    makeWorkflowRun({
      templateId: "tpl-support-bot",
      status: "running",
      input: makeSupportTicketInput({ ticketId: "TKT-00003" }),
    }),
    makeCompletedRun({
      templateId: "tpl-lead-enrich",
      input: makeLeadInput({ company: "Stripe" }),
      output: { leadScore: 92, crmPipeline: "hot_leads", isHotLead: true },
    }),
    makeCompletedRun({
      templateId: "tpl-lead-enrich",
      input: makeLeadInput({ company: "Unknown LLC" }),
      output: { leadScore: 35, crmPipeline: "nurture", isHotLead: false },
    }),
    makeCompletedRun({
      templateId: "tpl-content-gen",
      input: makeContentBriefInput({ topic: "5 Ways AI Improves Customer Support" }),
      output: { published: true, contentId: "CONT-00001" },
    }),
    makeFailedRun("LLM timeout after 30s", {
      templateId: "tpl-content-gen",
      input: makeContentBriefInput(),
    }),
  ];
}
