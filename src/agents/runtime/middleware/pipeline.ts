/**
 * MiddlewarePipeline (HEL-621) — composes `AgentMiddleware[]` as an onion and
 * exposes the two seams the backends drive: `modelCall` + `toolCall`.
 *
 * Composition: `middlewares[0]` is outermost. `before*` wrappers run
 * outer→inner; `after*` transforms run inner→outer (reverse). An EMPTY
 * pipeline is a transparent pass-through — `modelCall`/`toolCall` just invoke
 * their `core` — so a run with no middleware behaves exactly as the
 * pre-pipeline loop did. This is what keeps the PR1 reroute behavior-preserving.
 */
import type {
  AgentMiddleware,
  AgentRunContext,
  ModelCallResult,
  ToolCall,
  ToolOutcome,
} from "./types";
import type { AgentHooks } from "../types";

export class MiddlewarePipeline {
  constructor(private readonly middlewares: AgentMiddleware[]) {}

  get isEmpty(): boolean {
    return this.middlewares.length === 0;
  }

  /** Run one model call through the beforeModelCall onion + afterModelCall transforms. */
  async modelCall(
    ctx: AgentRunContext,
    core: () => Promise<ModelCallResult>,
  ): Promise<ModelCallResult> {
    const wrapped = this.middlewares.reduceRight<() => Promise<ModelCallResult>>(
      (next, mw) => (mw.beforeModelCall ? () => mw.beforeModelCall!(ctx, next) : next),
      core,
    );
    let result = await wrapped();
    // after* transforms unwind inner→outer (reverse of the before* onion).
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      if (mw.afterModelCall) result = await mw.afterModelCall(ctx, result);
    }
    return result;
  }

  /** Run one tool call through the beforeToolCall onion + afterToolCall transforms. */
  async toolCall(
    ctx: AgentRunContext,
    call: ToolCall,
    core: () => Promise<ToolOutcome>,
  ): Promise<ToolOutcome> {
    const wrapped = this.middlewares.reduceRight<() => Promise<ToolOutcome>>(
      (next, mw) =>
        mw.beforeToolCall ? () => mw.beforeToolCall!(ctx, call, next) : next,
      core,
    );
    let outcome = await wrapped();
    // after* transforms unwind inner→outer (reverse of the before* onion).
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      if (mw.afterToolCall) outcome = await mw.afterToolCall(ctx, call, outcome);
    }
    return outcome;
  }
}

/**
 * Adapt a legacy `AgentHooks` object into a single `AgentMiddleware`, so
 * callers that still pass `hooks` (budget enforcement today) keep working
 * unchanged while the backends route everything through the pipeline. Returns
 * `null` when there's nothing to wrap.
 *
 * Semantics preserved from the old per-backend wrappers:
 *   - `preToolUse` returning `{ continue: false }` short-circuits the call and
 *     surfaces `reason` to the model as the tool result.
 *   - A throwing `preToolUse` is swallowed (treated as approve) and logged —
 *     "hook errors must not break the tool path". (The fallback backend used
 *     to surface such a throw as an isError result; budget's `preToolUse`
 *     never throws, so unifying on swallow+approve is the safer behavior.)
 *   - `postToolUse` is best-effort: a throw is logged, never propagated.
 */
export function hooksToMiddleware(hooks: AgentHooks | undefined): AgentMiddleware | null {
  if (!hooks?.preToolUse && !hooks?.postToolUse) return null;
  return {
    name: "legacy-hooks",
    async beforeToolCall(_ctx, call, next) {
      if (hooks.preToolUse) {
        try {
          const decision = await hooks.preToolUse({
            toolName: call.name,
            toolInput: call.arguments,
          });
          if (decision && decision.continue === false) {
            return {
              content: decision.reason ?? "Pre-tool-use hook blocked this call.",
              isError: true,
            };
          }
        } catch (err) {
          console.warn(
            `[middleware] preToolUse hook threw on ${call.name}: ${(err as Error).message}`,
          );
        }
      }
      return next();
    },
    async afterToolCall(_ctx, call, outcome) {
      if (hooks.postToolUse) {
        try {
          await hooks.postToolUse({
            toolName: call.name,
            toolInput: call.arguments,
            result: outcome.isError ? null : outcome.content,
            error: outcome.isError ? outcome.content : undefined,
          });
        } catch (err) {
          console.warn(
            `[middleware] postToolUse hook threw on ${call.name}: ${(err as Error).message}`,
          );
        }
      }
      return outcome;
    },
  };
}

/**
 * Build the per-run pipeline. Legacy `hooks` (adapted) run first, then any
 * explicit `middleware` the caller injects (PR2+ passes budget/audit/etc.
 * here). PR1 callers pass only `hooks`, so the pipeline is at most one element.
 */
export function buildPipeline(
  hooks: AgentHooks | undefined,
  middleware?: AgentMiddleware[],
): MiddlewarePipeline {
  const mws: AgentMiddleware[] = [];
  const legacy = hooksToMiddleware(hooks);
  if (legacy) mws.push(legacy);
  if (middleware) mws.push(...middleware);
  return new MiddlewarePipeline(mws);
}
