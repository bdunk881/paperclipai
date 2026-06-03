import { randomBytes } from "node:crypto";

/** Stable codes returned in API JSON for client-side display. */
export type UserFacingErrorCode =
  | "upstream_quota"
  | "upstream_auth"
  | "upstream_unavailable"
  | "plan_parse"
  | "timeout"
  | "generic";

export interface UserFacingErrorBody {
  error: string;
  code: UserFacingErrorCode;
  reference: string;
}

export const USER_FACING_MESSAGES: Record<UserFacingErrorCode, string> = {
  upstream_quota:
    "The shared model is temporarily over quota — try again shortly, or connect your own key in Settings → Providers.",
  upstream_auth:
    "The model is temporarily unavailable. Try again shortly, or connect your own key in Settings → Providers.",
  upstream_unavailable:
    "We couldn't reach the model right now. Try again shortly, or connect your own key in Settings → Providers.",
  plan_parse:
    "We couldn't generate a plan — the model returned an unexpected response. Retrying usually fixes it.",
  timeout: "Plan generation timed out. Try again in a moment.",
  generic: "We couldn't generate a plan right now. Try again shortly.",
};

/** Short support reference shown to customers (raw detail stays in logs). */
export function createErrorReference(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/**
 * Classify a raw upstream / parser message from hiring-plan generation.
 * Never returns provider names, billing URLs, or parser offsets.
 */
export function classifyHiringPlanRawMessage(
  rawMessage: string,
  phase: "llm_call" | "parse",
): UserFacingErrorCode {
  if (phase === "parse") {
    return "plan_parse";
  }

  if (
    includesAny(rawMessage, [
      "timeout",
      "timed out",
      "etimedout",
      "econnreset",
      "aborted",
      "abort",
    ])
  ) {
    return "timeout";
  }

  if (
    includesAny(rawMessage, [
      "429",
      "too many requests",
      "rate limit",
      "quota",
      "depleted",
      "credits are depleted",
      "insufficient_quota",
      "resource_exhausted",
    ])
  ) {
    return "upstream_quota";
  }

  if (
    includesAny(rawMessage, [
      "401",
      "403",
      "unauthorized",
      "forbidden",
      "invalid api key",
      "invalid_api_key",
      "authentication",
      "permission denied",
    ])
  ) {
    return "upstream_auth";
  }

  if (
    includesAny(rawMessage, [
      "could not extract json",
      "plan parse failed",
      "team-assembly",
      "unexpected token",
      "json at position",
    ])
  ) {
    return "plan_parse";
  }

  return "upstream_unavailable";
}

export function buildHiringPlanUserError(
  rawMessage: string,
  phase: "llm_call" | "parse",
): UserFacingErrorBody {
  const code = classifyHiringPlanRawMessage(rawMessage, phase);
  return {
    error: USER_FACING_MESSAGES[code],
    code,
    reference: createErrorReference(),
  };
}

/** Append a support reference line for UI copy. */
export function formatUserFacingErrorLine(body: UserFacingErrorBody): string {
  return `${body.error} (Reference: ${body.reference})`;
}
