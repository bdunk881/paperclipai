/**
 * Tests for the MistralAdapter (HEL-82).
 *
 * Mocks `@mistralai/mistralai` — no real HTTP requests are made.
 */

import type { AgentTraceEvent } from "../../engine/agentTrace/types";

// ---------------------------------------------------------------------------
// Mock the SDK loader, NOT the SDK package itself. The Mistral SDK is
// ESM-only; the adapter loads it via a dynamic `import()` that Jest
// can't intercept (see ./sdkLoaders for why). Mocking the loader is
// the seam that lets tests inject a stub constructor.
// ---------------------------------------------------------------------------

const MockMistral = jest.fn();
jest.mock("./sdkLoaders", () => ({
  loadMistralSdk: jest.fn(() => Promise.resolve({ Mistral: MockMistral })),
}));

import { MistralAdapter } from "./mistralAdapter";

function setupMistralCompleteMock(response: Record<string, unknown>): jest.Mock {
  const mockComplete = jest.fn().mockResolvedValueOnce(response);
  const mockStream = jest.fn();
  MockMistral.mockImplementationOnce(() => ({
    chat: { complete: mockComplete, stream: mockStream },
  }));
  return mockComplete;
}

function setupMistralCompleteRejection(err: unknown): jest.Mock {
  const mockComplete = jest.fn().mockRejectedValueOnce(err);
  const mockStream = jest.fn();
  MockMistral.mockImplementationOnce(() => ({
    chat: { complete: mockComplete, stream: mockStream },
  }));
  return mockComplete;
}

