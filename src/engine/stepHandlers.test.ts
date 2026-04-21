/**
 * Unit tests for src/engine/stepHandlers.ts
 *
 * Each handler is tested in isolation with a minimal WorkflowStep fixture
 * and an explicit context. No real LLM API calls are made.
 */

jest.mock("./llmProviders", () => ({
  getProvider: jest.fn(),
}));

import {
  handleTrigger,
  handleLlm,
  handleTransform,
  handleCondition,
  handleAction,
  handleOutput,
  handleFileTrigger,
  handleMcp,
  handleAgent,
  StepContext,
} from "./stepHandlers";
import { WorkflowStep } from "../types/workflow";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { getProvider } from "./llmProviders";
import {
  clearClassificationDecisionsForTests,
  listClassificationDecisions,
} from "./classificationLog";

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

const TEST_USER = "user-llm-test";

describe("handleLlm", () => {
  let mockProviderFn: jest.Mock;

  beforeEach(() => {
    llmConfigStore.clear();
    clearClassificationDecisionsForTests();
    mockProviderFn = jest.fn().mockResolvedValue({
      text: JSON.stringify({ intent: "general", sentiment: "neutral" }),
    });
    (getProvider as jest.Mock).mockReturnValue(mockProviderFn);

    const cfg = llmConfigStore.create({
      userId: TEST_USER,
      provider: "openai",
      label: "Test",
      model: "gpt-4o",
      credentials: { apiKey: "sk-test-1234-5678" },
    });
    llmConfigStore.setDefault(cfg.id, TEST_USER);
  });

  afterEach(() => {
    llmConfigStore.clear();
    clearClassificationDecisionsForTests();
  });

  it("calls the provider and maps JSON response to output", async () => {
    const step = makeStep({
      kind: "llm",
      outputKeys: ["intent", "sentiment"],
      promptTemplate: "Classify: {{body}}",
    });
    const ctx: StepContext = { body: "I need help" };

    const result = await handleLlm(step, ctx, TEST_USER);

    expect(result.output["intent"]).toBe("general");
    expect(result.output["sentiment"]).toBe("neutral");
  });

  it("interpolates context values into the prompt before calling provider", async () => {
    const step = makeStep({
      kind: "llm",
      outputKeys: ["summary"],
      promptTemplate: "Summarise: {{text}}",
    });
    const ctx: StepContext = { text: "Hello world" };

    await handleLlm(step, ctx, TEST_USER);

    expect(mockProviderFn).toHaveBeenCalledWith(
      expect.stringContaining("Hello world")
    );
    expect(mockProviderFn).toHaveBeenCalledWith(
      expect.not.stringContaining("{{text}}")
    );
  });

  it("leaves unresolved placeholders in the prompt passed to provider", async () => {
    const step = makeStep({
      kind: "llm",
      outputKeys: ["out"],
      promptTemplate: "Hello {{missing}}",
    });

    await handleLlm(step, {}, TEST_USER);

    expect(mockProviderFn).toHaveBeenCalledWith(
      expect.stringContaining("{{missing}}")
    );
  });

  it("maps non-JSON text response to first output key", async () => {
    mockProviderFn.mockResolvedValue({ text: "Plain text response" });
    const step = makeStep({
      kind: "llm",
      outputKeys: ["reply"],
      promptTemplate: "Draft: {{prompt}}",
    });

    const result = await handleLlm(step, { prompt: "hello" }, TEST_USER);

    expect(result.output["reply"]).toBe("Plain text response");
  });

  it("uses step-level llmConfigId when provided", async () => {
    const specific = llmConfigStore.create({
      userId: TEST_USER,
      provider: "anthropic",
      label: "Specific",
      model: "claude-sonnet-4-6",
      credentials: { apiKey: "sk-ant-specific" },
    });

    const step = makeStep({
      kind: "llm",
      outputKeys: ["out"],
      promptTemplate: "Hello",
      llmConfigId: specific.id,
    });

    await handleLlm(step, {}, TEST_USER);

    expect(getProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "sk-ant-specific",
        credentials: { apiKey: "sk-ant-specific" },
      })
    );
  });

  it("throws when no LLM provider is configured", async () => {
    llmConfigStore.clear(); // remove all configs
    const step = makeStep({
      kind: "llm",
      outputKeys: ["out"],
      promptTemplate: "Hello",
    });

    await expect(handleLlm(step, {}, TEST_USER)).rejects.toThrow(
      /no LLM provider configured/
    );
  });

  it("throws when promptTemplate is missing", async () => {
    const step = makeStep({ kind: "llm", outputKeys: ["out"] });

    await expect(handleLlm(step, {}, TEST_USER)).rejects.toThrow(
      /promptTemplate/
    );
  });

  it("logs a routing decision entry for analytics", async () => {
    const step = makeStep({
      kind: "llm",
      outputKeys: ["intent"],
      promptTemplate: "Classify this support ticket into one category and return JSON.",
    });
    const ctx: StepContext = { body: "Billing issue with invoice mismatch" };

    await handleLlm(step, ctx, TEST_USER);

    const logs = listClassificationDecisions();
    expect(logs).toHaveLength(1);
    const entry = logs[0];
    expect(entry.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.selectedTier).toBe("lite");
    expect(entry.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(entry.confidenceScore).toBeLessThanOrEqual(1);
    expect(entry.modelId).toBe("gpt-4o-mini");
    expect(entry.features).toBeDefined();
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

// ---------------------------------------------------------------------------
// handleFileTrigger
// ---------------------------------------------------------------------------

describe("handleFileTrigger", () => {
  it("throws when no content in context", async () => {
    const step = makeStep({ kind: "file_trigger", outputKeys: [] });
    await expect(handleFileTrigger(step, {})).rejects.toThrow("no parsed file content");
  });

  it("returns content, mimeType, filename from context", async () => {
    const step = makeStep({ kind: "file_trigger", outputKeys: [] });
    const ctx: StepContext = { content: "hello", mimeType: "text/plain", filename: "f.txt" };
    const result = await handleFileTrigger(step, ctx);
    expect(result.output["content"]).toBe("hello");
    expect(result.output["mimeType"]).toBe("text/plain");
    expect(result.output["filename"]).toBe("f.txt");
  });

  it("maps declared outputKeys from context into output", async () => {
    const step = makeStep({ kind: "file_trigger", outputKeys: ["userId"] });
    const ctx: StepContext = { content: "data", userId: "u-1" };
    const result = await handleFileTrigger(step, ctx);
    expect(result.output["userId"]).toBe("u-1");
  });

  it("does not overwrite content with outputKeys mapping", async () => {
    const step = makeStep({ kind: "file_trigger", outputKeys: ["content"] });
    const ctx: StepContext = { content: "original" };
    const result = await handleFileTrigger(step, ctx);
    expect(result.output["content"]).toBe("original");
  });
});

// ---------------------------------------------------------------------------
// handleMcp
// ---------------------------------------------------------------------------

describe("handleMcp", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("throws when mcpServerUrl is missing", async () => {
    const step = makeStep({ kind: "mcp", mcpTool: "search" });
    await expect(handleMcp(step, {})).rejects.toThrow("missing mcpServerUrl");
  });

  it("throws when mcpTool is missing", async () => {
    const step = makeStep({ kind: "mcp", mcpServerUrl: "https://mcp.example.com" });
    await expect(handleMcp(step, {})).rejects.toThrow("missing mcpTool");
  });

  it("throws on HTTP error from MCP server", async () => {
    const step = makeStep({
      kind: "mcp",
      mcpServerUrl: "https://mcp.example.com",
      mcpTool: "search",
      inputKeys: [],
      outputKeys: ["result"],
    });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    }) as unknown as typeof fetch;

    await expect(handleMcp(step, {})).rejects.toThrow("HTTP 503");
  });

  it("throws on JSON-RPC error response", async () => {
    const step = makeStep({
      kind: "mcp",
      mcpServerUrl: "https://mcp.example.com",
      mcpTool: "search",
      inputKeys: [],
      outputKeys: ["result"],
    });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }),
    }) as unknown as typeof fetch;

    await expect(handleMcp(step, {})).rejects.toThrow("RPC error -32601");
  });

  it("returns text content from content array", async () => {
    const step = makeStep({
      kind: "mcp",
      mcpServerUrl: "https://mcp.example.com",
      mcpTool: "search",
      inputKeys: ["query"],
      outputKeys: ["searchResult"],
    });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "Found 3 results" }] },
      }),
    }) as unknown as typeof fetch;

    const result = await handleMcp(step, { query: "test" });
    expect(result.output["searchResult"]).toBe("Found 3 results");
    expect(result.output["content"]).toBeDefined();
  });

  it("returns raw result when no content array", async () => {
    const step = makeStep({
      kind: "mcp",
      mcpServerUrl: "https://mcp.example.com",
      mcpTool: "getData",
      inputKeys: [],
      outputKeys: ["data"],
    });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { data: { count: 5 } },
      }),
    }) as unknown as typeof fetch;

    const result = await handleMcp(step, {});
    expect(result.output["data"]).toEqual({ count: 5 });
  });

  it("passes inputKeys from context as tool arguments", async () => {
    const step = makeStep({
      kind: "mcp",
      mcpServerUrl: "https://mcp.example.com",
      mcpTool: "lookup",
      inputKeys: ["id", "region"],
      outputKeys: ["info"],
    });
    let capturedBody: unknown;
    global.fetch = jest.fn().mockImplementationOnce(async (_url: unknown, opts: { body: string }) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { info: "ok" } }),
      };
    }) as unknown as typeof fetch;

    await handleMcp(step, { id: "abc", region: "us-east", extra: "ignored" });
    expect((capturedBody as { params: { arguments: Record<string, unknown> } }).params.arguments).toEqual({ id: "abc", region: "us-east" });
  });
});

