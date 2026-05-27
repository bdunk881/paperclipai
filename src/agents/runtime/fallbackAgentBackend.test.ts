/**
 * Behavioural tests for FallbackAgentBackend. Stub the provider adapter
 * registry so we never touch a real LLM.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { NormalizedRequest, NormalizedResponse } from "../../llmConfig/adapters/types";

const invokeMock = jest.fn<(req: NormalizedRequest) => Promise<NormalizedResponse>>();

jest.mock("../../llmConfig/adapters", () => ({
  __esModule: true,
  getProviderAdapter: () => ({
    provider: "anthropic",
    invoke: invokeMock,
  }),
}));

import { FallbackAgentBackend } from "./fallbackAgentBackend";
import type { AgentTool } from "../../engine/llmProviders/types";
import type { AgentTraceEvent } from "../../engine/agentTrace/types";
import type {
  AgentRunInput,
  ResolvedModelBinding,
} from "./types";

const binding: ResolvedModelBinding = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  apiKey: "fake-key",
};

const baseInput = (): AgentRunInput => ({
  pool: {} as never,
  workspaceId: "11111111-1111-1111-1111-111111111111",
  userId: "user-1",
  agentId: "22222222-2222-2222-2222-222222222222",
  agentName: "Agent Smith",
  systemPrompt: "You are an agent.",
  userPrompt: "Do the thing.",
});

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("FallbackAgentBackend", () => {
  it("returns assistant text and usage on a clean one-turn run", async () => {
    invokeMock.mockResolvedValueOnce({
      content: "All done.",
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
    });

    const backend = new FallbackAgentBackend();
    const result = await backend.run(baseInput(), binding);

    expect(result.text).toBe("All done.");
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      cachedPromptTokens: undefined,
    });
    expect(result.backend).toBe("fallback");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("runs a tool-loop until the model stops calling tools", async () => {
    const handler = jest
      .fn<AgentTool["handler"]>()
      .mockResolvedValue("note-saved");

    const tools: AgentTool[] = [
      {
        name: "save_memory",
        description: "Save a memory.",
        inputSchema: { type: "object", properties: {}, additionalProperties: true },
        handler,
      },
    ];

    invokeMock
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{ id: "call-1", name: "save_memory", arguments: { title: "x" } }],
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "Saved and done.",
        toolCalls: [],
        usage: { inputTokens: 12, outputTokens: 6 },
        finishReason: "stop",
      });

    const events: AgentTraceEvent[] = [];
    const backend = new FallbackAgentBackend();
    const result = await backend.run(
      { ...baseInput(), tools, onTrace: (e) => events.push(e) },
      binding,
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("Saved and done.");
    expect(result.usage.promptTokens).toBe(22);
    expect(result.usage.completionTokens).toBe(11);
    expect(events.some((e) => e.type === "turn.started")).toBe(true);
    expect(events.some((e) => e.type === "turn.completed")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });

  it("interrupts after maxToolIterations and returns the summary suffix", async () => {
    const handler = jest
      .fn<AgentTool["handler"]>()
      .mockResolvedValue("still going");

    invokeMock.mockResolvedValue({
      content: "",
      toolCalls: [{ id: "loop", name: "noop", arguments: {} }],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "tool_calls",
    });

    const backend = new FallbackAgentBackend();
    const result = await backend.run(
      {
        ...baseInput(),
        tools: [
          {
            name: "noop",
            description: "noop",
            inputSchema: { type: "object", properties: {}, additionalProperties: true },
            handler,
          },
        ],
        maxToolIterations: 2,
      },
      binding,
    );

    expect(result.text).toContain("[interrupted: max iterations]");
  });

  it("emits a turn.error trace event when the adapter throws", async () => {
    invokeMock.mockRejectedValueOnce(new Error("api blew up"));

    const events: AgentTraceEvent[] = [];
    const backend = new FallbackAgentBackend();

    await expect(
      backend.run(
        { ...baseInput(), onTrace: (e) => events.push(e) },
        binding,
      ),
    ).rejects.toThrow("api blew up");

    expect(events.some((e) => e.type === "turn.error")).toBe(true);
  });
});
