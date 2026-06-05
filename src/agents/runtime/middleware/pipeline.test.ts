/**
 * Tests for the agent-runtime middleware pipeline (HEL-621): onion
 * composition, tool-call short-circuit, model-call wrap/retry, per-run state
 * sharing, and the legacy `AgentHooks` adapter.
 */
import { describe, expect, it, jest } from "@jest/globals";

import { MiddlewarePipeline, buildPipeline, hooksToMiddleware } from "./pipeline";
import type { AgentMiddleware, AgentRunContext, ToolCall } from "./types";
import type { NormalizedResponse } from "../../../llmConfig/adapters/types";
import type { AgentHooks } from "../types";

function makeCtx(): AgentRunContext {
  return {
    run: {} as AgentRunContext["run"],
    binding: { provider: "anthropic", model: "m", apiKey: "k" },
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    state: new Map(),
    backend: "fallback",
  };
}

const call: ToolCall = { id: "c1", name: "do_thing", arguments: { a: 1 } };

function modelResponse(content: string): NormalizedResponse {
  return {
    content,
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1 },
    finishReason: "stop",
  };
}

describe("MiddlewarePipeline", () => {
  it("is a transparent pass-through when empty", async () => {
    const pipe = new MiddlewarePipeline([]);
    const ctx = makeCtx();
    expect(pipe.isEmpty).toBe(true);
    const out = await pipe.toolCall(ctx, call, async () => ({ content: "ok" }));
    expect(out).toEqual({ content: "ok" });
    const resp = await pipe.modelCall(ctx, async () => modelResponse("hello"));
    expect(resp.content).toBe("hello");
  });

  it("composes tool hooks as an onion (before outer→inner, after inner→outer)", async () => {
    const order: string[] = [];
    const mk = (name: string): AgentMiddleware => ({
      name,
      async beforeToolCall(_ctx, _call, next) {
        order.push(`${name}:before`);
        const r = await next();
        order.push(`${name}:after`);
        return r;
      },
      afterToolCall(_ctx, _call, outcome) {
        order.push(`${name}:transform`);
        return outcome;
      },
    });
    const pipe = new MiddlewarePipeline([mk("A"), mk("B")]);
    await pipe.toolCall(makeCtx(), call, async () => {
      order.push("core");
      return { content: "ok" };
    });
    expect(order).toEqual([
      "A:before",
      "B:before",
      "core",
      "B:after",
      "A:after",
      "B:transform",
      "A:transform",
    ]);
  });

  it("lets a beforeToolCall middleware short-circuit before core or inner middleware", async () => {
    const inner = jest.fn();
    const veto: AgentMiddleware = {
      name: "veto",
      async beforeToolCall() {
        return { content: "blocked", isError: true };
      },
    };
    const innerMw: AgentMiddleware = {
      name: "inner",
      async beforeToolCall(_ctx, _call, next) {
        inner();
        return next();
      },
    };
    let coreRan = false;
    const pipe = new MiddlewarePipeline([veto, innerMw]);
    const out = await pipe.toolCall(makeCtx(), call, async () => {
      coreRan = true;
      return { content: "should not happen" };
    });
    expect(out).toEqual({ content: "blocked", isError: true });
    expect(coreRan).toBe(false);
    expect(inner).not.toHaveBeenCalled();
  });

  it("lets a beforeModelCall middleware retry by re-invoking next", async () => {
    let calls = 0;
    const retry: AgentMiddleware = {
      name: "retry",
      async beforeModelCall(_ctx, next) {
        try {
          return await next();
        } catch {
          return next();
        }
      },
    };
    const pipe = new MiddlewarePipeline([retry]);
    const resp = await pipe.modelCall(makeCtx(), async () => {
      calls += 1;
      if (calls === 1) throw new Error("529 overloaded");
      return modelResponse("recovered");
    });
    expect(calls).toBe(2);
    expect(resp.content).toBe("recovered");
  });

  it("shares ctx.state across hooks within a run", async () => {
    const key = Symbol("count");
    const counter: AgentMiddleware = {
      name: "counter",
      async beforeModelCall(ctx, next) {
        ctx.state.set(key, ((ctx.state.get(key) as number) ?? 0) + 1);
        return next();
      },
    };
    const pipe = new MiddlewarePipeline([counter]);
    const ctx = makeCtx();
    await pipe.modelCall(ctx, async () => modelResponse("a"));
    await pipe.modelCall(ctx, async () => modelResponse("b"));
    expect(ctx.state.get(key)).toBe(2);
  });

  it("lets a beforeModelCall middleware rewrite ctx.messages before the call", async () => {
    const compactor: AgentMiddleware = {
      name: "compactor",
      async beforeModelCall(ctx, next) {
        ctx.messages = [{ role: "user", content: "compacted" }];
        return next();
      },
    };
    const pipe = new MiddlewarePipeline([compactor]);
    const ctx = makeCtx();
    ctx.messages = [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ];
    await pipe.modelCall(ctx, async () => modelResponse("ok"));
    expect(ctx.messages).toEqual([{ role: "user", content: "compacted" }]);
  });
});

describe("hooksToMiddleware (legacy AgentHooks adapter)", () => {
  it("returns null when there are no hooks", () => {
    expect(hooksToMiddleware(undefined)).toBeNull();
    expect(hooksToMiddleware({})).toBeNull();
  });

  it("surfaces a preToolUse veto as an isError outcome carrying the reason", async () => {
    const hooks: AgentHooks = {
      preToolUse: async () => ({ continue: false, reason: "budget exhausted" }),
    };
    const pipe = buildPipeline(hooks);
    let coreRan = false;
    const out = await pipe.toolCall(makeCtx(), call, async () => {
      coreRan = true;
      return { content: "handler ran" };
    });
    expect(out).toEqual({ content: "budget exhausted", isError: true });
    expect(coreRan).toBe(false);
  });

  it("runs the handler and fires postToolUse when preToolUse approves", async () => {
    const post = jest.fn();
    const hooks: AgentHooks = {
      preToolUse: async () => ({ continue: true }),
      postToolUse: async (info) => {
        post(info);
      },
    };
    const pipe = buildPipeline(hooks);
    const out = await pipe.toolCall(makeCtx(), call, async () => ({ content: "done" }));
    expect(out.content).toBe("done");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("swallows a throwing preToolUse and approves the call", async () => {
    const hooks: AgentHooks = {
      preToolUse: async () => {
        throw new Error("hook blew up");
      },
    };
    const pipe = buildPipeline(hooks);
    const out = await pipe.toolCall(makeCtx(), call, async () => ({ content: "approved" }));
    expect(out.content).toBe("approved");
  });
});
