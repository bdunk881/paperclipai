/**
 * Tests for the provider adapter registry (HEL-82) and the
 * AnthropicAdapter / OpenAIAdapter invoke() wire-format (HEL-145).
 *
 * All external SDK calls are mocked — no real HTTP requests are made.
 */

import { getProviderAdapter, getSupportedAdapterProviders } from "./index";

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk — AnthropicAdapter creates `new Anthropic()` inside
// invoke(), so we mock the constructor here and set up per-test implementations
// via MockAnthropic.mockImplementationOnce() before each invoke call.
// ---------------------------------------------------------------------------

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import Anthropic from "@anthropic-ai/sdk";

const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

function setupAnthropicMock(
  response: Record<string, unknown>,
): jest.Mock {
  const mockCreate = jest.fn().mockResolvedValueOnce(response);
  MockAnthropic.mockImplementationOnce(
    () => ({ messages: { create: mockCreate } }) as unknown as Anthropic,
  );
  return mockCreate;
}

// ---------------------------------------------------------------------------
// Mock global fetch — OpenAIAdapter uses fetch directly.
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

function setupOpenAIMock(
  choices: Array<{ message: { content: string | null; tool_calls?: unknown[] }; finish_reason: string | null }>,
  usage = { prompt_tokens: 10, completion_tokens: 5 },
) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue(""),
    json: jest.fn().mockResolvedValue({ id: "chatcmpl-test", choices, usage }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Registry smoke tests
// ---------------------------------------------------------------------------

describe("provider adapter registry (HEL-82)", () => {
  it("returns the Anthropic adapter for provider='anthropic'", () => {
    const adapter = getProviderAdapter("anthropic");
    expect(adapter.provider).toBe("anthropic");
    expect(typeof adapter.invoke).toBe("function");
  });

  it("returns the OpenAI adapter for provider='openai'", () => {
    const adapter = getProviderAdapter("openai");
    expect(adapter.provider).toBe("openai");
    expect(typeof adapter.invoke).toBe("function");
  });

  it("throws a clear error for unimplemented providers (e.g., gemini in v1)", () => {
    expect(() => getProviderAdapter("gemini")).toThrow(/not implemented.*v1/);
  });

  it("lists the v1 supported providers", () => {
    const supported = getSupportedAdapterProviders().sort();
    expect(supported).toEqual(["anthropic", "openai"]);
  });

  it("Anthropic adapter refuses to invoke without an API key", async () => {
    const adapter = getProviderAdapter("anthropic");
    await expect(
      adapter.invoke({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key is required/);
  });

  it("OpenAI adapter refuses to invoke without an API key", async () => {
    const adapter = getProviderAdapter("openai");
    await expect(
      adapter.invoke({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/API key is required/);
  });
});

// ---------------------------------------------------------------------------
// AnthropicAdapter.invoke() — wire-format coverage
// ---------------------------------------------------------------------------

describe("AnthropicAdapter.invoke()", () => {
  const baseRequest = {
    provider: "anthropic" as const,
    model: "claude-haiku-4-5-20251001",
    apiKey: "sk-ant-test",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  function basicResponse(overrides: Record<string, unknown> = {}) {
    return {
      content: [{ type: "text", text: "Hi there" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
      ...overrides,
    };
  }

  it("returns text content and usage from a successful response", async () => {
    setupAnthropicMock(basicResponse());
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.content).toBe("Hi there");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.cacheHit).toBe(false);
  });

  it("maps stop_reason=end_turn to finishReason=stop", async () => {
    setupAnthropicMock(basicResponse({ stop_reason: "end_turn" }));
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.finishReason).toBe("stop");
  });

  it("maps stop_reason=max_tokens to finishReason=length", async () => {
    setupAnthropicMock(basicResponse({ stop_reason: "max_tokens" }));
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.finishReason).toBe("length");
  });

  it("maps stop_reason=tool_use to finishReason=tool_calls", async () => {
    setupAnthropicMock(basicResponse({ stop_reason: "tool_use" }));
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("maps stop_reason=stop_sequence to finishReason=stop", async () => {
    setupAnthropicMock(basicResponse({ stop_reason: "stop_sequence" }));
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.finishReason).toBe("stop");
  });

  it("maps unknown stop_reason to finishReason=unknown", async () => {
    setupAnthropicMock(basicResponse({ stop_reason: null }));
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.finishReason).toBe("unknown");
  });

  it("merges system-role messages into the system field", async () => {
    const mockCreate = setupAnthropicMock(basicResponse());
    await getProviderAdapter("anthropic").invoke({
      ...baseRequest,
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    });
    const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.system).toBe("You are helpful.");
  });

  it("merges NormalizedRequest.system with system-role messages", async () => {
    const mockCreate = setupAnthropicMock(basicResponse());
    await getProviderAdapter("anthropic").invoke({
      ...baseRequest,
      system: "Base system.",
      messages: [
        { role: "system", content: "Extra instruction." },
        { role: "user", content: "Hello" },
      ],
    });
    const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.system).toBe("Base system.\n\nExtra instruction.");
  });

  it("converts tool-role messages with toolResults into user tool_result blocks", async () => {
    const mockCreate = setupAnthropicMock(basicResponse());
    await getProviderAdapter("anthropic").invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Search" },
        { role: "tool", toolResults: [{ toolCallId: "call_001", content: "Found", isError: false }] },
        { role: "user", content: "Thanks" },
      ],
    });
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: unknown }> };
    const toolResultMsg = call.messages.find((m) => m.role === "user" && Array.isArray(m.content));
    expect(toolResultMsg?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_result", tool_use_id: "call_001", is_error: false }),
      ]),
    );
  });

  it("marks tool results as is_error when isError is true", async () => {
    const mockCreate = setupAnthropicMock(basicResponse());
    await getProviderAdapter("anthropic").invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Go" },
        { role: "tool", toolResults: [{ toolCallId: "call_err", content: "Oops", isError: true }] },
        { role: "user", content: "OK" },
      ],
    });
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: unknown }> };
    const toolResultMsg = call.messages.find((m) => m.role === "user" && Array.isArray(m.content));
    expect(toolResultMsg?.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ is_error: true })]),
    );
  });

  it("converts assistant-role messages with toolCalls into tool_use blocks", async () => {
    const mockCreate = setupAnthropicMock(basicResponse());
    await getProviderAdapter("anthropic").invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Search" },
        {
          role: "assistant",
          content: "I'll search.",
          toolCalls: [{ id: "tc_001", name: "search", arguments: { q: "cats" } }],
        },
        { role: "tool", toolResults: [{ toolCallId: "tc_001", content: "Cats found" }] },
        { role: "user", content: "Thanks" },
      ],
    });
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: unknown }> };
    const assistantMsg = call.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "I'll search." }),
        expect.objectContaining({ type: "tool_use", id: "tc_001" }),
      ]),
    );
  });

  it("creates assistant content block with no text when content is missing", async () => {
    const mockCreate = setupAnthropicMock(basicResponse());
    await getProviderAdapter("anthropic").invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Go" },
        { role: "assistant", toolCalls: [{ id: "tc_002", name: "fn", arguments: {} }] },
        { role: "tool", toolResults: [{ toolCallId: "tc_002", content: "done" }] },
        { role: "user", content: "ok" },
      ],
    });
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: Array<{ type: string }> }> };
    const assistantMsg = call.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.content.some((b) => b.type === "text")).toBe(false);
    expect(assistantMsg?.content.some((b) => b.type === "tool_use")).toBe(true);
  });

  it("sends tools in Anthropic's Tool format", async () => {
    const mockCreate = setupAnthropicMock(basicResponse());
    await getProviderAdapter("anthropic").invoke({
      ...baseRequest,
      tools: [{ name: "search", description: "Search the web", parameters: { type: "object" } }],
    });
    const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "search" })]),
    );
  });

  it("uses forced tool-use when responseSchema is set and parses the tool_use result as toolCalls", async () => {
    const mockCreate = setupAnthropicMock({
      content: [{ type: "tool_use", id: "tu_1", name: "__structured_output__", input: { answer: 42 } }],
      usage: { input_tokens: 8, output_tokens: 3 },
      stop_reason: "tool_use",
    });
    const result = await getProviderAdapter("anthropic").invoke({
      ...baseRequest,
      responseSchema: {
        name: "my_output",
        schema: { type: "object", properties: { answer: { type: "number" } } },
      },
    });
    const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.tool_choice).toEqual({ type: "tool", name: "__structured_output__" });
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "__structured_output__", arguments: { answer: 42 } })]),
    );
  });

  it("returns empty arguments for tool_use blocks whose input is not an object", async () => {
    setupAnthropicMock({
      content: [{ type: "tool_use", id: "tu_bad", name: "fn", input: "not-an-object" }],
      usage: { input_tokens: 5, output_tokens: 2 },
      stop_reason: "tool_use",
    });
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.toolCalls[0]?.arguments).toEqual({});
  });

  it("reports cacheHit=true and surfaces cachedInputTokens when cache_read_input_tokens > 0", async () => {
    setupAnthropicMock({
      content: [{ type: "text", text: "cached" }],
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 100 },
      stop_reason: "end_turn",
    });
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.cacheHit).toBe(true);
    expect(result.usage.cachedInputTokens).toBe(100);
  });

  it("reports cacheHit=false when cache_read_input_tokens is 0", async () => {
    setupAnthropicMock({
      content: [{ type: "text", text: "not cached" }],
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0 },
      stop_reason: "end_turn",
    });
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    // cacheHit=false because 0 tokens cached (no meaningful cache hit)
    expect(result.cacheHit).toBe(false);
  });

  it("reports cachedInputTokens=undefined when cache_read_input_tokens is absent", async () => {
    setupAnthropicMock({
      content: [{ type: "text", text: "not cached" }],
      usage: { input_tokens: 5, output_tokens: 2 },
      stop_reason: "end_turn",
    });
    const result = await getProviderAdapter("anthropic").invoke(baseRequest);
    expect(result.usage.cachedInputTokens).toBeUndefined();
  });

  it("wraps API errors (Error instance) with a descriptive message", async () => {
    MockAnthropic.mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockRejectedValueOnce(new Error("529 overloaded")) },
    }) as unknown as Anthropic);
    await expect(getProviderAdapter("anthropic").invoke(baseRequest)).rejects.toThrow(
      "Anthropic adapter API error: 529 overloaded",
    );
  });

  it("wraps non-Error API failures with a descriptive message", async () => {
    MockAnthropic.mockImplementationOnce(() => ({
      messages: { create: jest.fn().mockRejectedValueOnce("string error") },
    }) as unknown as Anthropic);
    await expect(getProviderAdapter("anthropic").invoke(baseRequest)).rejects.toThrow(
      "Anthropic adapter API error: string error",
    );
  });
});

