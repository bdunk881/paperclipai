/**
 * modelFallbackMiddleware (HEL-627) — fails the run over to a secondary model
 * when the primary keeps erroring.
 *
 * Composes OUTSIDE modelRetryMiddleware (placed earlier in the pipeline array):
 * retry exhausts its attempts on the primary tier, then — on a still-failing
 * transient error — this middleware switches `ctx.binding.model` to the
 * fallback tier's model and re-drives the call (which retry then attempts on
 * the fallback model). The switch is STICKY: once failed over, the rest of the
 * run stays on the fallback model, and we never fail over twice.
 *
 * Same-provider only: the tier router (`resolveModelForTier`) keeps the
 * provider + API key fixed and changes only the model string, so the fallback
 * backend's `buildRequest` (which reads `ctx.binding.model`) picks the new
 * model up with no backend change. The SDK backends don't drive
 * `pipeline.modelCall`, so this is inert there (fallback delegated to the SDK).
 *
 * Gated by AUTOFLOW_AGENT_MODEL_FALLBACK_ENABLED at the wiring layer
 * (runAgentTurn); when off, the middleware isn't in the pipeline at all.
 */
import { isTransientModelError } from "./modelRetryMiddleware";
import type { AgentMiddleware, ModelCallResult } from "./types";

const FALLBACK_APPLIED = Symbol("modelFallback.applied");

export interface ModelFallbackOptions {
  /** Model to switch to on failover (resolved by the caller from a fallback tier). */
  fallbackModel: string;
  /** Which errors warrant failover. Defaults to the shared transient classifier. */
  isRetryable?: (err: unknown) => boolean;
}

export function modelFallbackMiddleware(options: ModelFallbackOptions): AgentMiddleware {
  const isRetryable = options.isRetryable ?? isTransientModelError;
  return {
    name: "model-fallback",
    async beforeModelCall(ctx, next): Promise<ModelCallResult> {
      try {
        return await next();
      } catch (err) {
        const alreadyFailedOver = ctx.state.get(FALLBACK_APPLIED) === true;
        if (
          alreadyFailedOver ||
          !options.fallbackModel ||
          options.fallbackModel === ctx.binding.model ||
          !isRetryable(err)
        ) {
          throw err;
        }
        // Sticky failover: switch the model for this call and the rest of the run.
        ctx.state.set(FALLBACK_APPLIED, true);
        ctx.binding.model = options.fallbackModel;
        return next();
      }
    },
  };
}
