import type OpenAI from "openai";
import type { AgentTraceEvent } from "../agentTrace/types";
import {
  createOpenAIStreamAccumulators,
  mapOpenAIStreamChunk,
  resetOpenAIToolCallAccum,
} from "./openaiStream";

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;

function chunk(
  delta: Record<string, unknown> | null,
  finish_reason: Chunk["choices"][number]["finish_reason"] | null = null,
): Chunk {
  return {
    id: "c",
    created: 0,
    model: "gpt",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: (delta ?? {}) as Chunk["choices"][number]["delta"],
        finish_reason,
      },
    ],
  } as unknown as Chunk;
}

function collect(): {
  events: AgentTraceEvent[];
  cb: (e: AgentTraceEvent) => void;
} {
  const events: AgentTraceEvent[] = [];
  return { events, cb: (e) => events.push(e) };
}

describe("createOpenAIStreamAccumulators", () => {
  it("starts empty", () => {
    const acc = createOpenAIStreamAccumulators();
    expect(acc.assistantText).toBe("");
    expect(acc.reasoningText).toBe("");
    expect(acc.toolCalls.size).toBe(0);
  });
});

describe("mapOpenAIStreamChunk", () => {
  it("no-ops when onTrace is undefined", () => {
    const acc = createOpenAIStreamAccumulators();
    expect(() =>
      mapOpenAIStreamChunk(chunk({ content: "hi" }), undefined, acc),
    ).not.toThrow();
    // Accumulators are untouched because the function returns early.
    expect(acc.assistantText).toBe("");
  });

  it("no-ops on malformed chunk with no choices", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    const bad = { id: "x", created: 0, model: "m", object: "chat.completion.chunk", choices: [] } as unknown as Chunk;
    mapOpenAIStreamChunk(bad, cb, acc);
    expect(events).toHaveLength(0);
  });

  it("no-ops on chunk missing delta", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    const bad = {
      id: "x",
      created: 0,
      model: "m",
      object: "chat.completion.chunk",
      choices: [{ index: 0, finish_reason: null }],
    } as unknown as Chunk;
    mapOpenAIStreamChunk(bad, cb, acc);
    expect(events).toHaveLength(0);
  });

  it("emits nothing for an empty delta", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(chunk({}), cb, acc);
    expect(events).toHaveLength(0);
  });

  it("accumulates text deltas and emits assistant.delta", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(chunk({ content: "Hel" }), cb, acc);
    mapOpenAIStreamChunk(chunk({ content: "lo" }), cb, acc);
    expect(acc.assistantText).toBe("Hello");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "assistant.delta",
      delta: "Hel",
      accumulated: "Hel",
    });
    expect(events[1]).toMatchObject({
      type: "assistant.delta",
      delta: "lo",
      accumulated: "Hello",
    });
  });

  it("emits reasoning.delta from `reasoning`", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(chunk({ reasoning: "think" }), cb, acc);
    expect(acc.reasoningText).toBe("think");
    expect(events[0]).toMatchObject({
      type: "reasoning.delta",
      delta: "think",
      accumulated: "think",
      visibility: "full",
    });
  });

  it("emits reasoning.delta from `reasoning_content` fallback", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(chunk({ reasoning_content: "alt" }), cb, acc);
    mapOpenAIStreamChunk(chunk({ reasoning_content: "-more" }), cb, acc);
    expect(acc.reasoningText).toBe("alt-more");
    expect(events.filter((e) => e.type === "reasoning.delta")).toHaveLength(2);
  });

  it("assembles a tool call: id-first, name next, then arguments deltas", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();

    // First chunk creates the entry (no name yet → entry.name == "")
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [{ index: 0, id: "call_1", function: {} }],
      }),
      cb,
      acc,
    );
    // Second chunk supplies the name; only NOW does tool_call.started fire
    // because the previously-stored entry had empty name.
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [{ index: 0, function: { name: "search" } }],
      }),
      cb,
      acc,
    );
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [
          { index: 0, function: { arguments: '{"q":"' } },
        ],
      }),
      cb,
      acc,
    );
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [
          { index: 0, function: { arguments: 'hi"}' } },
        ],
      }),
      cb,
      acc,
    );

    const started = events.find((e) => e.type === "tool_call.started");
    expect(started).toMatchObject({
      type: "tool_call.started",
      callId: "call_1",
      name: "search",
    });
    const argDeltas = events.filter((e) => e.type === "tool_call.args.delta");
    expect(argDeltas).toHaveLength(2);
    expect(argDeltas[1]).toMatchObject({
      callId: "call_1",
      delta: 'hi"}',
      accumulatedJson: '{"q":"hi"}',
    });

    // Finish event with tool_calls reason → completed.
    mapOpenAIStreamChunk(chunk({}, "tool_calls"), cb, acc);
    const completed = events.find((e) => e.type === "tool_call.completed") as Extract<
      AgentTraceEvent,
      { type: "tool_call.completed" }
    >;
    expect(completed.callId).toBe("call_1");
    expect(completed.name).toBe("search");
    expect(completed.arguments).toEqual({ q: "hi" });
  });

  it("falls back to `idx-N` callId when tool call has no id, and emits tool_call.started once", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    // Create entry with no name → falls back to idx-0.
    mapOpenAIStreamChunk(
      chunk({ tool_calls: [{ index: 0, function: {} }] }),
      cb,
      acc,
    );
    // Name arrives next: tool_call.started fires with idx-0 callId.
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [{ index: 0, function: { name: "foo" } }],
      }),
      cb,
      acc,
    );
    // Subsequent name update goes through the else-branch (entry.name truthy).
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [{ index: 0, function: { name: "foo2" } }],
      }),
      cb,
      acc,
    );

    const starts = events.filter((e) => e.type === "tool_call.started");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ callId: "idx-0", name: "foo" });
    expect(acc.toolCalls.get(0)?.name).toBe("foo2");
  });

  it("handles multiple tool calls in a single stream and emits one completed per call", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();

    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [
          { index: 0, id: "a", function: { name: "alpha", arguments: '{"x":1}' } },
          { index: 1, id: "b", function: { name: "beta", arguments: "" } },
        ],
      }),
      cb,
      acc,
    );
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [{ index: 1, function: { arguments: '{"y":2}' } }],
      }),
      cb,
      acc,
    );
    mapOpenAIStreamChunk(chunk({}, "tool_calls"), cb, acc);

    const completed = events.filter((e) => e.type === "tool_call.completed");
    expect(completed).toHaveLength(2);
    const byId = Object.fromEntries(
      completed.map((e) => {
        const ev = e as Extract<AgentTraceEvent, { type: "tool_call.completed" }>;
        return [ev.callId, ev];
      }),
    );
    expect(byId.a.arguments).toEqual({ x: 1 });
    expect(byId.b.arguments).toEqual({ y: 2 });
  });

  it("uses {_raw} when argumentsJson is unparsable JSON on tool_calls finish", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [
          { index: 0, id: "x", function: { name: "f", arguments: "not json" } },
        ],
      }),
      cb,
      acc,
    );
    mapOpenAIStreamChunk(chunk({}, "tool_calls"), cb, acc);
    const completed = events.find((e) => e.type === "tool_call.completed") as Extract<
      AgentTraceEvent,
      { type: "tool_call.completed" }
    >;
    expect(completed.arguments).toEqual({ _raw: "not json" });
  });

  it("uses {} when argumentsJson is empty on tool_calls finish", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [{ index: 0, id: "x", function: { name: "f" } }],
      }),
      cb,
      acc,
    );
    mapOpenAIStreamChunk(chunk({}, "tool_calls"), cb, acc);
    const completed = events.find((e) => e.type === "tool_call.completed") as Extract<
      AgentTraceEvent,
      { type: "tool_call.completed" }
    >;
    expect(completed.arguments).toEqual({});
  });

  it("redacts secret keys in completed tool args", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "x",
            function: {
              name: "fetch",
              arguments: '{"api_key":"sk-secret","url":"https://a.b"}',
            },
          },
        ],
      }),
      cb,
      acc,
    );
    mapOpenAIStreamChunk(chunk({}, "tool_calls"), cb, acc);
    const completed = events.find((e) => e.type === "tool_call.completed") as Extract<
      AgentTraceEvent,
      { type: "tool_call.completed" }
    >;
    expect(completed.arguments.api_key).toBe("[redacted]");
    expect(completed.arguments.url).toBe("https://a.b");
  });

  it("defaults missing tool_call index to 0", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    // No `index` field → defaults to 0. Entry created with id "noidx".
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [
          { id: "noidx", function: { arguments: '{"a":1}' } } as unknown as Record<string, unknown>,
        ],
      }),
      cb,
      acc,
    );
    expect(acc.toolCalls.has(0)).toBe(true);
    expect(acc.toolCalls.get(0)?.id).toBe("noidx");
    expect(events.some((e) => e.type === "tool_call.args.delta")).toBe(true);
  });

  it("does NOT emit tool_call.completed for non-tool_calls finish_reason", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [
          { index: 0, id: "x", function: { name: "f", arguments: "{}" } },
        ],
      }),
      cb,
      acc,
    );
    mapOpenAIStreamChunk(chunk({ content: "done" }, "stop"), cb, acc);
    expect(events.some((e) => e.type === "tool_call.completed")).toBe(false);
  });

  it("ignores empty tool_calls array", () => {
    const acc = createOpenAIStreamAccumulators();
    const { events, cb } = collect();
    mapOpenAIStreamChunk(chunk({ tool_calls: [] }), cb, acc);
    expect(events).toHaveLength(0);
    expect(acc.toolCalls.size).toBe(0);
  });
});

describe("resetOpenAIToolCallAccum", () => {
  it("clears tool calls but preserves text/reasoning accumulators", () => {
    const acc = createOpenAIStreamAccumulators();
    const { cb } = collect();
    mapOpenAIStreamChunk(chunk({ content: "hi" }), cb, acc);
    mapOpenAIStreamChunk(chunk({ reasoning: "r" }), cb, acc);
    mapOpenAIStreamChunk(
      chunk({
        tool_calls: [
          { index: 0, id: "x", function: { name: "f", arguments: "{}" } },
        ],
      }),
      cb,
      acc,
    );
    expect(acc.toolCalls.size).toBe(1);

    resetOpenAIToolCallAccum(acc);
    expect(acc.toolCalls.size).toBe(0);
    expect(acc.assistantText).toBe("hi");
    expect(acc.reasoningText).toBe("r");
  });
});
