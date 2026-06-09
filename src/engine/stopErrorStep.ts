/**
 * Stop-And-Error step (HEL-674, Phase 1).
 *
 * n8n's "Stop And Error" node: a step that deliberately fails the run with an
 * author-supplied message (and optional error type) — used to assert an
 * invariant or reject a bad branch ("no matching record → stop with 'not
 * found'"). It is the inverse of `continueOnFail`: where continueOnFail lets a
 * *failed* step be tolerated so the run proceeds, Stop-And-Error lets an
 * otherwise-succeeding path force a hard stop.
 *
 * This helper is pure (message resolution only); the engine turns the result
 * into a step failure. Because the `stop_error` kind is exempt from
 * continueOnFail in the engine, that failure always aborts the run.
 */

import type { WorkflowStep } from "../types/workflow";

/** Fallback when the author left the message blank — never fail with no reason. */
export const DEFAULT_STOP_MESSAGE = "Workflow stopped by a Stop-And-Error step";

/** `{{key}}` interpolation — missing keys keep the literal placeholder. */
function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = context[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

export interface StopErrorResult {
  /** The resolved, context-interpolated failure message (never empty). */
  message: string;
  /** Optional author-supplied error category, echoed into the step output. */
  errorType: string | null;
}

/**
 * Resolve a Stop-And-Error step's failure message + type from its config.
 * `config.message` (legacy alias `config.errorMessage`) is `{{key}}`-interpolated
 * against the run context; a blank/missing message falls back to
 * {@link DEFAULT_STOP_MESSAGE}.
 */
export function resolveStopError(
  step: WorkflowStep,
  context: Record<string, unknown>,
): StopErrorResult {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const rawMessage =
    (typeof config["message"] === "string" && config["message"]) ||
    (typeof config["errorMessage"] === "string" && config["errorMessage"]) ||
    "";
  const message =
    rawMessage.trim().length > 0 ? interpolate(rawMessage, context) : DEFAULT_STOP_MESSAGE;
  const rawType = config["errorType"];
  const errorType =
    typeof rawType === "string" && rawType.trim().length > 0 ? rawType.trim() : null;
  return { message, errorType };
}
