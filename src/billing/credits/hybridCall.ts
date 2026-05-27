/**
 * Hybrid funding mode (Phase 2 plumbing, plan §"Hybrid funding mode").
 *
 * Lets a BYOK customer's calls fall back to credits when their key
 * 429s, auth-fails, or otherwise pukes — instead of bubbling the error
 * up to the user. The wallet has to be funded for the fallback to
 * actually charge; if it isn't, the caller gets the original BYOK
 * error back (no silent degradation).
 *
 * This is opt-in per-call. A caller threads through { creditsFallback }
 * and we wrap the BYOK invocation in a try/catch — on a classified
 * "credits-recoverable" error, we hand off to creditsRouter.callWithCredits.
 *
 * Why this is its own module instead of being threaded into every
 * getProvider() call site directly:
 *   1. Most LLM call sites today are happy with BYOK-only behavior —
 *      adding a fallback there silently could change billing semantics
 *      without the caller knowing.
 *   2. The classification of "should we fall back" is non-trivial
 *      (429 yes; 400 invalid-prompt no; 500 maybe; auth-fail yes).
 *      Keeping it in one place lets the heuristic improve in one PR.
 *   3. callWithCredits already orchestrates its own ledger + reservation
 *      lifecycle — wrapping it is much cleaner than open-coding all of
 *      that at every call site.
 *
 * Adoption path:
 *   - Land this helper + tests (THIS PR) — no behavior change anywhere.
 *   - Migrate hot call sites (stepHandlers, runAgentTurn, missionRoutes)
 *     one at a time in follow-ups, each with its own A/B-able toggle.
 */
import { getProvider } from "../../engine/llmProviders";
import type { LLMProviderConfig, LLMResponse } from "../../engine/llmProviders/types";
import { callWithCredits, type CreditsCallError, type CreditsCallResult } from "./creditsRouter";

export interface CreditsFallbackContext {
  workspaceId: string;
  userId: string;
  promptTokensEstimate: number;
  maxOutputTokens: number;
  systemPrompt?: string;
  callKey?: string;
  relatedKind?: string;
  relatedId?: string;
}

export interface HybridCallArgs {
  /** Same shape as a normal getProvider() config. */
  byokConfig: LLMProviderConfig;
  /** Prompt to send to the LLM. */
  prompt: string;
  /**
   * When provided, classified failures of the BYOK invocation hand off
   * to callWithCredits. When omitted, the helper is a pass-through and
   * the original error is rethrown.
   */
  creditsFallback?: CreditsFallbackContext;
}

export type HybridCallResult =
  | { ok: true; response: LLMResponse; pathTaken: "byok"; creditsCharged?: undefined }
  | {
      ok: true;
      response: LLMResponse;
      pathTaken: "credits";
      creditsCharged: bigint;
      balanceAfter: bigint | null;
    }
  | { ok: false; error: HybridCallError };

export type HybridCallError =
  | { kind: "byok_error_no_fallback"; message: string }
  | { kind: "byok_error_fallback_failed"; byokMessage: string; fallbackError: string }
  | { kind: "credits_only"; reason: string };

/**
 * Classify a BYOK error as "should we attempt the credits fallback?"
 * Heuristic:
 *   - 429 / rate-limit messages          → yes
 *   - 401 / 403 / "invalid api key"      → yes (their key broke)
 *   - 5xx                                → yes (provider hiccup)
 *   - 400 (bad request / prompt invalid) → no  (the prompt is the
 *                                              problem, retrying via
 *                                              credits won't help)
 *   - timeouts / network                 → yes (provider unreachable)
 */
export function isCreditsRecoverable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("400") || lower.includes("bad request") || lower.includes("invalid_request")) {
    return false;
  }

  return (
    lower.includes("429")
    || lower.includes("rate limit")
    || lower.includes("rate_limit_exceeded")
    || lower.includes("too many requests")
    || lower.includes("401")
    || lower.includes("403")
    || lower.includes("invalid api key")
    || lower.includes("invalid_api_key")
    || lower.includes("unauthorized")
    || lower.includes("authentication")
    || lower.match(/\b5\d{2}\b/) != null
    || lower.includes("server error")
    || lower.includes("timeout")
    || lower.includes("etimedout")
    || lower.includes("network")
    || lower.includes("econnreset")
    || lower.includes("econnrefused")
  );
}

/**
 * Try the BYOK call. On a credits-recoverable error AND a configured
 * fallback, retry via callWithCredits. Returns a tagged union so the
 * caller can attribute spend correctly (the credits path produces a
 * ledger row; the BYOK path doesn't).
 */
export async function callWithBYOKFallback(args: HybridCallArgs): Promise<HybridCallResult> {
  // 1. Try BYOK.
  try {
    const llm = getProvider(args.byokConfig);
    const response = await llm(args.prompt);
    return { ok: true, response, pathTaken: "byok" };
  } catch (byokErr) {
    const byokMessage = byokErr instanceof Error ? byokErr.message : String(byokErr);

    // 2. No fallback configured — surface the BYOK error.
    if (!args.creditsFallback) {
      return { ok: false, error: { kind: "byok_error_no_fallback", message: byokMessage } };
    }

    // 3. Not the kind of error credits can help with — surface it too.
    if (!isCreditsRecoverable(byokErr)) {
      return { ok: false, error: { kind: "byok_error_no_fallback", message: byokMessage } };
    }

    // 4. Hand off to credits router.
    console.log(
      `[hybridCall] BYOK ${args.byokConfig.provider}/${args.byokConfig.model} failed (${
        byokMessage.slice(0, 120)
      }) — falling back to credits for workspace ${args.creditsFallback.workspaceId}`,
    );

    const creditsResult: CreditsCallResult = await callWithCredits({
      workspaceId: args.creditsFallback.workspaceId,
      userId: args.creditsFallback.userId,
      provider: args.byokConfig.provider,
      model: args.byokConfig.model,
      prompt: args.prompt,
      promptTokensEstimate: args.creditsFallback.promptTokensEstimate,
      maxOutputTokens: args.creditsFallback.maxOutputTokens,
      systemPrompt: args.creditsFallback.systemPrompt,
      callKey: args.creditsFallback.callKey,
      relatedKind: args.creditsFallback.relatedKind,
      relatedId: args.creditsFallback.relatedId,
    });

    if (creditsResult.ok) {
      return {
        ok: true,
        response: creditsResult.response,
        pathTaken: "credits",
        creditsCharged: creditsResult.creditsCharged,
        balanceAfter: creditsResult.balanceAfter,
      };
    }

    // 5. Credits fallback also failed — surface a composite error so
    // the caller can decide what to tell the user.
    return {
      ok: false,
      error: {
        kind: "byok_error_fallback_failed",
        byokMessage,
        fallbackError: describeCreditsError(creditsResult.error),
      },
    };
  }
}

function describeCreditsError(error: CreditsCallError): string {
  switch (error.kind) {
    case "no_key_source":
      return `no platform key source available for ${error.provider}`;
    case "no_pricing":
      return `no pricing on file for ${error.provider}/${error.model}`;
    case "insufficient_credits":
      return `wallet is empty (balance: ${error.balanceAfter ?? "unknown"})`;
    case "provider_429":
      return `platform key also rate-limited (retry after ${error.retryAfterSeconds}s)`;
    case "provider_error":
      return `platform provider error: ${error.message}`;
    case "wallet_error":
      return `wallet error: ${error.reason}`;
  }
}
