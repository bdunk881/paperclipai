/**
 * Credits router — orchestrates a hosted-credits LLM call.
 *
 * Caller hands us { workspaceId, userId, provider, model, prompt, ... }
 * along with the worst-case token estimate. We:
 *
 *   1. Pick the best key source via keySourceStore.pickKeySource()
 *      (Phase 1: only an OpenRouter row matches anything; Phase 2+ may
 *      have direct-provider rows preferred over OpenRouter).
 *   2. Reserve worst-case credits in the wallet (atomic).
 *   3. Build the LLM provider adapter — if the picked source is
 *      OpenRouter we use the openrouter adapter (with model-slug
 *      translation); if direct we use the underlying provider's adapter.
 *   4. Invoke the model.
 *   5. On success: compute actual cost, commit the reservation with
 *      real usage. Update key-source spend headroom.
 *   6. On 429: mark source throttled, fail back to caller (which will
 *      typically fall back to the next provider in the tier chain via
 *      tierRouter, then back here for re-resolution).
 *   7. On any other error: release the reservation, surface error.
 */
import { randomUUID } from "node:crypto";

import { getProvider } from "../../engine/llmProviders";
import type { LLMProviderConfig, LLMResponse } from "../../engine/llmProviders/types";
import { actualCallCredits, estimateWorstCaseCredits } from "./costCalculator";
import {
  pickKeySource,
  markThrottled,
  recordSuccess,
  type SelectedKeySource,
} from "./keySourceStore";
import {
  commitCredits,
  releaseCredits,
  reserveCredits,
  type CommitResult,
  type ReserveResult,
} from "./walletStore";

export interface CreditsCallArgs {
  workspaceId: string;
  userId: string;
  provider: string;
  model: string;
  prompt: string;
  promptTokensEstimate: number;
  maxOutputTokens: number;
  systemPrompt?: string;
  /** Optional caller-supplied idempotency key. Auto-generated when omitted. */
  callKey?: string;
  /** For ledger attribution. */
  relatedKind?: string;
  relatedId?: string;
}

export type CreditsCallError =
  | { kind: "no_key_source"; provider: string }
  | { kind: "no_pricing"; provider: string; model: string }
  | { kind: "insufficient_credits"; balanceAfter: bigint | null }
  | { kind: "provider_429"; sourceId: string; retryAfterSeconds: number; message: string }
  | { kind: "provider_error"; message: string }
  | { kind: "wallet_error"; reason: string };

export type CreditsCallResult =
  | { ok: true; response: LLMResponse; creditsCharged: bigint; balanceAfter: bigint | null }
  | { ok: false; error: CreditsCallError };

/**
 * Build an LLMProviderConfig pointed at the chosen key source. When the
 * source is OpenRouter, we set provider="openrouter" and stash the
 * upstream provider in options.routedProvider so the openrouter adapter
 * can translate to the right vendor/model slug.
 */
function buildProviderConfig(args: {
  source: SelectedKeySource;
  upstreamProvider: string;
  upstreamModel: string;
  systemPrompt?: string;
  maxOutputTokens: number;
}): LLMProviderConfig {
  if (args.source.sourceKind === "openrouter") {
    return {
      provider: "openrouter",
      model: args.upstreamModel,
      apiKey: args.source.apiKey,
      systemPrompt: args.systemPrompt,
      maxOutputTokens: args.maxOutputTokens,
      options: { routedProvider: args.upstreamProvider } as LLMProviderConfig["options"],
    };
  }
  // Direct provider — use the source's `provider` as the LLM provider
  // name (it's been validated against PROVIDER_NAMES on insert).
  return {
    provider: args.source.provider as LLMProviderConfig["provider"],
    model: args.upstreamModel,
    apiKey: args.source.apiKey,
    systemPrompt: args.systemPrompt,
    maxOutputTokens: args.maxOutputTokens,
  };
}

/**
 * Classify an SDK / HTTP error as a rate-limit (429) or generic failure.
 * OpenAI-compat SDKs raise with the status string in the message; this
 * is brittle but acceptable for now.
 */
function classifyError(err: unknown): { is429: boolean; retryAfterSeconds: number; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const is429 =
    lower.includes("429")
    || lower.includes("rate limit")
    || lower.includes("rate_limit_exceeded")
    || lower.includes("too many requests");
  // Without a Retry-After header (the OpenAI SDK doesn't surface it on
  // throw), fall back to a 5 min cooldown — long enough that a hot key
  // doesn't immediately get re-picked, short enough that recovery happens.
  return { is429, retryAfterSeconds: is429 ? 300 : 0, message };
}

