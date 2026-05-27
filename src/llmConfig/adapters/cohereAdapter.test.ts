/**
 * Tests for the CohereAdapter (HEL-82).
 *
 * Mocks `global.fetch` — no real HTTP requests are made.
 */

import type { AgentTraceEvent } from "../../engine/agentTrace/types";
import { CohereAdapter } from "./cohereAdapter";

// ---------------------------------------------------------------------------
// Mock global fetch — CohereAdapter uses fetch directly.
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

function setupCohereOkMock(payload: Record<string, unknown>): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue(""),
    json: jest.fn().mockResolvedValue(payload),
  });
}

function setupCohereErrorMock(status: number, body: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: jest.fn().mockResolvedValue(body),
    json: jest.fn().mockResolvedValue({}),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Basic adapter contract
// ---------------------------------------------------------------------------

describe("CohereAdapter contract", () => {
  it("exposes provider='cohere'", () => {
    expect(new CohereAdapter().provider).toBe("cohere");
  });

  it("refuses to invoke without an API key", async () => {
    const adapter = new CohereAdapter();
    await expect(
      adapter.invoke({
        provider: "cohere",
        model: "command-r-plus",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key is required/);
  });
});

// ---------------------------------------------------------------------------
// invoke() — happy path + wire-format coverage
// ---------------------------------------------------------------------------

describe("CohereAdapter.invoke()", () => {
  const baseRequest = {
    provider: "cohere" as const,
    model: "command-r-plus",
    apiKey: "cohere-test-key",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  it("returns concatenated text content and maps usage tokens", async () => {
    setupCohereOkMock({
      id: "msg_1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Hi " },
          { type: "text", text: "there" },
        ],
      },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 12, output_tokens: 7 } },
    });
    const result = await new CohereAdapter().invoke(baseRequest);
    expect(result.content).toBe("Hi there");
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(7);
    expect(result.usage.cachedInputTokens).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });

  it("targets the Cohere v2 chat endpoint with a bearer auth header", async () => {
    setupCohereOkMock({
      id: "msg_url",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
    });
    await new CohereAdapter().invoke(baseRequest);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.cohere.com/v2/chat");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe("Bearer cohere-test-key");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("defaults usage tokens to 0 when the response omits usage", async () => {
    setupCohereOkMock({
      id: "msg_no_usage",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      finish_reason: "COMPLETE",
    });
    const result = await new CohereAdapter().invoke(baseRequest);
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });

  it("emits tool calls and parses string arguments as JSON", async () => {
    setupCohereOkMock({
      id: "msg_tc",
      message: {
        role: "assistant",
        content: [],
        tool_calls: [
          {
            id: "call_001",
            type: "function",
            function: { name: "search", arguments: '{"q":"cats"}' },
          },
        ],
        tool_plan: "I will search.",
      },
      finish_reason: "TOOL_CALL",
      usage: { tokens: { input_tokens: 8, output_tokens: 4 } },
    });
    const result = await new CohereAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "call_001", name: "search", arguments: { q: "cats" } },
    ]);
  });

  it("falls back to {} when tool_call arguments JSON is malformed", async () => {
    setupCohereOkMock({
      id: "msg_bad",
      message: {
        role: "assistant",
        content: [],
        tool_calls: [
          {
            id: "call_bad",
            type: "function",
            function: { name: "fn", arguments: "{not json" },
          },
        ],
      },
      finish_reason: "TOOL_CALL",
      usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
    });
    const result = await new CohereAdapter().invoke(baseRequest);
    expect(result.toolCalls[0]?.arguments).toEqual({});
  });

  it("sends response_format with json_object + schema when responseSchema is set", async () => {
    setupCohereOkMock({
      id: "msg_schema",
      message: {
        role: "assistant",
        content: [{ type: "text", text: '{"answer":42}' }],
      },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 5, output_tokens: 3 } },
    });
    await new CohereAdapter().invoke({
      ...baseRequest,
      responseSchema: {
        name: "my_output",
        schema: { type: "object", properties: { answer: { type: "number" } } },
      },
    });
    const [, init] = mockFetch.mock.calls[0] ?? [];
    const body = JSON.parse((init as { body: string }).body) as Record<
      string,
      unknown
    >;
    expect(body.response_format).toEqual({
      type: "json_object",
      schema: { type: "object", properties: { answer: { type: "number" } } },
    });
  });

  it("sends tools in the OpenAI-compatible function shape", async () => {
    setupCohereOkMock({
      id: "msg_tools",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 2, output_tokens: 1 } },
    });
    await new CohereAdapter().invoke({
      ...baseRequest,
      tools: [
        {
          name: "search",
          description: "Search the web",
          parameters: { type: "object" },
        },
      ],
    });
    const [, init] = mockFetch.mock.calls[0] ?? [];
    const body = JSON.parse((init as { body: string }).body) as Record<
      string,
      unknown
    >;
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
    setupCohereOkMock({
      id: "msg_sys",
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 2, output_tokens: 1 } },
    });
    await new CohereAdapter().invoke({
      ...baseRequest,
      system: "You are helpful.",
    });
    const [, init] = mockFetch.mock.calls[0] ?? [];
    const body = JSON.parse((init as { body: string }).body) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are helpful.",
    });
  });

  it("translates tool-role messages with toolResults into Cohere tool messages", async () => {
    setupCohereOkMock({
      id: "msg_tr",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "thanks" }],
      },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 2, output_tokens: 1 } },
    });
    await new CohereAdapter().invoke({
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
    const [, init] = mockFetch.mock.calls[0] ?? [];
    const body = JSON.parse((init as { body: string }).body) as {
      messages: Array<Record<string, unknown>>;
    };
    const toolMsg = body.messages.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({
      role: "tool",
      tool_call_id: "call_001",
      content: "Found",
    });
  });

  it("translates assistant-role messages with toolCalls into Cohere tool_calls format", async () => {
    setupCohereOkMock({
      id: "msg_assistant_tc",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 2, output_tokens: 1 } },
    });
    await new CohereAdapter().invoke({
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
    const [, init] = mockFetch.mock.calls[0] ?? [];
    const body = JSON.parse((init as { body: string }).body) as {
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

  it("wraps non-OK HTTP responses with a descriptive error", async () => {
    setupCohereErrorMock(429, "rate limited");
    await expect(new CohereAdapter().invoke(baseRequest)).rejects.toThrow(
      /Cohere adapter API error: 429 rate limited/,
    );
  });

  it("wraps fetch failures (Error instance) with a descriptive message", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Request timed out"));
    await expect(new CohereAdapter().invoke(baseRequest)).rejects.toThrow(
      "Cohere adapter API error: Request timed out",
    );
  });

  it("wraps non-Error fetch failures with a descriptive message", async () => {
    mockFetch.mockRejectedValueOnce("network blip");
    await expect(new CohereAdapter().invoke(baseRequest)).rejects.toThrow(
      "Cohere adapter API error: network blip",
    );
  });

  it("maps finish_reason=MAX_TOKENS to NormalizedFinishReason='length'", async () => {
    setupCohereOkMock({
      id: "msg_len",
      message: { role: "assistant", content: [{ type: "text", text: "..." }] },
      finish_reason: "MAX_TOKENS",
      usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
    });
    const result = await new CohereAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("length");
  });

  it("maps finish_reason=ERROR to NormalizedFinishReason='error'", async () => {
    setupCohereOkMock({
      id: "msg_err",
      message: { role: "assistant", content: [] },
      finish_reason: "ERROR",
      usage: { tokens: { input_tokens: 1, output_tokens: 0 } },
    });
    const result = await new CohereAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("error");
  });

  it("maps unknown finish_reason to 'unknown'", async () => {
    setupCohereOkMock({
      id: "msg_unknown",
      message: { role: "assistant", content: [{ type: "text", text: "..." }] },
      finish_reason: "something-else",
      usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
    });
    const result = await new CohereAdapter().invoke(baseRequest);
    expect(result.finishReason).toBe("unknown");
  });

  it("returns empty string content when no text blocks are present", async () => {
    setupCohereOkMock({
      id: "msg_no_text",
      message: { role: "assistant", content: [] },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 1, output_tokens: 0 } },
    });
    const result = await new CohereAdapter().invoke(baseRequest);
    expect(result.content).toBe("");
  });
});

