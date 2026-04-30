import type { LLMConfig, TemplateSummary } from "./client";
import type { WorkflowRun, WorkflowTemplate } from "../types/workflow";

const now = Date.now();

const mockTemplates: WorkflowTemplate[] = [
  {
    id: "tpl-support-bot",
    name: "Customer Support Bot",
    description: "Classify support requests and draft a customer reply.",
    category: "support",
    version: "1.0.0",
    configFields: [],
    sampleInput: {
      subject: "Billing issue",
      body: "My invoice total looks wrong.",
    },
    expectedOutput: {
      responseDraft: "We are reviewing the invoice discrepancy.",
    },
    steps: [
      {
        id: "support-trigger",
        name: "Intake ticket",
        kind: "trigger",
        description: "Capture the incoming support request.",
        inputKeys: ["subject", "body"],
        outputKeys: ["ticket"],
      },
      {
        id: "support-llm",
        name: "Classify request",
        kind: "llm",
        description: "Determine category, urgency, and summary.",
        inputKeys: ["ticket"],
        outputKeys: ["classification"],
        promptTemplate: "Classify this support request.",
      },
      {
        id: "support-action",
        name: "Draft reply",
        kind: "action",
        description: "Prepare a customer-ready response draft.",
        inputKeys: ["classification"],
        outputKeys: ["responseDraft"],
        action: "support.reply.draft",
      },
    ],
  },
  {
    id: "tpl-lead-enrich",
    name: "Lead Enrichment",
    description: "Enrich inbound leads before they enter outreach.",
    category: "sales",
    version: "1.0.0",
    configFields: [],
    sampleInput: {
      leadId: "lead-100",
      domain: "example.com",
    },
    expectedOutput: {
      score: 82,
    },
    steps: [
      {
        id: "lead-trigger",
        name: "Receive lead",
        kind: "trigger",
        description: "Accept the inbound lead payload.",
        inputKeys: ["leadId", "domain"],
        outputKeys: ["lead"],
      },
      {
        id: "lead-transform",
        name: "Look up firmographics",
        kind: "transform",
        description: "Normalize company and role data.",
        inputKeys: ["lead"],
        outputKeys: ["firmographics"],
      },
      {
        id: "lead-output",
        name: "Score lead",
        kind: "output",
        description: "Emit the enrichment score for routing.",
        inputKeys: ["firmographics"],
        outputKeys: ["score"],
      },
    ],
  },
  {
    id: "tpl-content-generator",
    name: "Content Generator",
    description: "Generate campaign copy from a structured brief.",
    category: "content",
    version: "1.0.0",
    configFields: [],
    sampleInput: {
      topic: "Spring launch",
      audience: "Operations leaders",
    },
    expectedOutput: {
      draft: "Campaign draft",
    },
    steps: [
      {
        id: "content-trigger",
        name: "Capture brief",
        kind: "trigger",
        description: "Collect the campaign brief and audience.",
        inputKeys: ["topic", "audience"],
        outputKeys: ["brief"],
      },
      {
        id: "content-llm",
        name: "Draft campaign copy",
        kind: "llm",
        description: "Generate the initial content draft.",
        inputKeys: ["brief"],
        outputKeys: ["draft"],
        promptTemplate: "Write campaign copy for the provided brief.",
      },
      {
        id: "content-output",
        name: "Publish draft",
        kind: "output",
        description: "Return the finished content draft.",
        inputKeys: ["draft"],
        outputKeys: ["draft"],
      },
    ],
  },
];

