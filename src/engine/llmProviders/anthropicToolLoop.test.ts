/**
 * DASH-22: Anthropic agentic tool-loop unit tests.
 *
 * Mocks the SDK's messages.create so we can script multi-turn
 * conversations: first response emits tool_use → handler runs →
 * we feed back tool_result → second response is end_turn text.
 *
 * Covers: happy path, multiple tools in one turn, unknown tool,
 * handler exception, max-iteration cap.
 */

import type Anthropic from "@anthropic-ai/sdk";

const mockedCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockedCreate,
      },
    })),
  };
});

import { createAnthropicProvider } from "./anthropic";
import type { AgentTool } from "./types";

beforeEach(() => {
  mockedCreate.mockReset();
});

// Find the user-role turn whose first content block is a tool_result.
// The provider also appends each assistant turn into the same
// messages array, so the tool_result isn't always the last entry by
// test-read time — search instead of indexing.
function findUserToolResultTurn(messages: Array<{ role: string; content: unknown }>): {
  role: string;
  content: Array<Record<string, unknown>>;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user" || !Array.isArray(m.content)) continue;
    const first = m.content[0] as Record<string, unknown> | undefined;
    if (first?.type === "tool_result") {
      return m as { role: string; content: Array<Record<string, unknown>> };
    }
  }
  return null;
}

function endTurnResponse(
  text: string,
  inputTokens = 10,
  outputTokens = 20,
): Anthropic.Messages.Message {
  return {
    id: "msg_end",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text", text, citations: null } as Anthropic.Messages.TextBlock],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: "standard",
    },
  } as unknown as Anthropic.Messages.Message;
}

function toolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
  toolUseId: string,
  inputTokens = 5,
  outputTokens = 5,
): Anthropic.Messages.Message {
  return {
    id: "msg_tooluse",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use",
        id: toolUseId,
        name: toolName,
        input,
      } as Anthropic.Messages.ToolUseBlock,
    ],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: "standard",
    },
  } as unknown as Anthropic.Messages.Message;
}

describe("Anthropic agentic tool loop (DASH-22)", () => {
  const baseConfig = {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-6",
    apiKey: "sk-test",
  };

  it("returns text immediately when the model doesn't call any tool", async () => {
    mockedCreate.mockResolvedValueOnce(endTurnResponse("Already know the answer."));
    const tool: AgentTool = {
      name: "noop",
      description: "noop",
      inputSchema: {},
      handler: jest.fn(),
    };
    const provider = createAnthropicProvider({ ...baseConfig, tools: [tool] });
    const response = await provider("hi");
    expect(response.text).toBe("Already know the answer.");
    expect(tool.handler).not.toHaveBeenCalled();
  });

  it("invokes the matching tool handler and feeds the result back as a follow-up turn", async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true, id: "ep_1" });
    const tool: AgentTool = {
      name: "save_memory",
      description: "Save a note",
      inputSchema: { type: "object", properties: { title: { type: "string" } } },
      handler,
    };
    mockedCreate
      .mockResolvedValueOnce(
        toolUseResponse(
          "save_memory",
          { title: "Customer prefers async", content: "Notes…" },
          "toolu_1",
        ),
      )
      .mockResolvedValueOnce(endTurnResponse("Noted and saved."));

    const provider = createAnthropicProvider({ ...baseConfig, tools: [tool] });
    const response = await provider("Remember this");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      title: "Customer prefers async",
      content: "Notes…",
    });
    expect(response.text).toBe("Noted and saved.");
    // Cumulative usage across both turns.
    expect(response.usage?.promptTokens).toBe(15);
    expect(response.usage?.completionTokens).toBe(25);
  });

  it("returns an is_error tool_result when the model calls an unknown tool", async () => {
    mockedCreate
      .mockResolvedValueOnce(
        toolUseResponse("ghost_tool", {}, "toolu_2"),
      )
      .mockResolvedValueOnce(endTurnResponse("Sorry, that tool doesn't exist."));

    const tool: AgentTool = {
      name: "real_tool",
      description: "the only real tool",
      inputSchema: {},
      handler: jest.fn(),
    };
    const provider = createAnthropicProvider({ ...baseConfig, tools: [tool] });
    const response = await provider("ask");

    expect(response.text).toBe("Sorry, that tool doesn't exist.");
    // The follow-up call's messages must include a tool_result with
    // is_error: true so the model can recover. NOTE: because the
    // provider also appends the second turn's assistant content
    // before returning, by test-read time the messages array ends
    // with the assistant turn — the tool_result lives at index -2.
    const secondCall = mockedCreate.mock.calls[1]![0];
    const toolResultTurn = findUserToolResultTurn(secondCall.messages);
    expect(toolResultTurn).not.toBeNull();
    expect(toolResultTurn!.content[0]).toMatchObject({
      type: "tool_result",
      is_error: true,
    });
  });

  it("surfaces handler exceptions as is_error tool_results (loop continues)", async () => {
    const handler = jest.fn().mockRejectedValue(new Error("DB down"));
    const tool: AgentTool = {
      name: "save_memory",
      description: "Save",
      inputSchema: {},
      handler,
    };
    mockedCreate
      .mockResolvedValueOnce(toolUseResponse("save_memory", { x: 1 }, "toolu_3"))
      .mockResolvedValueOnce(endTurnResponse("Couldn't save; flagged it."));

    const provider = createAnthropicProvider({ ...baseConfig, tools: [tool] });
    const response = await provider("save");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.text).toBe("Couldn't save; flagged it.");
    const secondCall = mockedCreate.mock.calls[1]![0];
    const toolResultTurn = findUserToolResultTurn(secondCall.messages);
    expect(toolResultTurn).not.toBeNull();
    expect(toolResultTurn!.content[0]).toMatchObject({
      type: "tool_result",
      is_error: true,
      content: expect.stringContaining("DB down"),
    });
  });

  it("caps runaway loops at maxToolIterations and asks for a wrap-up", async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const tool: AgentTool = {
      name: "loop_tool",
      description: "loops",
      inputSchema: {},
      handler,
    };
    // Every messages.create returns tool_use — simulates a runaway.
    mockedCreate
      .mockResolvedValueOnce(toolUseResponse("loop_tool", {}, "toolu_a"))
      .mockResolvedValueOnce(toolUseResponse("loop_tool", {}, "toolu_b"))
      .mockResolvedValueOnce(toolUseResponse("loop_tool", {}, "toolu_c"))
      // Wrap-up turn returns end_turn text.
      .mockResolvedValueOnce(endTurnResponse("Did 3 things, stopping."));

    const provider = createAnthropicProvider({
      ...baseConfig,
      tools: [tool],
      maxToolIterations: 3,
    });
    const response = await provider("go");

    expect(handler).toHaveBeenCalledTimes(3);
    expect(response.text).toContain("Did 3 things, stopping.");
    expect(response.text).toContain("[interrupted: max iterations]");
  });

  it("falls back to the non-streaming non-tool path when tools is empty", async () => {
    mockedCreate.mockResolvedValueOnce(endTurnResponse("plain old text"));
    const provider = createAnthropicProvider({ ...baseConfig, tools: [] });
    const response = await provider("hi");
    expect(response.text).toBe("plain old text");
  });
});
