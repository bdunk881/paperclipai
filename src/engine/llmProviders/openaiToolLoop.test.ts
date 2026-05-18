/**
 * PR 3 — OpenAI streaming + agentic tool-loop unit tests.
 *
 * Same shape as anthropicToolLoop.test.ts but against the OpenAI
 * Chat Completions API: assistant tool_calls go out, role:"tool"
 * messages come back. Mock the SDK's chat.completions.create.
 */

import type OpenAI from "openai";

const mockedCreate = jest.fn();

jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockedCreate,
        },
      },
    })),
  };
});

import { createOpenAIProvider } from "./openai";
import type { AgentTool } from "./types";

beforeEach(() => {
  mockedCreate.mockReset();
});

function endTurnResponse(
  text: string,
  promptTokens = 10,
  completionTokens = 20,
): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "chatcmpl_end",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content: text,
          refusal: null,
        },
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  toolCallId: string,
  promptTokens = 5,
  completionTokens = 5,
): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "chatcmpl_toolcall",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: toolCallId,
              type: "function",
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  } as OpenAI.Chat.Completions.ChatCompletion;
}

const baseConfig = {
  provider: "openai" as const,
  model: "gpt-4o",
  apiKey: "sk-test",
};

describe("OpenAI agentic tool loop (PR 3)", () => {
  it("returns text immediately when the model doesn't call a tool", async () => {
    mockedCreate.mockResolvedValueOnce(endTurnResponse("Hi there."));
    const tool: AgentTool = {
      name: "noop",
      description: "noop",
      inputSchema: {},
      handler: jest.fn(),
    };
    const provider = createOpenAIProvider({ ...baseConfig, tools: [tool] });
    const response = await provider("hello");
    expect(response.text).toBe("Hi there.");
    expect(tool.handler).not.toHaveBeenCalled();
  });

  it("invokes the matching tool and feeds the result back", async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true, id: "ep_1" });
    const tool: AgentTool = {
      name: "save_memory",
      description: "save",
      inputSchema: {},
      handler,
    };
    mockedCreate
      .mockResolvedValueOnce(
        toolCallResponse(
          "save_memory",
          { title: "Customer prefers async" },
          "call_1",
        ),
      )
      .mockResolvedValueOnce(endTurnResponse("Saved."));

    const provider = createOpenAIProvider({ ...baseConfig, tools: [tool] });
    const response = await provider("note this");

    expect(handler).toHaveBeenCalledWith({ title: "Customer prefers async" });
    expect(response.text).toBe("Saved.");
    expect(response.usage?.promptTokens).toBe(15);
    expect(response.usage?.completionTokens).toBe(25);

    // Second call's messages must include the tool result with the
    // matching tool_call_id.
    const secondCallMessages = mockedCreate.mock.calls[1]![0].messages;
    const toolMessage = secondCallMessages.find(
      (m: { role: string }) => m.role === "tool",
    );
    expect(toolMessage).toMatchObject({
      role: "tool",
      tool_call_id: "call_1",
      content: expect.stringContaining("ok"),
    });
  });

  it("surfaces unknown-tool errors as tool messages that the model can recover from", async () => {
    mockedCreate
      .mockResolvedValueOnce(toolCallResponse("ghost", {}, "call_2"))
      .mockResolvedValueOnce(endTurnResponse("Couldn't use that."));

    const tool: AgentTool = {
      name: "real_tool",
      description: "real",
      inputSchema: {},
      handler: jest.fn(),
    };
    const provider = createOpenAIProvider({ ...baseConfig, tools: [tool] });
    const response = await provider("ask");

    expect(response.text).toBe("Couldn't use that.");
    const toolMessage = mockedCreate.mock.calls[1]![0].messages.find(
      (m: { role: string }) => m.role === "tool",
    );
    expect(toolMessage.content).toMatch(/not registered/i);
  });

  it("caps runaway loops at maxToolIterations", async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const tool: AgentTool = {
      name: "loop_tool",
      description: "loops",
      inputSchema: {},
      handler,
    };
    mockedCreate
      .mockResolvedValueOnce(toolCallResponse("loop_tool", {}, "call_a"))
      .mockResolvedValueOnce(toolCallResponse("loop_tool", {}, "call_b"))
      .mockResolvedValueOnce(endTurnResponse("Stopping."));

    const provider = createOpenAIProvider({
      ...baseConfig,
      tools: [tool],
      maxToolIterations: 2,
    });
    const response = await provider("go");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(response.text).toContain("[interrupted: max iterations]");
  });
});

describe("OpenAI streaming (PR 3)", () => {
  it("calls onText with each delta and assembles the final text", async () => {
    // The SDK returns an AsyncIterable when stream: true. Mock that
    // shape with an async generator that yields three chunks + a
    // usage payload on the last one.
    async function* mockStream() {
      yield {
        id: "x",
        object: "chat.completion.chunk",
        created: 0,
        model: "gpt-4o",
        choices: [
          { index: 0, delta: { content: "Hello " }, finish_reason: null },
        ],
      };
      yield {
        id: "x",
        object: "chat.completion.chunk",
        created: 0,
        model: "gpt-4o",
        choices: [
          { index: 0, delta: { content: "world" }, finish_reason: null },
        ],
      };
      yield {
        id: "x",
        object: "chat.completion.chunk",
        created: 0,
        model: "gpt-4o",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      };
    }
    mockedCreate.mockResolvedValueOnce(mockStream());

    const tokens: string[] = [];
    const provider = createOpenAIProvider({
      ...baseConfig,
      onText: (delta) => {
        tokens.push(delta);
      },
    });
    const response = await provider("hi");

    expect(tokens).toEqual(["Hello ", "world"]);
    expect(response.text).toBe("Hello world");
    expect(response.usage).toEqual({ promptTokens: 3, completionTokens: 2 });
  });
});
