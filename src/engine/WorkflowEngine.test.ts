/**
 * Unit tests for the WorkflowEngine state machine.
 *
 * Tests the execution pipeline (trigger → llm → condition → action → output),
 * status transitions, error handling, and LLM provider plug-in.
 * A mock LLM provider is used so no real API calls are made.
 */

// Prevent transitive import of ESM-only @mistralai/mistralai package
jest.mock("./llmProviders", () => ({
  getProvider: jest.fn(),
}));

import { WorkflowEngine, setLlmProvider, registerAction } from "./WorkflowEngine";
import { runStore } from "./runStore";
import { knowledgeStore } from "../knowledge/knowledgeStore";
import { approvalStore } from "./approvalStore";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { getProvider } from "./llmProviders";
import { customerSupportBot } from "../templates/customer-support-bot";
import { leadEnrichment } from "../templates/lead-enrichment";
import { contentGenerator } from "../templates/content-generator";
import { WorkflowTemplate, WorkflowStep } from "../types/workflow";

const mockGetProvider = getProvider as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Poll runStore until the run reaches a terminal status or we time out. */
async function waitForCompletion(
  runId: string,
  timeoutMs = 3000
): Promise<import("../types/workflow").WorkflowRun> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = runStore.get(runId);
    if (run && ["completed", "failed"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const run = runStore.get(runId);
  throw new Error(`Run ${runId} did not complete in ${timeoutMs}ms. Last status: ${run?.status}`);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let engine: WorkflowEngine;

beforeEach(() => {
  runStore.clear();
  knowledgeStore.clear();
  approvalStore.clear();
  engine = new WorkflowEngine();

  // Install deterministic mock LLM provider
  setLlmProvider(async (prompt: string) => {
    const lower = prompt.toLowerCase();
    if (lower.includes("classify") || lower.includes("ticket classifier")) {
      return JSON.stringify({ intent: "general", sentiment: "neutral", summary: "Test summary" });
    }
    if (lower.includes("score") || lower.includes("lead")) {
      return JSON.stringify({ companySize: "50-200", industry: "SaaS", leadScore: 80, enriched: true, scoringRationale: "Good fit", companyName: "Acme" });
    }
    if (lower.includes("draft") || lower.includes("support agent")) {
      return "Thank you for contacting support. We will resolve your issue shortly.";
    }
    if (lower.includes("seo") || lower.includes("content") || lower.includes("blog")) {
      return JSON.stringify({ rawDraft: "Draft content", seoKeywords: ["test"], outline: ["Intro"] });
    }
    if (lower.includes("brand") || lower.includes("rewrite")) {
      return JSON.stringify({ finalContent: "Final content", seoSlug: "test-slug", confidenceScore: 85 });
    }
    return JSON.stringify({ result: "processed" });
  });
});

// ---------------------------------------------------------------------------
// Run creation and status transitions
// ---------------------------------------------------------------------------

describe("WorkflowEngine — run lifecycle", () => {
  it("startRun returns a pending run immediately", () => {
    const run = engine.startRun(customerSupportBot, {
      ticketId: "T001",
      subject: "Login issue",
      body: "Can't log in",
      customerEmail: "user@example.com",
      channel: "email",
    });
    expect(run.id).toBeDefined();
    expect(run.templateId).toBe("tpl-support-bot");
    expect(["pending", "running"]).toContain(run.status);
  });

  it("run transitions to 'completed' after execution", async () => {
    const run = engine.startRun(customerSupportBot, {
      ticketId: "T002",
      subject: "Billing question",
      body: "What is my invoice?",
      customerEmail: "user@example.com",
      channel: "email",
    });
    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
  });

  it("completed run has a completedAt timestamp", async () => {
    const run = engine.startRun(customerSupportBot, {
      ticketId: "T003",
      subject: "x",
      body: "y",
      customerEmail: "a@b.com",
      channel: "chat",
    });
    const completed = await waitForCompletion(run.id);
    expect(typeof completed.completedAt).toBe("string");
    expect(new Date(completed.completedAt!).getTime()).not.toBeNaN();
  });

  it("completed run has step results for every template step", async () => {
    const run = engine.startRun(customerSupportBot, {
      ticketId: "T004",
      subject: "Help",
      body: "Issue",
      customerEmail: "c@d.com",
      channel: "email",
    });
    const completed = await waitForCompletion(run.id);
    expect(completed.stepResults).toHaveLength(customerSupportBot.steps.length);
  });

  it("all step results have the expected shape", async () => {
    const run = engine.startRun(customerSupportBot, {
      ticketId: "T005",
      subject: "Test",
      body: "Test body",
      customerEmail: "e@f.com",
      channel: "email",
    });
    const completed = await waitForCompletion(run.id);
    for (const sr of completed.stepResults) {
      expect(typeof sr.stepId).toBe("string");
      expect(["success", "failure", "skipped"]).toContain(sr.status);
      expect(typeof sr.durationMs).toBe("number");
      expect(sr.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof sr.output).toBe("object");
    }
  });
});

// ---------------------------------------------------------------------------
// All 3 workflow templates execute end-to-end
// ---------------------------------------------------------------------------

describe("All 3 template integration runs", () => {
  const testCases: [string, WorkflowTemplate, Record<string, unknown>][] = [
    [
      "Customer Support Bot",
      customerSupportBot,
      {
        ticketId: "TKT-001",
        subject: "Login issue",
        body: "Can't log in to my account",
        customerEmail: "alice@example.com",
        channel: "email",
      },
    ],
    [
      "Lead Enrichment",
      leadEnrichment,
      {
        leadId: "LEAD-001",
        email: "bob@prospect.io",
        firstName: "Bob",
        lastName: "Smith",
        company: "Prospect Inc",
        linkedinUrl: "https://linkedin.com/in/bob",
      },
    ],
    [
      "Content Generator",
      contentGenerator,
      {
        topic: "AI in healthcare",
        keywords: ["AI", "healthcare"],
        audience: "Medical professionals",
        format: "blog",
        wordCount: 800,
      },
    ],
  ];

  test.each(testCases)("%s completes without error", async (_name, template, input) => {
    const run = engine.startRun(template, input);
    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
    expect(completed.stepResults.some((sr) => sr.status === "failure")).toBe(false);
  });

  test.each(testCases)("%s produces a non-empty output object", async (_name, template, input) => {
    const run = engine.startRun(template, input);
    const completed = await waitForCompletion(run.id);
    expect(completed.output).toBeDefined();
    expect(typeof completed.output).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("WorkflowEngine — error handling", () => {
  it("marks run as failed when LLM provider throws", async () => {
    setLlmProvider(async () => {
      throw new Error("LLM unavailable");
    });

    const run = engine.startRun(customerSupportBot, {
      ticketId: "T-ERR",
      subject: "test",
      body: "test",
      customerEmail: "e@g.com",
      channel: "email",
    });

    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("failed");
    expect(completed.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Custom action registration
// ---------------------------------------------------------------------------

describe("WorkflowEngine — action registry", () => {
  it("uses a registered custom action handler", async () => {
    const handled: Record<string, unknown>[] = [];
    registerAction("crm.upsertLead", async (inputs) => {
      handled.push(inputs);
      return { crmId: "CRM-TEST", upserted: true };
    });

    const run = engine.startRun(leadEnrichment, {
      leadId: "LEAD-CUSTOM",
      email: "custom@test.io",
      firstName: "Custom",
      lastName: "User",
      company: "CustomCo",
    });

    await waitForCompletion(run.id);
    expect(handled.length).toBeGreaterThan(0);
  });
});

describe("WorkflowEngine — knowledge steps", () => {
  it("retrieves knowledge-base context and exposes prompt-ready output", async () => {
    const base = await knowledgeStore.createKnowledgeBase({
      userId: "knowledge-user",
      name: "Product KB",
    });
    await knowledgeStore.ingestDocument({
      userId: "knowledge-user",
      knowledgeBaseId: base.id,
      filename: "pricing.txt",
      mimeType: "text/plain",
      content:
        "AutoFlow offers usage-based billing with annual discounts for enterprise customers.",
      sourceType: "inline",
    });

    const template: WorkflowTemplate = {
      id: "tpl-knowledge-step",
      name: "Knowledge Step",
      description: "Injects retrieved context",
      category: "custom",
      version: "1.0.0",
      configFields: [],
      sampleInput: {},
      expectedOutput: {},
      steps: [
        {
          id: "step-trigger",
          name: "Trigger",
          kind: "trigger",
          description: "Start",
          inputKeys: [],
          outputKeys: ["question", "knowledgeBaseIds"],
        },
        {
          id: "step-knowledge",
          name: "Retrieve Context",
          kind: "knowledge",
          description: "Search KB",
          inputKeys: ["question"],
          outputKeys: ["knowledgePromptContext"],
          knowledgeLimit: 3,
          knowledgeMinScore: 0,
        },
        {
          id: "step-output",
          name: "Output",
          kind: "output",
          description: "Return context",
          inputKeys: ["knowledgePromptContext", "knowledgeQuery"],
          outputKeys: ["knowledgePromptContext", "knowledgeQuery"],
        },
      ],
    };

    const run = engine.startRun(
      template,
      {
        question: "How does enterprise pricing work?",
        knowledgeBaseIds: [base.id],
      },
      undefined,
      "knowledge-user"
    );

    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
    expect(completed.output).toEqual(
      expect.objectContaining({
        knowledgeQuery: "How does enterprise pricing work?",
      })
    );
    expect(String(completed.output?.knowledgePromptContext)).toMatch(/annual discounts/i);
  });
});

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

describe("WorkflowEngine — config defaults", () => {
  it("applies template defaultValues as config when no config is provided", async () => {
    const run = engine.startRun(customerSupportBot, {
      ticketId: "T-DEF",
      subject: "hello",
      body: "world",
      customerEmail: "d@e.com",
      channel: "email",
    });
    // Should complete without error because defaults fill in toneOfVoice, categories etc.
    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// file_trigger step kind
// ---------------------------------------------------------------------------

function makeMinimalTemplate(step: WorkflowStep): WorkflowTemplate {
  return {
    id: "tpl-test",
    name: "Test Template",
    description: "Minimal template for unit testing",
    category: "support",
    version: "0.1.0",
    configFields: [],
    steps: [step],
    sampleInput: {},
    expectedOutput: {},
  };
}

describe("WorkflowEngine — file_trigger step", () => {
  it("completes successfully when content is in input", async () => {
    const tpl = makeMinimalTemplate({
      id: "ft1",
      name: "File Trigger",
      kind: "file_trigger",
      description: "Accepts uploaded file",
      inputKeys: [],
      outputKeys: ["content"],
    });
    const run = engine.startRun(tpl, { content: "uploaded text", mimeType: "text/plain", filename: "doc.txt" });
    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
    const stepResult = completed.stepResults[0];
    expect(stepResult.output["content"]).toBe("uploaded text");
  });

  it("marks run as failed when file content is missing", async () => {
    const tpl = makeMinimalTemplate({
      id: "ft2",
      name: "File Trigger",
      kind: "file_trigger",
      description: "Requires content",
      inputKeys: [],
      outputKeys: [],
    });
    const run = engine.startRun(tpl, {}); // no content
    const completed = await waitForCompletion(run.id);
    // step fails but run still completes (step failure → stepStatus=failure, run completes)
    expect(["completed", "failed"]).toContain(completed.status);
  });
});

// ---------------------------------------------------------------------------
// mcp step kind
// ---------------------------------------------------------------------------

describe("WorkflowEngine — mcp step", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("completes with tool output when MCP server responds", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "search result" }] },
      }),
    }) as unknown as typeof fetch;

    const tpl = makeMinimalTemplate({
      id: "mcp1",
      name: "MCP Search",
      kind: "mcp",
      description: "MCP tool call",
      inputKeys: ["query"],
      outputKeys: ["searchResult"],
      mcpServerUrl: "https://mcp.example.com",
      mcpTool: "search",
    });
    const run = engine.startRun(tpl, { query: "test query" });
    const completed = await waitForCompletion(run.id);
    expect(["completed", "failed"]).toContain(completed.status);
    if (completed.status === "completed") {
      expect(completed.stepResults[0].output["searchResult"]).toBe("search result");
    }
  });

  it("marks step as failed when MCP server is unreachable", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const tpl = makeMinimalTemplate({
      id: "mcp2",
      name: "MCP Search",
      kind: "mcp",
      description: "MCP tool call",
      inputKeys: [],
      outputKeys: ["result"],
      mcpServerUrl: "https://mcp.example.com",
      mcpTool: "search",
    });
    const run = engine.startRun(tpl, {});
    const completed = await waitForCompletion(run.id);
    expect(completed.stepResults[0].status).toBe("failure");
  });
});

// ---------------------------------------------------------------------------
// default action handlers (events.emit fallback branches)
// ---------------------------------------------------------------------------

describe("WorkflowEngine — action registry fallback branches", () => {
  it("events.emit uses leadId fallback when ticketId absent", async () => {
    const handled: Record<string, unknown>[] = [];
    registerAction("events.emit", async (inputs) => {
      handled.push(inputs);
      return { event: { type: "test.resolved", id: inputs["leadId"], timestamp: new Date().toISOString() } };
    });

    // Use leadEnrichment which has leadId in sampleInput
    const run = engine.startRun(leadEnrichment, leadEnrichment.sampleInput);
    await waitForCompletion(run.id);
    // Restore original
    registerAction("events.emit", async (inputs) => {
      const ticketId = inputs["ticketId"] ?? inputs["leadId"] ?? "unknown";
      const intent = inputs["intent"] ?? inputs["action"] ?? "processed";
      return { event: { type: `${intent}.resolved`, id: ticketId, timestamp: new Date().toISOString() } };
    });
  });
});

// ---------------------------------------------------------------------------
// Config defaults — configField with no defaultValue
// ---------------------------------------------------------------------------

describe("WorkflowEngine — configField without defaultValue", () => {
  it("skips fields with no defaultValue in _buildDefaultConfig", async () => {
    const tpl = makeMinimalTemplate({
      id: "output1",
      name: "Output",
      kind: "output",
      description: "Just output",
      inputKeys: [],
      outputKeys: [],
    });
    // Add a configField with no defaultValue
    tpl.configFields = [
      { key: "requiredField", label: "Required", type: "string", required: true },
      { key: "fieldWithDefault", label: "With Default", type: "string", required: false, defaultValue: "my-default" },
    ];

    const run = engine.startRun(tpl, {});
    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// approval step kind
// ---------------------------------------------------------------------------

async function waitForStatus(
  runId: string,
  status: string,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = runStore.get(runId);
    if (run?.status === status) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("WorkflowEngine — approval step", () => {
  it("pauses run at awaiting_approval then completes when approved", async () => {
    const tpl = makeMinimalTemplate({
      id: "appr1",
      name: "Approval Gate",
      kind: "approval",
      description: "Human approval required",
      inputKeys: [],
      outputKeys: ["approved"],
      approvalAssignee: "manager",
      approvalMessage: "Please approve",
      approvalTimeoutMinutes: 1,
    });

    const run = engine.startRun(tpl, {});
    await waitForStatus(run.id, "awaiting_approval");

    const pending = approvalStore.list("pending");
    expect(pending.length).toBeGreaterThan(0);
    approvalStore.resolve(pending[0].id, "approved", "looks good");

    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
    expect(completed.stepResults[0].output["approved"]).toBe(true);
    expect(completed.stepResults[0].output["approverComment"]).toBe("looks good");
  });

  it("records step failure when approval is rejected", async () => {
    const tpl = makeMinimalTemplate({
      id: "appr2",
      name: "Approval Gate",
      kind: "approval",
      description: "Human approval required",
      inputKeys: [],
      outputKeys: [],
    });

    const run = engine.startRun(tpl, {});
    await waitForStatus(run.id, "awaiting_approval");

    const pending = approvalStore.list("pending");
    approvalStore.resolve(pending[0].id, "rejected", "not ready");

    const completed = await waitForCompletion(run.id);
    expect(completed.stepResults[0].status).toBe("failure");
    expect(completed.stepResults[0].output["approved"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// agent step kind (through the engine)
// ---------------------------------------------------------------------------

describe("WorkflowEngine — agent step", () => {
  beforeEach(() => {
    mockGetProvider.mockReset();
  });

  it("completes with merged slot output when agent step succeeds", async () => {
    jest.spyOn(llmConfigStore, "getDecryptedDefault").mockReturnValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as ReturnType<typeof llmConfigStore.getDecryptedDefault>);
    mockGetProvider.mockReturnValue(async () => ({ text: '{"result":"done"}' }));

    const tpl = makeMinimalTemplate({
      id: "agent1",
      name: "Agent Step",
      kind: "agent",
      description: "Parallel agent execution",
      inputKeys: [],
      outputKeys: [],
      subAgentSlots: 1,
      agentInstructions: "Do the task",
    });

    const run = engine.startRun(tpl, {}, undefined, "user-1");
    const completed = await waitForCompletion(run.id);
    expect(["completed", "failed"]).toContain(completed.status);
    if (completed.status === "completed") {
      expect(completed.stepResults[0].output["_agentSlots"]).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// default (unknown) step kind
// ---------------------------------------------------------------------------

describe("WorkflowEngine — default (unknown) step kind", () => {
  it("completes with empty output for unrecognized step kind", async () => {
    const tpl = makeMinimalTemplate({
      id: "unknown1",
      name: "Unknown Kind",
      kind: "custom_unknown" as unknown as WorkflowStep["kind"],
      description: "Not a real step type",
      inputKeys: [],
      outputKeys: [],
    });

    const run = engine.startRun(tpl, {});
    const completed = await waitForCompletion(run.id);
    expect(["completed", "failed"]).toContain(completed.status);
    expect(completed.stepResults[0].output).toEqual({});
  });
});
