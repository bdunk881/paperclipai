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
import { customerSupportBot } from "../templates/customer-support-bot";
import { leadEnrichment } from "../templates/lead-enrichment";
import { contentGenerator } from "../templates/content-generator";
import { WorkflowTemplate } from "../types/workflow";

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
      category: "engineering",
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