function setupMistralStreamMock(chunks: unknown[]): {
  mockStream: jest.Mock;
  mockComplete: jest.Mock;
} {
  const mockStream = jest.fn().mockResolvedValueOnce({
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  });
  const mockComplete = jest.fn();
  MockMistral.mockImplementationOnce(() => ({
    chat: { complete: mockComplete, stream: mockStream },
  }));
  return { mockStream, mockComplete };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Basic adapter contract
// ---------------------------------------------------------------------------

describe("MistralAdapter contract", () => {
  it("exposes provider='mistral'", () => {
    expect(new MistralAdapter().provider).toBe("mistral");
  });

  it("refuses to invoke without an API key", async () => {
    const adapter = new MistralAdapter();
    await expect(
      adapter.invoke({
        provider: "mistral",
        model: "mistral-large-latest",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key is required/);
  });
});

// ---------------------------------------------------------------------------
// invoke() — happy path + wire-format coverage
// ---------------------------------------------------------------------------

describe("MistralAdapter.invoke()", () => {
  const baseRequest = {
    provider: "mistral" as const,
    model: "mistral-large-latest",
    apiKey: "mistral-test-key",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  it("returns text content and maps camelCase usage tokens", async () => {
    setupMistralCompleteMock({
      id: "msg_1",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hi there" },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 12, completionTokens: 7 },
    });
    const result = await new MistralAdapter().invoke(baseRequest);
    expect(result.content).toBe("Hi there");
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(7);
    expect(result.finishReason).toBe("stop");
  });

  it("defaults usage tokens to 0 when the response omits usage", async () => {
    setupMistralCompleteMock({
      id: "msg_no_usage",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "no usage block" },
          finishReason: "stop",
        },
      ],
    });
    const result = await new MistralAdapter().invoke(baseRequest);
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });

  it("emits tool calls and parses string arguments as JSON", async () => {
    setupMistralCompleteMock({
      id: "msg_2",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "call_001",
                type: "function",
                function: { name: "search", arguments: '{"q":"cats"}' },
              },
            ],
          },
          finishReason: "tool_calls",
        },
      ],
      usage: { promptTokens: 8, completionTokens: 4 },
    });
    const result = await new MistralAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "call_001", name: "search", arguments: { q: "cats" } },
    ]);
  });

  it("accepts tool_call arguments that are already an object", async () => {
    setupMistralCompleteMock({
      id: "msg_3",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "call_obj",
                type: "function",
                function: { name: "fn", arguments: { x: 1 } },
              },
            ],
          },
          finishReason: "tool_calls",
        },
      ],
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const result = await new MistralAdapter().invoke(baseRequest);
    expect(result.toolCalls[0]?.arguments).toEqual({ x: 1 });
  });

  it("falls back to {} when tool_call arguments JSON is malformed", async () => {
    setupMistralCompleteMock({
      id: "msg_bad",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "call_bad",
                type: "function",
                function: { name: "fn", arguments: "{not json" },
              },
            ],
          },
          finishReason: "tool_calls",
        },
      ],
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const result = await new MistralAdapter().invoke(baseRequest);
    expect(result.toolCalls[0]?.arguments).toEqual({});
  });

  it("sends Mistral's camelCase responseFormat when responseSchema is set", async () => {
    const mockComplete = setupMistralCompleteMock({
      id: "msg_schema",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: '{"answer":42}' },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 5, completionTokens: 3 },
    });
    await new MistralAdapter().invoke({
      ...baseRequest,
      responseSchema: {
        name: "my_output",
        schema: { type: "object", properties: { answer: { type: "number" } } },
      },
    });
    const body = mockComplete.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.responseFormat).toEqual({
      type: "json_schema",
      jsonSchema: {
        name: "my_output",
        schemaDefinition: {
          type: "object",
          properties: { answer: { type: "number" } },
        },
        strict: true,
      },
    });
  });

  it("sends tools in the OpenAI-compatible function shape", async () => {
    const mockComplete = setupMistralCompleteMock({
      id: "msg_tools",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 2, completionTokens: 1 },
    });
    await new MistralAdapter().invoke({
      ...baseRequest,
      tools: [
        {
          name: "search",
          description: "Search the web",
          parameters: { type: "object" },
        },
      ],
    });
    const body = mockComplete.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "Search the web",
          parameters: { type: "object" },
        },
      },
    ]);
  });

  it("prepends a system role message when NormalizedRequest.system is set", async () => {
    const mockComplete = setupMistralCompleteMock({
      id: "msg_sys",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 2, completionTokens: 1 },
    });
    await new MistralAdapter().invoke({
      ...baseRequest,
      system: "You are helpful.",
    });
    const body = mockComplete.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are helpful.",
    });
  });

  it("translates tool-role messages with toolResults into Mistral tool messages", async () => {
    const mockComplete = setupMistralCompleteMock({
      id: "msg_toolresult",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "thanks" },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 2, completionTokens: 1 },
    });
    await new MistralAdapter().invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Search" },
        {
          role: "tool",
          toolResults: [{ toolCallId: "call_001", content: "Found" }],
        },
        { role: "user", content: "ok" },
      ],
    });
    const body = mockComplete.mock.calls[0]?.[0] as {
      messages: Array<Record<string, unknown>>;
    };
    const toolMsg = body.messages.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({
      role: "tool",
      tool_call_id: "call_001",
      content: "Found",
    });
  });

  it("translates assistant-role messages with toolCalls into Mistral tool_calls format", async () => {
    const mockComplete = setupMistralCompleteMock({
      id: "msg_assistant_tc",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 2, completionTokens: 1 },
    });
    await new MistralAdapter().invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Go" },
        {
          role: "assistant",
          content: "Calling.",
          toolCalls: [{ id: "tc_01", name: "fn", arguments: { x: 1 } }],
        },
        {
          role: "tool",
          toolResults: [{ toolCallId: "tc_01", content: "done" }],
        },
        { role: "user", content: "ok" },
      ],
    });
    const body = mockComplete.mock.calls[0]?.[0] as {
      messages: Array<Record<string, unknown>>;
    };
    const assistantMsg = body.messages.find(
      (m) => m.role === "assistant",
    ) as { tool_calls: Array<Record<string, unknown>> };
    expect(assistantMsg.tool_calls).toEqual([
      {
        id: "tc_01",
        type: "function",
        function: { name: "fn", arguments: JSON.stringify({ x: 1 }) },
      },
    ]);
  });

  it("wraps API errors (Error instance) with a descriptive message", async () => {
    setupMistralCompleteRejection(new Error("Request timed out"));
    await expect(new MistralAdapter().invoke(baseRequest)).rejects.toThrow(
      "Mistral adapter API error: Request timed out",
    );
  });

  it("wraps non-Error API failures with a descriptive message", async () => {
    setupMistralCompleteRejection("network blip");
    await expect(new MistralAdapter().invoke(baseRequest)).rejects.toThrow(
      "Mistral adapter API error: network blip",
    );
  });

  it("maps finishReason=length to NormalizedFinishReason='length'", async () => {
    setupMistralCompleteMock({
      id: "msg_len",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "..." },
          finishReason: "length",
        },
      ],
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const result = await new MistralAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("length");
  });

  it("maps unknown finishReason to 'unknown'", async () => {
    setupMistralCompleteMock({
      id: "msg_unknown",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "..." },
          finishReason: "something-else",
        },
      ],
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const result = await new MistralAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("unknown");
  });

  it("flattens array content (multimodal-shaped) into a single string", async () => {
    setupMistralCompleteMock({
      id: "msg_array_content",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "world" },
            ],
          },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 2, completionTokens: 1 },
    });
    const result = await new MistralAdapter().invoke(baseRequest);
    expect(result.content).toBe("Hello world");
  });
});