export async function callWithCredits(args: CreditsCallArgs): Promise<CreditsCallResult> {
  const callKey = args.callKey ?? `creditcall_${randomUUID()}`;
  const reservationKey = `${callKey}__reserve`;
  const commitKey = `${callKey}__commit`;
  const releaseKey = `${callKey}__release`;

  // 1. Pick key source.
  const source = await pickKeySource(args.provider);
  if (!source) {
    return { ok: false, error: { kind: "no_key_source", provider: args.provider } };
  }

  // 2. Worst-case estimate + reserve.
  const estimate = await estimateWorstCaseCredits({
    provider: args.provider,
    model: args.model,
    promptTokens: args.promptTokensEstimate,
    maxOutputTokens: args.maxOutputTokens,
    workspaceId: args.workspaceId,
  });
  if (!estimate) {
    return { ok: false, error: { kind: "no_pricing", provider: args.provider, model: args.model } };
  }

  const reserve: ReserveResult = await reserveCredits({
    workspaceId: args.workspaceId,
    userId: args.userId,
    credits: estimate.credits,
    reservationKey,
    provider: args.provider,
    model: args.model,
    metadata: { call_key: callKey, source_id: source.id, source_kind: source.sourceKind },
  });
  if (!reserve.reserved) {
    return {
      ok: false,
      error: { kind: "insufficient_credits", balanceAfter: reserve.balanceAfter },
    };
  }

  // 3. Invoke the LLM.
  const config = buildProviderConfig({
    source,
    upstreamProvider: args.provider,
    upstreamModel: args.model,
    systemPrompt: args.systemPrompt,
    maxOutputTokens: args.maxOutputTokens,
  });

  let response: LLMResponse;
  try {
    const llm = getProvider(config);
    response = await llm(args.prompt);
  } catch (err) {
    const cls = classifyError(err);
    if (cls.is429) {
      await markThrottled(source.id, cls.retryAfterSeconds);
    }
    // Release the reservation on every LLM error path so the customer
    // doesn't lose the credits while we hand them a "service unavailable".
    await releaseCredits({
      workspaceId: args.workspaceId,
      userId: args.userId,
      reservationKey,
      releaseKey,
      reason: cls.is429 ? "provider_429" : "provider_error",
    });
    if (cls.is429) {
      return {
        ok: false,
        error: {
          kind: "provider_429",
          sourceId: source.id,
          retryAfterSeconds: cls.retryAfterSeconds,
          message: cls.message,
        },
      };
    }
    return { ok: false, error: { kind: "provider_error", message: cls.message } };
  }

  // 4. Commit with actual usage.
  const usage = response.usage ?? { promptTokens: args.promptTokensEstimate, completionTokens: args.maxOutputTokens };
  const actual = await actualCallCredits({
    provider: args.provider,
    model: args.model,
    usage,
    workspaceId: args.workspaceId,
  });
  // actualCallCredits can only return null if the (provider, model) is
  // missing from the rate card — but we already passed the same
  // estimateWorstCaseCredits check above, so this should never fire.
  // Defensive fallback to the worst-case estimate keeps the call from
  // failing silently if a rate-card row is yanked between steps.
  const charged = actual?.credits ?? estimate.credits;

  const commit: CommitResult = await commitCredits({
    workspaceId: args.workspaceId,
    userId: args.userId,
    reservationKey,
    commitKey,
    actualCredits: charged,
    provider: args.provider,
    model: args.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cachedPromptTokens: usage.cachedPromptTokens,
    wholesaleCostUsd: actual?.wholesaleUsd ?? estimate.wholesaleUsd,
    retailCostUsd: actual?.retailUsd ?? estimate.retailUsd,
    markupMultiplier: actual?.markupMultiplier ?? estimate.markupMultiplier,
    relatedKind: args.relatedKind,
    relatedId: args.relatedId,
    metadata: { call_key: callKey, source_id: source.id, source_kind: source.sourceKind },
  });

  // Update spend headroom on the key source. This is best-effort — a
  // failure here doesn't fail the customer call.
  recordSuccess(source.id, actual?.wholesaleUsd ?? estimate.wholesaleUsd).catch((err) => {
    console.warn(
      `[creditsRouter] recordSuccess failed for source ${source.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });

  if (!commit.committed) {
    // Commit shouldn't normally fail — log loudly. The reservation has
    // already been turned into a consumption record at the DB layer if
    // commit succeeded; on failure the reservation is still held and
    // we surface a wallet_error so the caller can decide.
    return { ok: false, error: { kind: "wallet_error", reason: commit.reason } };
  }

  return {
    ok: true,
    response,
    creditsCharged: charged,
    balanceAfter: commit.balanceAfter,
  };
}
