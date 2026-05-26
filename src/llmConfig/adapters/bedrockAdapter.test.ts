/**
 * Tests for BedrockAdapter (HEL-82 follow-up).
 *
 * The AWS SDK is mocked — no real Bedrock requests are made. We verify:
 *   - happy-path Converse text response normalisation
 *   - tool-call emission
 *   - structured output via responseSchema (forced tool path)
 *   - error wrapping
 *   - usage token mapping (incl. cache read tokens)
 *   - credentials / region required from providerOptions
 */

jest.mock("@aws-sdk/client-bedrock-runtime", () => {
  return {
    __esModule: true,
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    ConverseCommand: jest.fn().mockImplementation((input) => ({ __cmd: "Converse", input })),
    ConverseStreamCommand: jest
      .fn()
      .mockImplementation((input) => ({ __cmd: "ConverseStream", input })),
  };
});

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

import { BedrockAdapter } from "./bedrockAdapter";
import type { NormalizedRequest } from "./types";

const MockBedrockRuntimeClient = BedrockRuntimeClient as unknown as jest.Mock;
const MockConverseCommand = ConverseCommand as unknown as jest.Mock;
const MockConverseStreamCommand = ConverseStreamCommand as unknown as jest.Mock;

function bedrockInstance() {
  return MockBedrockRuntimeClient.mock.results[
    MockBedrockRuntimeClient.mock.results.length - 1
  ]?.value as { send: jest.Mock };
}

