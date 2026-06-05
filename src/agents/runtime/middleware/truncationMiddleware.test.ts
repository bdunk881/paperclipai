/**
 * Tests for truncationMiddleware (HEL-623): bounds tool-result content fed to
 * the model, preserves isError, and supports a per-agent cap / opt-out.
 */
import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_TOOL_RESULT_MAX_CHARS,
  truncationMiddleware,
} from "./truncationMiddleware";
import type { AgentRunContext, ToolCall } from "./types";

const ctx = {} as AgentRunContext;
const call: ToolCall = { id: "c1", name: "read_file", arguments: {} };

describe("truncationMiddleware", () => {
  it("passes content within the limit through unchanged", async () => {
    const out = await truncationMiddleware(100).afterToolCall!(ctx, call, {
      content: "short",
    });
    expect(out).toEqual({ content: "short" });
  });

  it("truncates oversized content with a marker and preserves isError", async () => {
    const content = "x".repeat(50);
    const out = await truncationMiddleware(10).afterToolCall!(ctx, call, {
      content,
      isError: true,
    });
    expect(out.content).toBe(`${"x".repeat(10)}\n\n[truncated 40 chars]`);
    expect(out.isError).toBe(true);
  });

  it("falls back to the default cap when no limit is given", async () => {
    const mw = truncationMiddleware();
    expect((await mw.afterToolCall!(ctx, call, { content: "ok" })).content).toBe("ok");
    const big = { content: "y".repeat(DEFAULT_TOOL_RESULT_MAX_CHARS + 5) };
    const out = await mw.afterToolCall!(ctx, call, big);
    expect(out.content.endsWith("[truncated 5 chars]")).toBe(true);
    expect(out.content.length).toBe(
      DEFAULT_TOOL_RESULT_MAX_CHARS + "\n\n[truncated 5 chars]".length,
    );
  });

  it("disables truncation when maxChars <= 0", async () => {
    const content = "z".repeat(100);
    const out = await truncationMiddleware(0).afterToolCall!(ctx, call, { content });
    expect(out.content).toBe(content);
  });
});
