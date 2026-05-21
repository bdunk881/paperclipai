import { resolveTraceCallback, emitTrace } from "./emitCallbacks";
import type { AgentTraceEvent } from "./types";

describe("resolveTraceCallback", () => {
  it("returns undefined when neither onTrace nor onText is provided", () => {
    expect(resolveTraceCallback({})).toBeUndefined();
  });

  it("returns onTrace directly when provided", () => {
    const onTrace = jest.fn();
    expect(resolveTraceCallback({ onTrace })).toBe(onTrace);
  });

  it("prefers onTrace over onText when both are provided", () => {
    const onTrace = jest.fn();
    const onText = jest.fn();
    expect(resolveTraceCallback({ onTrace, onText })).toBe(onTrace);
  });

  it("returns an onText shim when only onText is provided", () => {
    const onText = jest.fn();
    const cb = resolveTraceCallback({ onText });
    expect(cb).toBeDefined();

    // Shim should forward assistant.delta events to onText
    const deltaEvent: AgentTraceEvent = {
      type: "assistant.delta",
      delta: "hello",
      accumulated: "hello",
    };
    cb!(deltaEvent);
    expect(onText).toHaveBeenCalledWith("hello", "hello");
  });

  it("shim ignores non-delta events", () => {
    const onText = jest.fn();
    const cb = resolveTraceCallback({ onText })!;
    cb({ type: "turn.started", at: new Date().toISOString() });
    expect(onText).not.toHaveBeenCalled();
  });

  it("shim swallows consumer errors from onText", () => {
    const onText = jest.fn().mockImplementation(() => {
      throw new Error("consumer error");
    });
    const cb = resolveTraceCallback({ onText })!;
    expect(() =>
      cb({ type: "assistant.delta", delta: "x", accumulated: "x" }),
    ).not.toThrow();
  });
});

describe("emitTrace", () => {
  it("does nothing when onTrace is undefined", () => {
    expect(() =>
      emitTrace(undefined, { type: "turn.started", at: "2026-01-01T00:00:00Z" }),
    ).not.toThrow();
  });

  it("calls onTrace with the event", () => {
    const onTrace = jest.fn();
    const event: AgentTraceEvent = { type: "turn.started", at: "2026-01-01T00:00:00Z" };
    emitTrace(onTrace, event);
    expect(onTrace).toHaveBeenCalledWith(event);
  });

  it("swallows errors thrown by onTrace", () => {
    const onTrace = jest.fn().mockImplementation(() => {
      throw new Error("stream crashed");
    });
    expect(() =>
      emitTrace(onTrace, { type: "turn.started", at: "2026-01-01T00:00:00Z" }),
    ).not.toThrow();
  });
});
