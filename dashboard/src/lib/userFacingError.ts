/**
 * Client-side error presentation for API failures (HEL-437).
 *
 * Prefer server-provided `code` + sanitized `error` when present; fall back to
 * classifying legacy raw strings so older deploys still get safe copy.
 */

export type UserFacingErrorCode =
  | "upstream_quota"
  | "upstream_auth"
  | "upstream_unavailable"
  | "plan_parse"
  | "timeout"
  | "generic";

const MESSAGES: Record<UserFacingErrorCode, string> = {
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

export class ApiUserError extends Error {
  readonly code?: UserFacingErrorCode;
  readonly reference?: string;

  constructor(message: string, options?: { code?: UserFacingErrorCode; reference?: string }) {
    super(message);
    this.name = "ApiUserError";
    this.code = options?.code;
    this.reference = options?.reference;
  }
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/** Classify legacy hiring-plan error strings from pre-HEL-437 backends. */
export function classifyLegacyHiringPlanMessage(raw: string): UserFacingErrorCode {
  if (includesAny(raw, ["plan parse failed", "could not extract json", "team-assembly"])) {
    return "plan_parse";
  }
  if (includesAny(raw, ["llm call failed"])) {
    if (includesAny(raw, ["429", "quota", "depleted", "too many requests", "rate limit"])) {
      return "upstream_quota";
    }
    if (includesAny(raw, ["401", "403", "unauthorized", "invalid api key", "authentication"])) {
      return "upstream_auth";
    }
    if (includesAny(raw, ["timeout", "timed out"])) {
      return "timeout";
    }
    return "upstream_unavailable";
  }
  if (includesAny(raw, ["timeout", "timed out", "request timed out"])) {
    return "timeout";
  }
  return "generic";
}

export type ApiErrorPayload = {
  error?: string;
  detail?: string;
  code?: UserFacingErrorCode;
  reference?: string;
};

export function errorFromApiPayload(
  payload: ApiErrorPayload | null,
  fallback: string,
): ApiUserError {
  const code = payload?.code;
  const reference = payload?.reference?.trim();
  const serverMessage = payload?.error?.trim();

  if (code && serverMessage) {
    return new ApiUserError(serverMessage, { code, reference });
  }

  const raw = [serverMessage, payload?.detail?.trim()].filter(Boolean).join(": ") || fallback;
  const inferred = classifyLegacyHiringPlanMessage(raw);
  return new ApiUserError(MESSAGES[inferred], { code: inferred, reference });
}

/** User-visible line including optional support reference. */
export function formatUserFacingError(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiUserError) {
    const base = err.message || fallback;
    return err.reference ? `${base} (Reference: ${err.reference})` : base;
  }
  if (err instanceof Error) {
    const inferred = classifyLegacyHiringPlanMessage(err.message);
    if (inferred !== "generic" || includesAny(err.message, ["llm call failed", "plan parse failed"])) {
      return MESSAGES[inferred];
    }
    return err.message || fallback;
  }
  return fallback;
}
