import { describe, expect, it, jest } from "@jest/globals";

import { executeToolCalls } from "./executeToolCalls";
import type { AgentTool } from "../../engine/llmProviders/types";
import type { AgentTraceEvent } from "../../engine/agentTrace/types";

function makeTool(
  name: string,
  handler: AgentTool["handler"],
): [string, AgentTool] {
  return [
    name,
    {
      name,
      description: `desc-${name}`,
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
      handler,
    },
  ];
}

describe("executeToolCalls", () => {
  it("runs the matching handler and serializes the result", async () => {
    const handler = jest
      .fn<AgentTool["handler"]>()
      .mockResolvedValue({ ok: true, id: "abc" });
    const tools = new Map([makeTool("save_memory", handler)]);

    const results = await executeToolCalls({
      toolCalls: [
        { id: "call-1", name: "save_memory", arguments: { title: "x" } },
      ],
      toolsByName: tools,
    });

    expect(results).toEqual([
      { toolCallId: "call-1", content: '{"ok":true,"id":"abc"}' },
    ]);
    expect(handler).toHaveBeenCalledWith({ title: "x" });
  });

  it("returns isError tool_result when tool is not registered", async () => {
    const events: AgentTraceEvent[] = [];
    const results = await executeToolCalls({
      toolCalls: [{ id: "call-2", name: "missing_tool", arguments: {} }],
      toolsByName: new Map(),
      onTrace: (event) => events.push(event),
    });

    expect(results[0]?.isError).toBe(true);
    expect(results[0]?.content).toContain('Tool "missing_tool" is not registered');
    expect(events.some((e) => e.type === "tool_call.failed")).toBe(true);
  });

  it("converts handler throws into isError tool_result without re-throwing", async () => {
    const tools = new Map([
      makeTool("explodes", async () => {
        throw new Error("boom");
      }),
    ]);

    const events: AgentTraceEvent[] = [];
    const results = await executeToolCalls({
      toolCalls: [{ id: "call-3", name: "explodes", arguments: {} }],
      toolsByName: tools,
      onTrace: (event) => events.push(event),
    });

    expect(results[0]?.isError).toBe(true);
    expect(results[0]?.content).toContain('Tool "explodes" failed: boom');
    expect(events.some((e) => e.type === "tool_call.failed")).toBe(true);
  });

  it("runs multiple tool calls in parallel", async () => {
    const handlerA = jest
      .fn<AgentTool["handler"]>()
      .mockResolvedValue("result-A");
    const handlerB = jest
      .fn<AgentTool["handler"]>()
      .mockResolvedValue("result-B");

    const tools = new Map([
      makeTool("a", handlerA),
      makeTool("b", handlerB),
    ]);

    const results = await executeToolCalls({
      toolCalls: [
        { id: "call-A", name: "a", arguments: {} },
        { id: "call-B", name: "b", arguments: {} },
      ],
      toolsByName: tools,
    });

    expect(results).toEqual([
      { toolCallId: "call-A", content: "result-A" },
      { toolCallId: "call-B", content: "result-B" },
    ]);
  });
});