// ---------------------------------------------------------------------------
// invokeStream() — emits trace events
// ---------------------------------------------------------------------------

describe("MistralAdapter.invokeStream()", () => {
  const baseRequest = {
    provider: "mistral" as const,
    model: "mistral-large-latest",
    apiKey: "mistral-test-key",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  it("falls back to invoke() when no onTrace is set", async () => {
    setupMistralCompleteMock({
      id: "msg_no_trace",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hi" },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const result = await new MistralAdapter().invokeStream(baseRequest);
    expect(result.content).toBe("hi");
  });

  it("emits assistant.delta + turn.completed events from streamed chunks", async () => {
    setupMistralStreamMock([
      {
        data: {
          choices: [{ delta: { content: "Hel" }, finishReason: null }],
        },
      },
      {
        data: {
          choices: [{ delta: { content: "lo" }, finishReason: null }],
        },
      },
      {
        data: {
          choices: [{ delta: {}, finishReason: "stop" }],
          usage: { promptTokens: 4, completionTokens: 2 },
        },
      },
    ]);
    const events: AgentTraceEvent[] = [];
    const result = await new MistralAdapter().invokeStream({
      ...baseRequest,
      onTrace: (e) => events.push(e),
    });
    expect(result.content).toBe("Hello");
    expect(result.usage.inputTokens).toBe(4);
    expect(result.usage.outputTokens).toBe(2);
    const deltas = events.filter((e) => e.type === "assistant.delta");
    expect(deltas.length).toBe(2);
    const turnCompleted = events.find((e) => e.type === "turn.completed");
    expect(turnCompleted).toBeDefined();
  });

  it("emits tool_call.completed events with parsed arguments", async () => {
    setupMistralStreamMock([
      {
        data: {
          choices: [
            {
              delta: {
                toolCalls: [
                  {
                    id: "tc_stream",
                    type: "function",
                    function: { name: "search", arguments: '{"q":' },
                  },
                ],
              },
              finishReason: null,
            },
          ],
        },
      },
      {
        data: {
          choices: [
            {
              delta: {
                toolCalls: [
                  {
                    id: "tc_stream",
                    type: "function",
                    function: { name: "search", arguments: '"cats"}' },
                  },
                ],
              },
              finishReason: "tool_calls",
            },
          ],
          usage: { promptTokens: 3, completionTokens: 2 },
        },
      },
    ]);
    const events: AgentTraceEvent[] = [];
    const result = await new MistralAdapter().invokeStream({
      ...baseRequest,
      onTrace: (e) => events.push(e),
    });
    expect(result.toolCalls).toEqual([
      { id: "tc_stream", name: "search", arguments: { q: "cats" } },
    ]);
    const toolCompleted = events.find(
      (e) => e.type === "tool_call.completed",
    );
    expect(toolCompleted).toMatchObject({
      type: "tool_call.completed",
      callId: "tc_stream",
      name: "search",
      arguments: { q: "cats" },
    });
  });

  it("wraps streaming errors with a descriptive message", async () => {
    const mockStream = jest.fn().mockRejectedValueOnce(new Error("stream blew up"));
    MockMistral.mockImplementationOnce(() => ({
      chat: { complete: jest.fn(), stream: mockStream },
    }));
    await expect(
      new MistralAdapter().invokeStream({
        ...baseRequest,
        onTrace: () => {},
      }),
    ).rejects.toThrow("Mistral adapter API error: stream blew up");
  });
});