const baseRequest: NormalizedRequest = {
  provider: "bedrock",
  model: "amazon.nova-pro-v1:0",
  messages: [{ role: "user", content: "Hello" }],
  providerOptions: {
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret/example",
    region: "us-east-1",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BedrockAdapter.invoke()", () => {
  it("returns text content + usage from a successful Converse response", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { role: "assistant", content: [{ text: "Hello back" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invoke(baseRequest);

    expect(result.content).toBe("Hello back");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7, cachedInputTokens: undefined });
    expect(result.finishReason).toBe("stop");
    expect(result.toolCalls).toEqual([]);
  });

  it("constructs the BedrockRuntimeClient with the supplied AWS credentials + region", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { content: [{ text: "ok" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    await adapter.invoke({
      ...baseRequest,
      providerOptions: {
        accessKeyId: "AKIA1",
        secretAccessKey: "shh",
        region: "us-west-2",
        sessionToken: "session-token",
      },
    });

    expect(MockBedrockRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "us-west-2",
        credentials: expect.objectContaining({
          accessKeyId: "AKIA1",
          secretAccessKey: "shh",
          sessionToken: "session-token",
        }),
      }),
    );
  });

  it("sends model + Converse messages with system block", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { content: [{ text: "ok" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    await adapter.invoke({
      ...baseRequest,
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
    });

    const call = MockConverseCommand.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.modelId).toBe("amazon.nova-pro-v1:0");
    expect(call.system).toEqual([{ text: "You are helpful." }]);
    expect(call.messages).toEqual([
      { role: "user", content: [{ text: "Hi" }] },
    ]);
  });

  it("emits toolCalls from a Converse response with a toolUse block", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: {
        message: {
          role: "assistant",
          content: [
            { text: "Let me search." },
            {
              toolUse: { toolUseId: "tu_001", name: "search", input: { q: "cats" } },
            },
          ],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 20, outputTokens: 10 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invoke({
      ...baseRequest,
      tools: [
        {
          name: "search",
          description: "Search the web",
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
      ],
    });

    expect(result.content).toBe("Let me search.");
    expect(result.toolCalls).toEqual([
      { id: "tu_001", name: "search", arguments: { q: "cats" } },
    ]);
    expect(result.finishReason).toBe("tool_calls");

    const call = MockConverseCommand.mock.calls[0]?.[0] as {
      toolConfig: { tools: Array<{ toolSpec: { name: string; inputSchema: { json: unknown } } }> };
    };
    expect(call.toolConfig.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolSpec: expect.objectContaining({ name: "search" }),
        }),
      ]),
    );
  });

  it("uses forced tool-use when responseSchema is set and returns the toolUse args", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: {
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "tu_struct",
                name: "__structured_output__",
                input: { answer: 42 },
              },
            },
          ],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 5, outputTokens: 3 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invoke({
      ...baseRequest,
      responseSchema: {
        name: "my_schema",
        schema: { type: "object", properties: { answer: { type: "number" } } },
      },
    });

    const call = MockConverseCommand.mock.calls[0]?.[0] as {
      toolConfig: {
        tools: Array<{ toolSpec: { name: string } }>;
        toolChoice: unknown;
      };
    };
    expect(call.toolConfig.toolChoice).toEqual({
      tool: { name: "__structured_output__" },
    });
    expect(call.toolConfig.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolSpec: expect.objectContaining({ name: "__structured_output__" }),
        }),
      ]),
    );
    expect(result.toolCalls).toEqual([
      { id: "tu_struct", name: "__structured_output__", arguments: { answer: 42 } },
    ]);
  });

  it("wraps Bedrock client errors with a descriptive message", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockRejectedValueOnce(new Error("AccessDeniedException"));
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    await expect(adapter.invoke(baseRequest)).rejects.toThrow(
      "Bedrock adapter API error: AccessDeniedException",
    );
  });

  it("throws when AWS credentials are missing from providerOptions", async () => {
    const adapter = new BedrockAdapter();
    await expect(
      adapter.invoke({
        ...baseRequest,
        providerOptions: { region: "us-east-1" },
      }),
    ).rejects.toThrow(/accessKeyId and secretAccessKey are required/);
  });

  it("throws when region is missing from providerOptions", async () => {
    const adapter = new BedrockAdapter();
    await expect(
      adapter.invoke({
        ...baseRequest,
        providerOptions: { accessKeyId: "AKIA", secretAccessKey: "secret" },
      }),
    ).rejects.toThrow(/region is required/);
  });

  it("maps stopReason=max_tokens to finishReason=length", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { content: [{ text: "..." }] } },
      stopReason: "max_tokens",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invoke(baseRequest);
    expect(result.finishReason).toBe("length");
  });

  it("maps stopReason=guardrail_intervened to finishReason=content_filter", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { content: [{ text: "" }] } },
      stopReason: "guardrail_intervened",
      usage: { inputTokens: 1, outputTokens: 0 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invoke(baseRequest);
    expect(result.finishReason).toBe("content_filter");
  });

  it("surfaces cachedInputTokens + cacheHit when Converse reports cacheReadInputTokens", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { content: [{ text: "cached" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 50, outputTokens: 5, cacheReadInputTokens: 40 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invoke(baseRequest);
    expect(result.usage.cachedInputTokens).toBe(40);
    expect(result.cacheHit).toBe(true);
  });

  it("reports cacheHit=false when no cache tokens are reported", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { content: [{ text: "uncached" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invoke(baseRequest);
    expect(result.cacheHit).toBe(false);
    expect(result.usage.cachedInputTokens).toBeUndefined();
  });

  it("translates assistant tool_use replies and tool_result follow-ups into Converse blocks", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { content: [{ text: "done" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    await adapter.invoke({
      ...baseRequest,
      messages: [
        { role: "user", content: "Search" },
        {
          role: "assistant",
          content: "Calling search.",
          toolCalls: [{ id: "tu_1", name: "search", arguments: { q: "cats" } }],
        },
        {
          role: "tool",
          toolResults: [{ toolCallId: "tu_1", content: "Found cats", isError: false }],
        },
        { role: "user", content: "Thanks" },
      ],
    });

    const call = MockConverseCommand.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    const assistantMsg = call.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Calling search." }),
        expect.objectContaining({
          toolUse: expect.objectContaining({ toolUseId: "tu_1", name: "search" }),
        }),
      ]),
    );
    const toolResultMsg = call.messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => "toolResult" in b),
    );
    expect(toolResultMsg?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolResult: expect.objectContaining({ toolUseId: "tu_1" }),
        }),
      ]),
    );
  });

  it("returns empty arguments when toolUse.input is not an object", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: {
        message: {
          content: [{ toolUse: { toolUseId: "tu_x", name: "fn", input: "not-an-object" } }],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invoke(baseRequest);
    expect(result.toolCalls[0]?.arguments).toEqual({});
  });
});