// ---------------------------------------------------------------------------
// OpenAIAdapter.invoke() — wire-format coverage
// ---------------------------------------------------------------------------

describe("OpenAIAdapter.invoke()", () => {
  const baseRequest = {
    provider: "openai" as const,
    model: "gpt-4o-mini",
    apiKey: "sk-test",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  it("returns text content and usage from a successful response", async () => {
    setupOpenAIMock([{ message: { content: "Hello back" }, finish_reason: "stop" }]);
    const result = await getProviderAdapter("openai").invoke(baseRequest);
    expect(result.content).toBe("Hello back");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it("maps finish_reason=stop to finishReason=stop", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "stop" }]);
    expect((await getProviderAdapter("openai").invoke(baseRequest)).finishReason).toBe("stop");
  });

  it("maps finish_reason=length to finishReason=length", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "length" }]);
    expect((await getProviderAdapter("openai").invoke(baseRequest)).finishReason).toBe("length");
  });

  it("maps finish_reason=tool_calls to finishReason=tool_calls", async () => {
    setupOpenAIMock([{ message: { content: null }, finish_reason: "tool_calls" }]);
    expect((await getProviderAdapter("openai").invoke(baseRequest)).finishReason).toBe("tool_calls");
  });

  it("maps finish_reason=function_call to finishReason=tool_calls", async () => {
    setupOpenAIMock([{ message: { content: null }, finish_reason: "function_call" }]);
    expect((await getProviderAdapter("openai").invoke(baseRequest)).finishReason).toBe("tool_calls");
  });

  it("maps finish_reason=content_filter to finishReason=content_filter", async () => {
    setupOpenAIMock([{ message: { content: "" }, finish_reason: "content_filter" }]);
    expect((await getProviderAdapter("openai").invoke(baseRequest)).finishReason).toBe("content_filter");
  });

  it("maps null finish_reason to finishReason=unknown", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: null }]);
    expect((await getProviderAdapter("openai").invoke(baseRequest)).finishReason).toBe("unknown");
  });

  it("prepends a system role message when NormalizedRequest.system is set", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "stop" }]);
    await getProviderAdapter("openai").invoke({ ...baseRequest, system: "You are helpful." });
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
  });

  it("converts system-role messages in the messages array", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "stop" }]);
    await getProviderAdapter("openai").invoke({
      ...baseRequest,
      messages: [
        { role: "system", content: "System instruction." },
        { role: "user", content: "Hello" },
      ],
    });
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
    expect(body.messages).toEqual(
      expect.arrayContaining([{ role: "system", content: "System instruction." }]),
    );
  });

  it("converts tool-role messages with toolResults into tool role messages", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "stop" }]);
    await getProviderAdapter("openai").invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Use tool" },
        { role: "tool", toolResults: [{ toolCallId: "call_001", content: "Result" }] },
        { role: "user", content: "Thanks" },
      ],
    });
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
    const toolMsg = body.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg).toMatchObject({ role: "tool", tool_call_id: "call_001", content: "Result" });
  });

  it("converts assistant-role messages with toolCalls into the OpenAI tool_calls format", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "stop" }]);
    await getProviderAdapter("openai").invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Go" },
        { role: "assistant", content: "Calling.", toolCalls: [{ id: "tc_01", name: "fn", arguments: { x: 1 } }] },
        { role: "tool", toolResults: [{ toolCallId: "tc_01", content: "done" }] },
        { role: "user", content: "ok" },
      ],
    });
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
    const assistantMsg = body.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistantMsg.tool_calls).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "tc_01", type: "function" })]),
    );
  });

  it("omits temperature from the request body when not set", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "stop" }]);
    await getProviderAdapter("openai").invoke(baseRequest);
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
    expect(body).not.toHaveProperty("temperature");
  });

  it("includes temperature when set", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "stop" }]);
    await getProviderAdapter("openai").invoke({ ...baseRequest, temperature: 0.7 });
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
    expect(body.temperature).toBe(0.7);
  });

  it("sends tools in the OpenAI function format", async () => {
    setupOpenAIMock([{ message: { content: "ok" }, finish_reason: "stop" }]);
    await getProviderAdapter("openai").invoke({
      ...baseRequest,
      tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
    });
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
    expect(body.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "search" }) }),
      ]),
    );
  });

  it("sends json_schema response_format when responseSchema is set", async () => {
    setupOpenAIMock([{ message: { content: '{"x":1}' }, finish_reason: "stop" }]);
    await getProviderAdapter("openai").invoke({
      ...baseRequest,
      responseSchema: { name: "my_schema", schema: { type: "object" } },
    });
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit)?.body as string);
    expect(body.response_format).toMatchObject({ type: "json_schema" });
  });

  it("parses tool_calls from the response and returns them as NormalizedToolCall[]", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: "chatcmpl-001",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "tc_01", type: "function", function: { name: "fn", arguments: '{"a":1}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      }),
    });
    const result = await getProviderAdapter("openai").invoke(baseRequest);
    expect(result.toolCalls).toEqual([{ id: "tc_01", name: "fn", arguments: { a: 1 } }]);
  });

  it("falls back to empty arguments when tool_call arguments JSON is malformed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: "chatcmpl-002",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "tc_bad", type: "function", function: { name: "fn", arguments: "{bad json" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    });
    const result = await getProviderAdapter("openai").invoke(baseRequest);
    expect(result.toolCalls[0]?.arguments).toEqual({});
  });

  it("reports cacheHit=true when prompt_tokens_details.cached_tokens > 0", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: "chatcmpl-003",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 50, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40 } },
      }),
    });
    const result = await getProviderAdapter("openai").invoke(baseRequest);
    expect(result.cacheHit).toBe(true);
    expect(result.usage.cachedInputTokens).toBe(40);
  });

  it("wraps non-OK HTTP responses with a descriptive error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue("Unauthorized"),
    });
    await expect(getProviderAdapter("openai").invoke(baseRequest)).rejects.toThrow(
      "OpenAI adapter API error:",
    );
  });

  it("wraps network errors (fetch throws) with a descriptive error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(getProviderAdapter("openai").invoke(baseRequest)).rejects.toThrow(
      "OpenAI adapter API error: ECONNREFUSED",
    );
  });
});
