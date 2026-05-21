import { emitSyntheticTurnFromResponse, emitTurnCompleted } from "./syntheticTrace";
import type { AgentTraceEvent } from "./types";

function collectEvents(
  run: (cb: (e: AgentTraceEvent) => void) => void,
): AgentTraceEvent[] {
  const events: AgentTraceEvent[] = [];
  run((e) => events.push(e));
  return events;
}

describe("emitSyntheticTurnFromResponse", () => {
  it("does nothing when onTrace is undefined", () => {
    expect(() =>
      emitSyntheticTurnFromResponse({ onTrace: undefined, iteration: 1, text: "hi" }),
    ).not.toThrow();
  });

  it("emits iteration.started + assistant.delta for text-only turn", () => {
    const events = collectEvents((cb) =>
      emitSyntheticTurnFromResponse({ onTrace: cb, iteration: 2, text: "response text" }),
    );
    expect(events[0]).toMatchObject({ type: "iteration.started", iteration: 2 });
    expect(events[1]).toMatchObject({
      type: "assistant.delta",
      delta: "response text",
      accumulated: "response text",
    });
    expect(events).toHaveLength(2);
  });

  it("emits tool_call.started + tool_call.completed for tool calls", () => {
    const events = collectEvents((cb) =>
      emitSyntheticTurnFromResponse({
        onTrace: cb,
        iteration: 1,
        text: "",
        toolCalls: [{ id: "c1", name: "search", arguments: { q: "hello" } }],
      }),
    );
    expect(events.some((e) => e.type === "tool_call.started")).toBe(true);
    expect(events.some((e) => e.type === "tool_call.completed")).toBe(true);

    const started = events.find((e) => e.type === "tool_call.started") as Extract<
      AgentTraceEvent,
      { type: "tool_call.started" }
    >;
    expect(started.callId).toBe("c1");
    expect(started.name).toBe("search");
  });

  it("redacts secret-shaped keys in tool call arguments", () => {
    const events = collectEvents((cb) =>
      emitSyntheticTurnFromResponse({
        onTrace: cb,
        iteration: 1,
        text: "",
        toolCalls: [{ id: "c2", name: "fetch", arguments: { api_key: "sk-secret", url: "https://example.com" } }],
      }),
    );
    const completed = events.find((e) => e.type === "tool_call.completed") as Extract<
      AgentTraceEvent,
      { type: "tool_call.completed" }
    >;
    expect(completed.arguments.api_key).toBe("[redacted]");
    expect(completed.arguments.url).toBe("https://example.com");
  });

  it("emits tool_result events", () => {
    const events = collectEvents((cb) =>
      emitSyntheticTurnFromResponse({
        onTrace: cb,
        iteration: 1,
        text: "",
        toolResults: [{ callId: "c1", name: "search", output: "result text" }],
      }),
    );
    const toolResult = events.find((e) => e.type === "tool_result") as Extract<
      AgentTraceEvent,
      { type: "tool_result" }
    >;
    expect(toolResult).toBeDefined();
    expect(toolResult.callId).toBe("c1");
    expect(toolResult.outputPreview).toContain("result text");
  });

  it("skips assistant.delta when text is empty", () => {
    const events = collectEvents((cb) =>
      emitSyntheticTurnFromResponse({ onTrace: cb, iteration: 1, text: "" }),
    );
    expect(events.some((e) => e.type === "assistant.delta")).toBe(false);
  });
});

describe("emitTurnCompleted", () => {
  it("does nothing when onTrace is undefined", () => {
    expect(() =>
      emitTurnCompleted(undefined, {
        text: "done",
        usage: { promptTokens: 10, completionTokens: 5 },
        provider: "anthropic",
        model: "claude-sonnet",
      }),
    ).not.toThrow();
  });

  it("emits turn.completed with text and usage", () => {
    const events = collectEvents((cb) =>
      emitTurnCompleted(cb, {
        text: "final answer",
        usage: { promptTokens: 100, completionTokens: 50 },
        provider: "anthropic",
        model: "claude-sonnet",
      }),
    );
    expect(events).toHaveLength(1);
    const ev = events[0] as Extract<AgentTraceEvent, { type: "turn.completed" }>;
    expect(ev.type).toBe("turn.completed");
    expect(ev.text).toBe("final answer");
    expect(ev.usage.promptTokens).toBe(100);
  });

  it("defaults usage to zero when response.usage is undefined", () => {
    const events = collectEvents((cb) =>
      emitTurnCompleted(cb, {
        text: "result",
        usage: undefined,
        provider: "anthropic",
        model: "claude-sonnet",
      }),
    );
    const ev = events[0] as Extract<AgentTraceEvent, { type: "turn.completed" }>;
    expect(ev.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});
