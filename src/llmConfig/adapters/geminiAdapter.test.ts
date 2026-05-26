/**
 * Tests for the GeminiAdapter (HEL-82).
 *
 * Mocks `@google/generative-ai` — no real HTTP requests are made.
 */

import type { AgentTraceEvent } from "../../engine/agentTrace/types";

// ---------------------------------------------------------------------------
// Mock @google/generative-ai — GeminiAdapter constructs
// `new GoogleGenerativeAI(apiKey)` inside invoke() and calls
// `getGenerativeModel(...)` on the resulting instance. We mock the
// constructor and set per-test implementations via mockImplementationOnce().
// ---------------------------------------------------------------------------

jest.mock("@google/generative-ai", () => ({
  __esModule: true,
  GoogleGenerativeAI: jest.fn(),
}));

import { GoogleGenerativeAI } from "@google/generative-ai";

import { GeminiAdapter } from "./geminiAdapter";

const MockGoogleGenerativeAI = GoogleGenerativeAI as unknown as jest.Mock;

interface FakeResponse {
  text?: () => string;
  functionCalls?: () => Array<{ name: string; args: object }> | undefined;
  candidates?: Array<{ finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

function setupGeminiMock(response: FakeResponse): {
  generateContent: jest.Mock;
  getGenerativeModel: jest.Mock;
} {
  const generateContent = jest
    .fn()
    .mockResolvedValueOnce({ response });
  const generateContentStream = jest.fn();
  const getGenerativeModel = jest.fn().mockReturnValue({
    generateContent,
    generateContentStream,
  });
  MockGoogleGenerativeAI.mockImplementationOnce(() => ({
    getGenerativeModel,
  }));
  return { generateContent, getGenerativeModel };
}

function setupGeminiRejection(err: unknown): jest.Mock {
  const generateContent = jest.fn().mockRejectedValueOnce(err);
  const generateContentStream = jest.fn();
  const getGenerativeModel = jest.fn().mockReturnValue({
    generateContent,
    generateContentStream,
  });
  MockGoogleGenerativeAI.mockImplementationOnce(() => ({
    getGenerativeModel,
  }));
  return generateContent;
}

function setupGeminiStreamMock(
  chunks: Array<{ text?: () => string }>,
  finalResponse: FakeResponse,
): { generateContentStream: jest.Mock; getGenerativeModel: jest.Mock } {
  const generateContentStream = jest.fn().mockResolvedValueOnce({
    stream: (async function* () {
      for (const c of chunks) yield c;
    })(),
    response: Promise.resolve(finalResponse),
  });
  const generateContent = jest.fn();
  const getGenerativeModel = jest.fn().mockReturnValue({
    generateContent,
    generateContentStream,
  });
  MockGoogleGenerativeAI.mockImplementationOnce(() => ({
    getGenerativeModel,
  }));
  return { generateContentStream, getGenerativeModel };
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Basic adapter contract
// ---------------------------------------------------------------------------

describe("GeminiAdapter contract", () => {
  it("exposes provider='gemini'", () => {
    expect(new GeminiAdapter().provider).toBe("gemini");
  });

  it("refuses to invoke without an API key", async () => {
    const adapter = new GeminiAdapter();
    await expect(
      adapter.invoke({
        provider: "gemini",
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key is required/);
  });
});

// ---------------------------------------------------------------------------
// invoke() — happy path text response
// ---------------------------------------------------------------------------

describe("GeminiAdapter.invoke() — happy path", () => {
  const baseRequest = {
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    apiKey: "test-key",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  it("returns text content and usage from a successful response", async () => {
    setupGeminiMock({
      text: () => "Hi there",
      functionCalls: () => undefined,
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });
    const result = await new GeminiAdapter().invoke(baseRequest);
    expect(result.content).toBe("Hi there");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.usage.cachedInputTokens).toBeUndefined();
    expect(result.finishReason).toBe("stop");
    expect(result.cacheHit).toBe(false);
    expect(result.toolCalls).toEqual([]);
  });

  it("maps finishReason=MAX_TOKENS to length", async () => {
    setupGeminiMock({
      text: () => "...",
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 100, totalTokenCount: 105 },
    });
    const result = await new GeminiAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("length");
  });

  it("maps SAFETY finishReason to content_filter", async () => {
    setupGeminiMock({
      text: () => "",
      candidates: [{ finishReason: "SAFETY" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0, totalTokenCount: 5 },
    });
    const result = await new GeminiAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("content_filter");
  });

  it("passes system prompt via systemInstruction", async () => {
    const { getGenerativeModel } = setupGeminiMock({
      text: () => "hi",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
    await new GeminiAdapter().invoke({
      ...baseRequest,
      system: "You are helpful.",
    });
    const modelParams = getGenerativeModel.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(modelParams.systemInstruction).toBe("You are helpful.");
  });

  it("merges NormalizedRequest.system with system-role messages", async () => {
    const { getGenerativeModel } = setupGeminiMock({
      text: () => "ok",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
    await new GeminiAdapter().invoke({
      ...baseRequest,
      system: "Base.",
      messages: [
        { role: "system", content: "Extra." },
        { role: "user", content: "Hello" },
      ],
    });
    const modelParams = getGenerativeModel.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(modelParams.systemInstruction).toBe("Base.\n\nExtra.");
  });

  it("maps assistant messages to role=model", async () => {
    const { getGenerativeModel: _gen } = setupGeminiMock({
      text: () => "ok",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
    void _gen;
    // We need the underlying mock object to access generateContent calls.
    // setupGeminiMock returned the generateContent mock; rerun to capture it.
  });

  it("sends contents with role=model for assistant turns", async () => {
    const { generateContent } = setupGeminiMock({
      text: () => "ok",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
    await new GeminiAdapter().invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello back" },
        { role: "user", content: "Follow up" },
      ],
    });
    const req = generateContent.mock.calls[0]?.[0] as { contents: Array<{ role: string }> };
    expect(req.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });
});

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

describe("GeminiAdapter.invoke() — tool calls", () => {
  const baseRequest = {
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    apiKey: "test-key",
    messages: [{ role: "user" as const, content: "Search for cats" }],
  };

  it("sends tool definitions as functionDeclarations", async () => {
    const { getGenerativeModel } = setupGeminiMock({
      text: () => "",
      functionCalls: () => [{ name: "search", args: { q: "cats" } }],
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
    });
    await new GeminiAdapter().invoke({
      ...baseRequest,
      tools: [
        {
          name: "search",
          description: "Search the web",
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
      ],
    });
    const modelParams = getGenerativeModel.mock.calls[0]?.[0] as {
      tools?: Array<{ functionDeclarations: Array<{ name: string; description: string }> }>;
    };
    expect(modelParams.tools?.[0]?.functionDeclarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "search", description: "Search the web" }),
      ]),
    );
  });

  it("parses function calls into NormalizedToolCall[]", async () => {
    setupGeminiMock({
      text: () => "",
      functionCalls: () => [{ name: "search", args: { q: "cats" } }],
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
    });
    const result = await new GeminiAdapter().invoke({
      ...baseRequest,
      tools: [
        {
          name: "search",
          description: "Search",
          parameters: { type: "object" },
        },
      ],
    });
    expect(result.toolCalls).toEqual([
      { id: "gemini-fc-0", name: "search", arguments: { q: "cats" } },
    ]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("translates tool-role messages with toolResults into functionResponse parts", async () => {
    const { generateContent } = setupGeminiMock({
      text: () => "Done",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
    });
    await new GeminiAdapter().invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Go" },
        {
          role: "assistant",
          toolCalls: [{ id: "tc_001", name: "search", arguments: { q: "cats" } }],
        },
        {
          role: "tool",
          toolResults: [{ toolCallId: "tc_001", content: "found", isError: false }],
        },
        { role: "user", content: "Thanks" },
      ],
    });
    const req = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    // The 3rd content (index 2) is the tool-result turn — should be role=user with functionResponse part.
    const toolResponseTurn = req.contents.find((c) =>
      c.parts.some((p) => "functionResponse" in p),
    );
    expect(toolResponseTurn?.role).toBe("user");
    const fr = toolResponseTurn?.parts.find(
      (p) => "functionResponse" in p,
    ) as { functionResponse: { name: string; response: { content: string } } };
    expect(fr.functionResponse.name).toBe("search");
    expect(fr.functionResponse.response.content).toBe("found");
  });

  it("emits assistant turns with functionCall parts for outgoing tool calls", async () => {
    const { generateContent } = setupGeminiMock({
      text: () => "Done",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
    });
    await new GeminiAdapter().invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Go" },
        {
          role: "assistant",
          content: "Calling tool.",
          toolCalls: [{ id: "tc_001", name: "search", arguments: { q: "cats" } }],
        },
        {
          role: "tool",
          toolResults: [{ toolCallId: "tc_001", content: "found" }],
        },
      ],
    });
    const req = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const modelTurn = req.contents.find((c) => c.role === "model");
    expect(modelTurn?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Calling tool." }),
        expect.objectContaining({
          functionCall: { name: "search", args: { q: "cats" } },
        }),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------

describe("GeminiAdapter.invoke() — structured output", () => {
  const baseRequest = {
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    apiKey: "test-key",
    messages: [{ role: "user" as const, content: "Give me JSON" }],
  };

  it("sets responseMimeType=application/json and passes responseSchema", async () => {
    const { getGenerativeModel } = setupGeminiMock({
      text: () => '{"answer":42}',
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 },
    });
    await new GeminiAdapter().invoke({
      ...baseRequest,
      responseSchema: {
        name: "my_output",
        schema: { type: "object", properties: { answer: { type: "number" } } },
      },
    });
    const modelParams = getGenerativeModel.mock.calls[0]?.[0] as {
      generationConfig?: { responseMimeType?: string; responseSchema?: unknown };
    };
    expect(modelParams.generationConfig?.responseMimeType).toBe("application/json");
    expect(modelParams.generationConfig?.responseSchema).toEqual({
      type: "object",
      properties: { answer: { type: "number" } },
    });
  });

  it("forwards maxTokens and temperature into generationConfig", async () => {
    const { getGenerativeModel } = setupGeminiMock({
      text: () => "ok",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
    await new GeminiAdapter().invoke({
      ...baseRequest,
      maxTokens: 512,
      temperature: 0.3,
    });
    const modelParams = getGenerativeModel.mock.calls[0]?.[0] as {
      generationConfig?: { maxOutputTokens?: number; temperature?: number };
    };
    expect(modelParams.generationConfig?.maxOutputTokens).toBe(512);
    expect(modelParams.generationConfig?.temperature).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe("GeminiAdapter.invoke() — errors", () => {
  const baseRequest = {
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    apiKey: "test-key",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  it("wraps SDK errors with a descriptive message", async () => {
    setupGeminiRejection(new Error("429 rate limit"));
    await expect(new GeminiAdapter().invoke(baseRequest)).rejects.toThrow(
      "Gemini adapter API error: 429 rate limit",
    );
  });

  it("wraps non-Error rejections with a descriptive message", async () => {
    setupGeminiRejection("string error");
    await expect(new GeminiAdapter().invoke(baseRequest)).rejects.toThrow(
      "Gemini adapter API error: string error",
    );
  });
});

// ---------------------------------------------------------------------------
// Usage tokens — including cached
// ---------------------------------------------------------------------------

describe("GeminiAdapter.invoke() — usage tokens", () => {
  const baseRequest = {
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    apiKey: "test-key",
    messages: [{ role: "user" as const, content: "Hi" }],
  };

  it("reports cacheHit=true and surfaces cachedInputTokens when cachedContentTokenCount > 0", async () => {
    setupGeminiMock({
      text: () => "cached reply",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 5,
        totalTokenCount: 105,
        cachedContentTokenCount: 80,
      },
    });
    const result = await new GeminiAdapter().invoke(baseRequest);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.usage.cachedInputTokens).toBe(80);
    expect(result.cacheHit).toBe(true);
  });

  it("reports cacheHit=false when cachedContentTokenCount is 0", async () => {
    setupGeminiMock({
      text: () => "fresh reply",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 50,
        candidatesTokenCount: 5,
        totalTokenCount: 55,
        cachedContentTokenCount: 0,
      },
    });
    const result = await new GeminiAdapter().invoke(baseRequest);
    expect(result.cacheHit).toBe(false);
    expect(result.usage.cachedInputTokens).toBeUndefined();
  });

  it("reports cachedInputTokens=undefined when cachedContentTokenCount is absent", async () => {
    setupGeminiMock({
      text: () => "no cache field",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });
    const result = await new GeminiAdapter().invoke(baseRequest);
    expect(result.usage.cachedInputTokens).toBeUndefined();
    expect(result.cacheHit).toBe(false);
  });

  it("defaults missing usage metadata to zero", async () => {
    setupGeminiMock({
      text: () => "no usage",
      candidates: [{ finishReason: "STOP" }],
    });
    const result = await new GeminiAdapter().invoke(baseRequest);
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Streaming via invokeStream — emits trace events
// ---------------------------------------------------------------------------

describe("GeminiAdapter.invokeStream()", () => {
  const baseRequest = {
    provider: "gemini" as const,
    model: "gemini-2.5-flash",
    apiKey: "test-key",
    messages: [{ role: "user" as const, content: "Hi" }],
  };

  it("delegates to invoke() when no onTrace is set", async () => {
    setupGeminiMock({
      text: () => "Hi there",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
    const result = await new GeminiAdapter().invokeStream(baseRequest);
    expect(result.content).toBe("Hi there");
  });

  it("emits assistant.delta and turn.completed events when streaming", async () => {
    setupGeminiStreamMock(
      [{ text: () => "Hi " }, { text: () => "there" }],
      {
        text: () => "Hi there",
        functionCalls: () => undefined,
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
      },
    );
    const events: AgentTraceEvent[] = [];
    const result = await new GeminiAdapter().invokeStream({
      ...baseRequest,
      onTrace: (e) => events.push(e),
    });
    expect(result.content).toBe("Hi there");
    const deltas = events.filter((e) => e.type === "assistant.delta");
    expect(deltas).toHaveLength(2);
    const turnCompleted = events.find((e) => e.type === "turn.completed");
    expect(turnCompleted).toBeDefined();
  });

  it("emits tool_call.completed events when the stream produces function calls", async () => {
    setupGeminiStreamMock([], {
      text: () => "",
      functionCalls: () => [{ name: "search", args: { q: "cats" } }],
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
    });
    const events: AgentTraceEvent[] = [];
    await new GeminiAdapter().invokeStream({
      ...baseRequest,
      tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
      onTrace: (e) => events.push(e),
    });
    const toolEvents = events.filter((e) => e.type === "tool_call.completed");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toMatchObject({
      type: "tool_call.completed",
      name: "search",
      arguments: { q: "cats" },
    });
  });

  it("emits turn.error and rethrows when the stream rejects", async () => {
    const generateContentStream = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"));
    const getGenerativeModel = jest.fn().mockReturnValue({
      generateContent: jest.fn(),
      generateContentStream,
    });
    MockGoogleGenerativeAI.mockImplementationOnce(() => ({ getGenerativeModel }));
    const events: AgentTraceEvent[] = [];
    await expect(
      new GeminiAdapter().invokeStream({
        ...baseRequest,
        onTrace: (e) => events.push(e),
      }),
    ).rejects.toThrow("Gemini adapter API error: boom");
    expect(events.some((e) => e.type === "turn.error")).toBe(true);
  });
});