let mockRuns: WorkflowRun[] = [
  {
    id: "run-001",
    templateId: "tpl-support-bot",
    templateName: "Customer Support Bot",
    status: "completed",
    startedAt: new Date(now - 1000 * 60 * 5).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 4).toISOString(),
    input: { subject: "Billing issue", body: "Invoice total mismatch." },
    output: { responseDraft: "We are reviewing the invoice." },
    stepResults: [
      { stepId: "support-trigger", stepName: "Intake ticket", status: "success", output: { ticketId: "T-1" }, durationMs: 250 },
      { stepId: "support-llm", stepName: "Classify request", status: "success", output: { urgency: "medium" }, durationMs: 700 },
    ],
  },
  {
    id: "run-002",
    templateId: "tpl-lead-enrich",
    templateName: "Lead Enrichment",
    status: "running",
    startedAt: new Date(now - 1000 * 60 * 12).toISOString(),
    input: { leadId: "lead-42", domain: "autoflow.ai" },
    stepResults: [
      { stepId: "lead-trigger", stepName: "Receive lead", status: "success", output: { leadId: "lead-42" }, durationMs: 200 },
      { stepId: "lead-transform", stepName: "Look up firmographics", status: "running", output: {}, durationMs: 1200 },
    ],
  },
  {
    id: "run-003",
    templateId: "tpl-content-generator",
    templateName: "Content Generator",
    status: "failed",
    startedAt: new Date(now - 1000 * 60 * 20).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 19).toISOString(),
    input: { topic: "Launch teaser", audience: "Founders" },
    stepResults: [
      { stepId: "content-trigger", stepName: "Capture brief", status: "success", output: { topic: "Launch teaser" }, durationMs: 180 },
      { stepId: "content-llm", stepName: "Draft campaign copy", status: "failure", output: {}, durationMs: 900, error: "Provider timeout" },
    ],
    error: "Provider timeout",
  },
  {
    id: "run-004",
    templateId: "tpl-support-bot",
    templateName: "Customer Support Bot",
    status: "completed",
    startedAt: new Date(now - 1000 * 60 * 25).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 23).toISOString(),
    input: { subject: "Password reset", body: "Reset link expired." },
    output: { responseDraft: "A fresh reset link has been sent." },
    stepResults: [],
  },
  {
    id: "run-005",
    templateId: "tpl-lead-enrich",
    templateName: "Lead Enrichment",
    status: "completed",
    startedAt: new Date(now - 1000 * 60 * 40).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 38).toISOString(),
    input: { leadId: "lead-7", domain: "example.org" },
    output: { score: 91 },
    stepResults: [],
  },
  {
    id: "run-006",
    templateId: "tpl-content-generator",
    templateName: "Content Generator",
    status: "completed",
    startedAt: new Date(now - 1000 * 60 * 55).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 53).toISOString(),
    input: { topic: "Newsletter", audience: "Ops teams" },
    output: { draft: "Newsletter draft" },
    stepResults: [],
  },
];

const mockLLMConfigs: LLMConfig[] = [
  {
    id: "llm-default",
    label: "OpenAI Default",
    provider: "openai",
    model: "gpt-4o-mini",
    isDefault: true,
    apiKeyMasked: "sk-...mock",
    createdAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
  },
];

let runCounter = 0;
let templateCounter = 0;

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function listMockTemplates(category?: WorkflowTemplate["category"]): TemplateSummary[] {
  const summaries = mockTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    version: template.version,
    stepCount: template.steps.length,
    configFieldCount: template.configFields.length,
  }));

  return clone(category ? summaries.filter((template) => template.category === category) : summaries);
}

export function getMockTemplate(id: string): WorkflowTemplate {
  const template = mockTemplates.find((entry) => entry.id === id);
  if (!template) {
    throw new Error(`Template not found: ${id}`);
  }
  return clone(template);
}

export function createMockTemplate(template: Omit<WorkflowTemplate, "id"> & { id?: string }): WorkflowTemplate {
  const nextTemplate: WorkflowTemplate = {
    ...clone(template),
    id: template.id ?? `tpl-custom-${Date.now()}-${++templateCounter}`,
  };
  mockTemplates.push(nextTemplate);
  return clone(nextTemplate);
}

export function listMockRuns(templateId?: string): WorkflowRun[] {
  const runs = templateId ? mockRuns.filter((run) => run.templateId === templateId) : mockRuns;
  return clone(runs);
}

export function getMockRun(id: string): WorkflowRun {
  const run = mockRuns.find((entry) => entry.id === id);
  if (!run) {
    throw new Error(`Run not found: ${id}`);
  }
  return clone(run);
}

export function startMockRun(templateId: string, input: Record<string, unknown>): WorkflowRun {
  const template = getMockTemplate(templateId);
  const run: WorkflowRun = {
    id: `run-mock-${Date.now()}-${++runCounter}`,
    templateId,
    templateName: template.name,
    status: "running",
    startedAt: new Date().toISOString(),
    input: clone(input),
    stepResults: template.steps.map((step, index) => ({
      stepId: step.id,
      stepName: step.name,
      status: index === 0 ? "running" : "skipped",
      output: {},
      durationMs: 0,
    })),
  };
  mockRuns = [run, ...mockRuns];
  return clone(run);
}

export function listMockLLMConfigs(): LLMConfig[] {
  return clone(mockLLMConfigs);
}
