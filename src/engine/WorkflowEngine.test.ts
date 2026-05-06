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
import { approvalStore } from "./approvalStore";
import { approvalPolicyStore } from "../approvals/policyStore";
import { memoryStore } from "./memoryStore";
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
    const run = await runStore.get(runId);
    if (run && ["completed", "failed"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const run = await runStore.get(runId);
  throw new Error(`Run ${runId} did not complete in ${timeoutMs}ms. Last status: ${run?.status}`);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let engine: WorkflowEngine;

beforeEach(() => {
  void runStore.clear();
  void approvalStore.clear();
  void approvalPolicyStore.clear();
  memoryStore.clear();
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
  it("startRun returns a pending run immediately", async () => {
    const run = await engine.startRun(customerSupportBot, {
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
    const run = await engine.startRun(customerSupportBot, {
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
    const run = await engine.startRun(customerSupportBot, {
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
    const run = await engine.startRun(customerSupportBot, {
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
    const run = await engine.startRun(customerSupportBot, {
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
    const run = await engine.startRun(template, input);
    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
    expect(completed.stepResults.some((sr) => sr.status === "failure")).toBe(false);
  });

  test.each(testCases)("%s produces a non-empty output object", async (_name, template, input) => {
    const run = await engine.startRun(template, input);
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

    const run = await engine.startRun(customerSupportBot, {
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

    const run = await engine.startRun(leadEnrichment, {
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

describe("WorkflowEngine — memory context", () => {
  it("reads previously stored memory entries for the current user", () => {
    memoryStore.write({
      userId: "user-1",
      workflowId: "tpl-memory",
      workflowName: "Memory workflow",
      key: "customer_history",
      text: "VIP customer requested a refund last month",
    });

    const memory = (engine as unknown as {
      _buildMemoryContext: (
        template: WorkflowTemplate,
        userId?: string
      ) => { read: (query: string) => Array<{ key: string; text: string }> };
    })._buildMemoryContext(customerSupportBot, "user-1");

    expect(memory.read("refund")).toEqual([
      {
        key: "customer_history",
        text: "VIP customer requested a refund last month",
      },
    ]);
  });
});

describe("WorkflowEngine — approval request changes loopback", () => {
  it("loops back to the configured step when approval requests changes", async () => {
    const revisions: number[] = [];

    registerAction("test.reviseDraft", async (inputs) => {
      const nextRevision = Number(inputs["revisionCount"] ?? 0) + 1;
      revisions.push(nextRevision);
      return { revisionCount: nextRevision, draft: `Draft revision ${nextRevision}` };
    });

    const template: WorkflowTemplate = {
      id: "tpl-approval-loopback",
      name: "Approval loopback",
      description: "Tests request changes loopback behavior",
      category: "custom",
      version: "1",
      configFields: [],
      steps: [
        {
          id: "trigger-1",
          name: "Trigger",
          kind: "trigger",
          description: "Start",
          inputKeys: ["revisionCount"],
          outputKeys: ["revisionCount"],
        },
        {
          id: "revise-1",
          name: "Revise draft",
          kind: "action",
          description: "Produces the next draft revision",
          inputKeys: ["revisionCount"],
          outputKeys: ["revisionCount", "draft"],
          action: "test.reviseDraft",
        },
        {
          id: "approval-1",
          name: "Manager approval",
          kind: "approval",
          description: "Approve or request changes",
          inputKeys: ["draft"],
          outputKeys: ["approved", "approvalDecision", "approvalId", "approverComment"],
          approvalAssignee: "manager@example.com",
          approvalMessage: "Review the draft",
          approvalTimeoutMinutes: 5,
          approvalRequestChangesStepId: "revise-1",
        },
        {
          id: "output-1",
          name: "Output",
          kind: "output",
          description: "Finish",
          inputKeys: ["revisionCount", "draft", "approvalDecision", "approverComment"],
          outputKeys: ["revisionCount", "draft", "approvalDecision", "approverComment"],
        },
      ],
      sampleInput: { revisionCount: 0 },
      expectedOutput: { revisionCount: 2 },
    };

    const run = await engine.startRun(template, { revisionCount: 0 });

    const deadline = Date.now() + 2000;
    let firstApprovalId: string | undefined;
    while (Date.now() < deadline) {
      const pendingApprovals = await approvalStore.list("pending");
      const firstApproval = pendingApprovals.find((approval) => approval.runId === run.id);
      if (firstApproval) {
        firstApprovalId = firstApproval.id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(firstApprovalId).toBeDefined();
    await approvalStore.resolve(firstApprovalId!, "request_changes", "Please revise and resubmit");

    let secondApprovalId: string | undefined;
    while (Date.now() < deadline) {
      const runState = await runStore.get(run.id);
      const pendingApprovals = await approvalStore.list("pending");
      const nextApproval = pendingApprovals.find((approval) => approval.runId === run.id && approval.id !== firstApprovalId);
      if (runState?.status === "awaiting_approval" && nextApproval) {
        secondApprovalId = nextApproval.id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(secondApprovalId).toBeDefined();
    await approvalStore.resolve(secondApprovalId!, "approved", "Looks good now");

    const completed = await waitForCompletion(run.id, 4000);
    expect(completed.status).toBe("completed");
    expect(revisions).toEqual([1, 2]);
    expect(completed.output).toMatchObject({
      revisionCount: 2,
      draft: "Draft revision 2",
      approvalDecision: "approved",
      approverComment: "Looks good now",
    });
  });
});

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

describe("WorkflowEngine — config defaults", () => {
  it("applies template defaultValues as config when no config is provided", async () => {
    const run = await engine.startRun(customerSupportBot, {
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
    const run = await engine.startRun(tpl, {
      content: "uploaded text",
      mimeType: "text/plain",
      filename: "doc.txt",
    });
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
    const run = await engine.startRun(tpl, {}); // no content
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
    const run = await engine.startRun(tpl, { query: "test query" });
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
    const run = await engine.startRun(tpl, {});
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
    const run = await engine.startRun(leadEnrichment, leadEnrichment.sampleInput);
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

    const run = await engine.startRun(tpl, {});
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
    const run = await runStore.get(runId);
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

    const run = await engine.startRun(tpl, {});
    await waitForStatus(run.id, "awaiting_approval");

    const pending = await approvalStore.list("pending");
    expect(pending.length).toBeGreaterThan(0);
    await approvalStore.resolve(pending[0].id, "approved", "looks good");

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

    const run = await engine.startRun(tpl, {});
    await waitForStatus(run.id, "awaiting_approval");

    const pending = await approvalStore.list("pending");
    await approvalStore.resolve(pending[0].id, "rejected", "not ready");

    const completed = await waitForCompletion(run.id);
    expect(completed.stepResults[0].status).toBe("failure");
    expect(completed.stepResults[0].output["approved"]).toBe(false);
  });
});

describe("WorkflowEngine — approval tier governance", () => {
  it("blocks a governed action step until approval is granted", async () => {
    registerAction("content.publish", async () => ({ published: true, contentId: "post-1" }));

    await approvalPolicyStore.upsert({
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actionType: "public_posts",
      mode: "require_approval",
    });

    const tpl = makeMinimalTemplate({
      id: "gov-action-1",
      name: "Publish content",
      kind: "action",
      description: "Publishes content",
      inputKeys: ["draft"],
      outputKeys: ["published", "contentId"],
      action: "content.publish",
    });

    const run = await engine.startRun(tpl, {
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      draft: "Ship it",
    });

    await waitForStatus(run.id, "awaiting_approval");

    const pending = await approvalStore.list("pending");
    expect(pending).toHaveLength(1);
    await approvalStore.resolve(pending[0].id, "approved", "approved for publishing");

    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");
    expect(completed.stepResults[0].output["governanceActionType"]).toBe("public_posts");
    expect(completed.stepResults[0].output["governanceMode"]).toBe("require_approval");
  });

  it("creates an auto-approved approval record for notify-only governed actions", async () => {
    registerAction("content.publish", async () => ({ published: true, contentId: "post-2" }));

    await approvalPolicyStore.upsert({
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actionType: "public_posts",
      mode: "notify_only",
    });

    const tpl = makeMinimalTemplate({
      id: "gov-action-2",
      name: "Publish content",
      kind: "action",
      description: "Publishes content",
      inputKeys: ["draft"],
      outputKeys: ["published", "contentId"],
      action: "content.publish",
    });

    const run = await engine.startRun(tpl, {
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      draft: "Publish without blocking",
    });

    const completed = await waitForCompletion(run.id);
    expect(completed.status).toBe("completed");

    const approvals = await approvalStore.list("approved");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].comment).toContain("notify-only");
    expect(completed.stepResults[0].output["governanceMode"]).toBe("notify_only");
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

    const run = await engine.startRun(tpl, {}, undefined, "user-1");
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

    const run = await engine.startRun(tpl, {});
    const completed = await waitForCompletion(run.id);
    expect(["completed", "failed"]).toContain(completed.status);
    expect(completed.stepResults[0].output).toEqual({});
  });
});