describe("BedrockAdapter.invokeStream()", () => {
  it("emits assistant.delta + turn.completed trace events while assembling text", async () => {
    const adapter = new BedrockAdapter();
    async function* events() {
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Hello" } } };
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: " world" } } };
      yield { messageStop: { stopReason: "end_turn" } };
      yield { metadata: { usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } } };
    }
    const send = jest.fn().mockResolvedValueOnce({ stream: events() });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const traced: Array<Record<string, unknown>> = [];
    const result = await adapter.invokeStream({
      ...baseRequest,
      onTrace: (e) => {
        traced.push(e);
      },
    });

    expect(MockConverseStreamCommand).toHaveBeenCalled();
    expect(result.content).toBe("Hello world");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({
      inputTokens: 8,
      outputTokens: 2,
      cachedInputTokens: undefined,
    });
    const deltas = traced.filter((e) => e.type === "assistant.delta");
    expect(deltas.length).toBe(2);
    expect(traced.find((e) => e.type === "turn.completed")).toBeDefined();
  });

  it("falls back to non-stream invoke() when onTrace is not provided", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockResolvedValueOnce({
      output: { message: { content: [{ text: "plain" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const result = await adapter.invokeStream(baseRequest);
    expect(result.content).toBe("plain");
    expect(MockConverseCommand).toHaveBeenCalled();
    expect(MockConverseStreamCommand).not.toHaveBeenCalled();
  });

  it("assembles streamed tool-use deltas and emits tool_call.completed", async () => {
    const adapter = new BedrockAdapter();
    async function* events() {
      yield {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: "tu_42", name: "lookup" } },
        },
      };
      yield {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"q":"' } },
        },
      };
      yield {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: 'cats"}' } },
        },
      };
      yield { messageStop: { stopReason: "tool_use" } };
      yield { metadata: { usage: { inputTokens: 6, outputTokens: 4 } } };
    }
    const send = jest.fn().mockResolvedValueOnce({ stream: events() });
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    const traced: Array<Record<string, unknown>> = [];
    const result = await adapter.invokeStream({
      ...baseRequest,
      onTrace: (e) => {
        traced.push(e);
      },
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "tu_42", name: "lookup", arguments: { q: "cats" } },
    ]);
    const completedEvent = traced.find((e) => e.type === "tool_call.completed");
    expect(completedEvent).toEqual(
      expect.objectContaining({
        callId: "tu_42",
        name: "lookup",
        arguments: { q: "cats" },
      }),
    );
  });

  it("wraps streaming errors with a descriptive message", async () => {
    const adapter = new BedrockAdapter();
    const send = jest.fn().mockRejectedValueOnce(new Error("ThrottlingException"));
    MockBedrockRuntimeClient.mockImplementationOnce(() => ({ send }));

    await expect(
      adapter.invokeStream({ ...baseRequest, onTrace: () => undefined }),
    ).rejects.toThrow("Bedrock adapter API error: ThrottlingException");
  });
});

describe("BedrockAdapter registry registration", () => {
  it("provider name is 'bedrock'", () => {
    expect(new BedrockAdapter().provider).toBe("bedrock");
  });

  // Just confirm bedrockInstance helper is callable for symmetry with the
  // legacy provider tests — not a behavioural check on its own.
  it("smoke: the BedrockRuntimeClient mock factory yields a `send` jest.fn", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (BedrockRuntimeClient as any)({ region: "us-east-1" });
    expect(typeof bedrockInstance().send).toBe("function");
  });
});