// ---------------------------------------------------------------------------
// handleAgent
// ---------------------------------------------------------------------------

describe("handleAgent", () => {
  const mockGetProvider = getProvider as jest.Mock;

  beforeEach(() => {
    jest.restoreAllMocks();
    mockGetProvider.mockReset();
  });

  it("throws when no LLM provider is configured", async () => {
    jest.spyOn(llmConfigStore, "getDecryptedDefaultAsync").mockResolvedValue(undefined);
    const step = makeStep({ kind: "agent", subAgentSlots: 1 });
    await expect(handleAgent(step, {}, "run-1", "user-1")).rejects.toThrow("no LLM provider configured");
  });

  it("returns merged slot output on success", async () => {
    jest.spyOn(llmConfigStore, "getDecryptedDefaultAsync").mockResolvedValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as Awaited<ReturnType<typeof llmConfigStore.getDecryptedDefaultAsync>>);
    mockGetProvider.mockReturnValue(async () => ({ text: JSON.stringify({ answer: "42" }) }));

    const step = makeStep({ kind: "agent", subAgentSlots: 2, outputKeys: [] });
    const result = await handleAgent(step, { input: "question" }, "run-2", "user-1");

    expect(result.output["_agentSlots"]).toBe(2);
    expect(result.output["_agentSuccessCount"]).toBe(2);
    expect(result.output["slot_0"]).toBeDefined();
    expect(result.output["slot_1"]).toBeDefined();
    expect(result.agentSlotResults).toHaveLength(2);
  });

  it("records slot failure when provider throws", async () => {
    jest.spyOn(llmConfigStore, "getDecryptedDefaultAsync").mockResolvedValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as Awaited<ReturnType<typeof llmConfigStore.getDecryptedDefaultAsync>>);
    mockGetProvider.mockReturnValue(async () => { throw new Error("API timeout"); });

    const step = makeStep({ kind: "agent", subAgentSlots: 1 });
    const result = await handleAgent(step, {}, "run-3", "user-1");

    expect(result.output["_agentSuccessCount"]).toBe(0);
    expect(result.agentSlotResults![0].status).toBe("failure");
    expect(result.agentSlotResults![0].error).toContain("API timeout");
  });

  it("uses default 1 slot when subAgentSlots is undefined", async () => {
    jest.spyOn(llmConfigStore, "getDecryptedDefaultAsync").mockResolvedValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as Awaited<ReturnType<typeof llmConfigStore.getDecryptedDefaultAsync>>);
    mockGetProvider.mockReturnValue(async () => ({ text: '{"ok":true}' }));

    const step = makeStep({ kind: "agent" });
    const result = await handleAgent(step, {}, "run-4", "user-1");

    expect(result.output["_agentSlots"]).toBe(1);
  });

  it("handles non-JSON LLM response gracefully", async () => {
    jest.spyOn(llmConfigStore, "getDecryptedDefaultAsync").mockResolvedValue({
      config: { provider: "openai", model: "gpt-4" },
      apiKey: "sk-test",
    } as Awaited<ReturnType<typeof llmConfigStore.getDecryptedDefaultAsync>>);
    mockGetProvider.mockReturnValue(async () => ({ text: "plain text answer" }));

    const step = makeStep({ kind: "agent", subAgentSlots: 1 });
    const result = await handleAgent(step, {}, "run-5", "user-1");

    expect(result.output["_agentSuccessCount"]).toBe(1);
    const slotOutput = result.output["slot_0"] as Record<string, unknown>;
    expect(slotOutput["result"]).toBe("plain text answer");
  });
});