// ---------------------------------------------------------------------------
// invokeStream() — emits trace events
// ---------------------------------------------------------------------------

describe("CohereAdapter.invokeStream()", () => {
  const baseRequest = {
    provider: "cohere" as const,
    model: "command-r-plus",
    apiKey: "cohere-test-key",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  it("falls back to invoke() when no onTrace is set", async () => {
    setupCohereOkMock({
      id: "msg_no_trace",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
    });
    const result = await new CohereAdapter().invokeStream(baseRequest);
    expect(result.content).toBe("hi");
  });

  it("emits assistant.delta + turn.completed events when onTrace is set", async () => {
    setupCohereOkMock({
      id: "msg_trace",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
      finish_reason: "COMPLETE",
      usage: { tokens: { input_tokens: 4, output_tokens: 2 } },
    });
    const events: AgentTraceEvent[] = [];
    const result = await new CohereAdapter().invokeStream({
      ...baseRequest,
      onTrace: (e) => events.push(e),
    });
    expect(result.content).toBe("Hello");
    const delta = events.find((e) => e.type === "assistant.delta");
    expect(delta).toMatchObject({
      type: "assistant.delta",
      delta: "Hello",
      accumulated: "Hello",
    });
    const turnCompleted = events.find((e) => e.type === "turn.completed");
    expect(turnCompleted).toMatchObject({
      type: "turn.completed",
      text: "Hello",
      usage: { promptTokens: 4, completionTokens: 2 },
    });
  });
});
