/**
 * promptCachingMiddleware (HEL-628) — turns on prompt caching of the stable
 * prefix (system + tool defs) for the run.
 *
 * The agent adapter path sets no `cache_control` today, so on a multi-iteration
 * tool loop the stable system prompt + tool definitions are re-billed at full
 * price every turn. This `beforeModelCall` middleware flips `ctx.cacheControl`,
 * which the fallback loop forwards to the model request; `anthropicAdapter`
 * then stamps `cache_control: { type: "ephemeral" }` on the system block.
 * Non-Anthropic adapters ignore the flag.
 *
 * Fallback-only via `getMiddlewareSupport` (the SDK backends manage caching
 * themselves). Gated by AUTOFLOW_AGENT_PROMPT_CACHE_ENABLED at the wiring layer.
 */
import { getMiddlewareSupport } from "../capabilities";
import type { AgentMiddleware, ModelCallResult } from "./types";

export function promptCachingMiddleware(): AgentMiddleware {
  return {
    name: "prompt-caching",
    async beforeModelCall(ctx, next): Promise<ModelCallResult> {
      if (getMiddlewareSupport(ctx.backend).modelPhase === "full") {
        ctx.cacheControl = true;
      }
      return next();
    },
  };
}
