/**
 * Unit tests for src/engine/stepHandlers.ts
 *
 * Each handler is tested in isolation with a minimal WorkflowStep fixture
 * and an explicit context. No LLM API calls are made.
 */

import {
  handleTrigger,
  handleLlm,
  handleTransform,
  handleCondition,
  handleAction,
  handleOutput,
  StepContext,
} from "./stepHandlers";
import { WorkflowStep } from "../types/workflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: "step_test",
    name: "Test Step",
    kind: "trigger",
    description: "A test step",
    inputKeys: [],
    outputKeys: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// handleTrigger
// ---------------------------------------------------------------------------

describe("handleTrigger", () => {
  it("passes through declared outputKeys from context", async () => {
    const step = makeStep({ kind: "trigger", outputKeys: ["ticketId", "subject"] });
    const ctx: StepContext = { ticketId: "TKT-001", subject: "Login issue", extra: "ignored" };

    const result = await handleTrigger(step, ctx);

    expect(result.output).toEqual({ ticketId: "TKT-001", subject: "Login issue" });
    expect(result.output["extra"]).toBeUndefined();
  });

  it("returns empty output when outputKeys not present in context", async () => {
    const step = makeStep({ kind: "trigger", outputKeys: ["missing"] });
    const ctx: StepContext = {};

    const result = await handleTrigger(step, ctx);
    expect(result.output).toEqual({});
  });

  it("does not set skip flag", async () => {
    const step = makeStep({ kind: "trigger", outputKeys: [] });
    const result = await handleTrigger(step, {});
    expect(result.skip).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleLlm
// ---------------------------------------------------------------------------

describe("handleLlm", () => {
  it("returns stub output keyed by outputKeys", async () => {
    const step = makeStep({
      kind: "llm",
      outputKeys: ["intent", "sentiment"],
      promptTemplate: "Classify: {{body}}",
    });
    const ctx: StepContext = { body: "I need help" };

    const result = await handleLlm(step, ctx);

    expect(result.output["intent"]).toBeDefined();
    expect(result.output["sentiment"]).toBeDefined();
  });

  it("interpolates context values into the prompt (_prompt in output)", async () => {
    const step = makeStep({
      kind: "llm",
      outputKeys: ["summary"],
      promptTemplate: "Summarise: {{text}}",
    });
    const ctx: StepContext = { text: "Hello world" };

    const result = await handleLlm(step, ctx);
    const prompt = result.output["_prompt"] as string;
    expect(prompt).toContain("Hello world");
    expect(prompt).not.toContain("{{text}}");
  });

  it("leaves unresolved placeholders unchanged", async () => {
    const step = makeStep({
      kind: "llm",
      outputKeys: ["out"],
      promptTemplate: "Hello {{missing}}",
    });

    const result = await handleLlm(step, {});
    const prompt = result.output["_prompt"] as string;
    expect(prompt).toContain("{{missing}}");
  });

  it("throws when promptTemplate is missing", async () => {
    const step = makeStep({ kind: "llm", outputKeys: ["out"] }); // no promptTemplate

    await expect(handleLlm(step, {})).rejects.toThrow(/promptTemplate/);
  });
});

// ---------------------------------------------------------------------------
// handleTransform
// ---------------------------------------------------------------------------

describe("handleTransform", () => {
  it("passthrough: copies matching keys from context to output", async () => {
    const step = makeStep({
      kind: "transform",
      outputKeys: ["name", "email"],
    });
    const ctx: StepContext = { name: "Alice", email: "a@b.com", ignored: true };

    const result = await handleTransform(step, ctx);
    expect(result.output["name"]).toBe("Alice");
    expect(result.output["email"]).toBe("a@b.com");
    expect(result.output["ignored"]).toBeUndefined();
  });

  it("enrichment.lookup returns stub enrichment data", async () => {
    const step = makeStep({
      kind: "transform",
      action: "enrichment.lookup",
      outputKeys: ["employees", "industry"],
    });
    const ctx: StepContext = { company: "Acme Corp" };

    const result = await handleTransform(step, ctx);
    expect(result.output["employees"]).toBeDefined();
    expect(result.output["industry"]).toBeDefined();
    expect(result.output["_stub"]).toBe(true);
  });

  it("content.applyBrandTemplate wraps the blog post", async () => {
    const step = makeStep({
      kind: "transform",
      action: "content.applyBrandTemplate",
      outputKeys: ["formattedPost"],
    });
    const ctx: StepContext = { blogPost: "My article body" };

    const result = await handleTransform(step, ctx);
    const formatted = result.output["formattedPost"] as string;
    expect(formatted).toContain("My article body");
  });
});

// ---------------------------------------------------------------------------
// handleCondition
// ---------------------------------------------------------------------------

describe("handleCondition", () => {
  it("evaluates a true condition expression", async () => {
    const step = makeStep({
      kind: "condition",
      condition: "leadScore >= 70",
      outputKeys: ["shouldRoute"],
    });
    const ctx: StepContext = { leadScore: 75 };

    const result = await handleCondition(step, ctx);
    expect(result.output["shouldRoute"]).toBe(true);
    expect(result.skip).toBe(false);
  });

  it("evaluates a false condition expression and sets skip=true", async () => {
    const step = makeStep({
      kind: "condition",
      condition: "leadScore >= 70",
      outputKeys: ["shouldRoute"],
    });
    const ctx: StepContext = { leadScore: 50 };

    const result = await handleCondition(step, ctx);
    expect(result.output["shouldRoute"]).toBe(false);
    expect(result.skip).toBe(true);
  });

  it("evaluates string comparison conditions", async () => {
    const step = makeStep({
      kind: "condition",
      condition: "intent === 'general'",
      outputKeys: ["isGeneral"],
    });

    const trueResult = await handleCondition(step, { intent: "general" });
    expect(trueResult.output["isGeneral"]).toBe(true);

    const falseResult = await handleCondition(step, { intent: "refund" });
    expect(falseResult.output["isGeneral"]).toBe(false);
  });

  it("evaluates array.includes() expressions", async () => {
    const step = makeStep({
      kind: "condition",
      condition: "autoRespondCategories.includes(intent)",
      outputKeys: ["shouldAutoRespond"],
    });
    const ctx: StepContext = { autoRespondCategories: ["general", "billing"], intent: "general" };

    const result = await handleCondition(step, ctx);
    expect(result.output["shouldAutoRespond"]).toBe(true);
  });

  it("defaults to true when no condition is set", async () => {
    const step = makeStep({ kind: "condition", outputKeys: [] });
    const result = await handleCondition(step, {});
    expect(result.output["_conditionResult"]).toBe(true);
  });

  it("throws on invalid expression", async () => {
    const step = makeStep({
      kind: "condition",
      condition: ")(invalid syntax(",
      outputKeys: ["r"],
    });
    await expect(handleCondition(step, {})).rejects.toThrow(/evaluation failed/i);
  });
});

// ---------------------------------------------------------------------------
// handleAction
// ---------------------------------------------------------------------------

describe("handleAction", () => {
  it("support.sendOrEscalate returns auto_responded when shouldAutoRespond=true", async () => {
    const step = makeStep({
      kind: "action",
      action: "support.sendOrEscalate",
      outputKeys: ["resolution", "escalated"],
    });
    const ctx: StepContext = { shouldAutoRespond: true };

    const result = await handleAction(step, ctx);
    expect(result.output["resolution"]).toBe("auto_responded");
    expect(result.output["escalated"]).toBe(false);
  });

  it("support.sendOrEscalate returns escalated when shouldAutoRespond=false", async () => {
    const step = makeStep({
      kind: "action",
      action: "support.sendOrEscalate",
      outputKeys: ["resolution", "escalated"],
    });
    const ctx: StepContext = { shouldAutoRespond: false };

    const result = await handleAction(step, ctx);
    expect(result.output["resolution"]).toBe("escalated");
    expect(result.output["escalated"]).toBe(true);
  });

  it("crm.upsertLead returns a crmId", async () => {
    const step = makeStep({
      kind: "action",
      action: "crm.upsertLead",
      outputKeys: ["crmId", "crmUrl"],
    });
    const result = await handleAction(step, { email: "lead@example.com" });
    expect(typeof result.output["crmId"]).toBe("string");
    expect(result.output["crmId"]).toBeTruthy();
  });

  it("content.queue returns a queueId", async () => {
    const step = makeStep({
      kind: "action",
      action: "content.queue",
      outputKeys: ["queueId"],
    });
    const result = await handleAction(step, {});
    expect(typeof result.output["queueId"]).toBe("string");
    expect(result.output["queueId"]).toMatch(/^cq-/);
  });

  it("email.send returns sent=true", async () => {
    const step = makeStep({
      kind: "action",
      action: "email.send",
      outputKeys: ["sent"],
    });
    const result = await handleAction(step, {});
    expect(result.output["sent"]).toBe(true);
  });

  it("unknown action returns a stub without throwing", async () => {
    const step = makeStep({
      kind: "action",
      action: "unknown.action.xyz",
      outputKeys: ["result"],
    });
    const result = await handleAction(step, { result: "original" });
    expect(result.output["_stub"]).toBe(true);
    expect(result.output["_action"]).toBe("unknown.action.xyz");
  });
});

// ---------------------------------------------------------------------------
// handleOutput
// ---------------------------------------------------------------------------

describe("handleOutput", () => {
  it("events.emit returns a workflow.completed event", async () => {
    const step = makeStep({
      kind: "output",
      action: "events.emit",
      inputKeys: ["ticketId"],
      outputKeys: ["event"],
    });
    const result = await handleOutput(step, { ticketId: "T001" });
    const event = result.output["event"] as Record<string, unknown>;
    expect(event.type).toBe("workflow.completed");
  });

  it("default output collects declared inputKeys from context", async () => {
    const step = makeStep({
      kind: "output",
      inputKeys: ["resolution", "escalated"],
      outputKeys: [],
    });
    const ctx: StepContext = { resolution: "auto_responded", escalated: false, extra: "ignored" };

    const result = await handleOutput(step, ctx);
    expect(result.output["resolution"]).toBe("auto_responded");
    expect(result.output["escalated"]).toBe(false);
    expect(result.output["extra"]).toBeUndefined();
  });
});
