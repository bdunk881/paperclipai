/**
 * Token budgeting for chunked team-assembly generation.
 * (Project: Chunked team-assembly generation — PR1 / HEL-501.)
 *
 * The hiring plan is generated as a small "skeleton" call (roles + framing +
 * roadmap) followed by one or more "fill" calls that each return the heavy
 * per-agent fields for a *batch* of roles. To keep every response within the
 * chosen provider's output budget — and leave room for reasoning models that
 * spend part of that budget "thinking" (those tokens count against the same
 * cap) — batch sizes and per-call `maxOutputTokens` are derived from the
 * provider's clamped output ceiling.
 *
 * This module is pure: it does not call any provider. The orchestrator (PR5)
 * uses it to split roles into fill batches and to choose each call's
 * `maxOutputTokens`.
 */

import type { ProviderName } from "../engine/llmProviders/types";
import { clampMaxOutputTokens } from "../engine/llmProviders/outputLimits";

/**
 * Conservative estimate of the output tokens a single agent's full detail
 * costs in a fill response — mandate + justification + 2–4 KPIs + skills +
 * tools + modelTier + budget + provisioningInstructions, serialized as JSON.
 * Deliberately on the high side so batches stay safely under the cap.
 */
export const ESTIMATED_TOKENS_PER_AGENT_FILL = 320;

/**
 * Target JSON output per fill call. We intentionally aim for *small, reliable*
 * fill responses (rather than packing a provider's whole ceiling) because the
 * entire point of chunking is robust, non-truncated parsing — latency is
 * recovered by running fill calls in parallel. Clamped down further for
 * low-cap providers; never scaled above this for high-cap ones.
 */
export const TARGET_FILL_JSON_TOKENS = 4000;

/** Roughly the JSON cost of one role line in the skeleton response. */
const ESTIMATED_TOKENS_PER_SKELETON_ROLE = 45;
/** Fixed skeleton overhead: company/summary/rationale + the 30/60/90 roadmap. */
const SKELETON_FRAMING_TOKENS = 900;

/**
 * Absolute output-token headroom reserved for a reasoning model's hidden
 * THINKING tokens, which count against `maxOutputTokens` alongside the JSON.
 * For gemini-2.5-pro this is roughly constant per planning task (a few
 * thousand to ~10k) and is NOT proportional to the (small) per-call JSON — so
 * it must be ADDED, not derived from a ratio of the JSON size. Set generously:
 * `maxOutputTokens` is a ceiling, not a target, so unused headroom costs
 * nothing, while too little truncates the response (the live 8-agent E2E hit
 * this on the skeleton call — thinking ate the old ~4096 budget).
 */
const REASONING_THINKING_HEADROOM_TOKENS = 24000;
const NON_REASONING_HEADROOM_TOKENS = 2048;

function thinkingHeadroom(provider: ProviderName): number {
  return REASONING_PROVIDERS.has(provider)
    ? REASONING_THINKING_HEADROOM_TOKENS
    : NON_REASONING_HEADROOM_TOKENS;
}

/**
 * Fraction of a provider's output budget we plan to fill with JSON. Reasoning
 * models spend the remainder on hidden thinking tokens (same cap); other
 * providers still keep headroom so a slightly verbose response never truncates.
 */
const REASONING_RESERVE = 0.5;
const NON_REASONING_RESERVE = 0.75;

/**
 * Providers whose default/flagship models spend output budget on hidden
 * reasoning (those tokens count against `maxOutputTokens` alongside the JSON).
 *
 * HEL-652: anthropic (claude-opus-4-8) and openai (gpt-5 / o-series) belong
 * here too — both reason internally and bill it against the output cap. A live
 * 16-role Anthropic skeleton truncated mid-JSON at the old non-reasoning budget
 * (12*45 + 900 + 2048 = 3488) because ~1.5k of that went to reasoning. With the
 * reasoning headroom (24000, clamped to the provider ceiling) the skeleton +
 * fills get the full ceiling and large teams no longer truncate. Batch sizes
 * are unchanged — the per-provider latency cap (MAX_FILL_BATCH_BY_PROVIDER)
 * still dominates — so this only raises the (ceiling-bounded) token budgets.
 */
const REASONING_PROVIDERS: ReadonlySet<ProviderName> = new Set<ProviderName>([
  "gemini",
  "vertex-ai",
  "anthropic",
  "openai",
]);

/**
 * Latency ceiling on fill-batch size for SLOW reasoning BYOK providers. (HEL-639)
 *
 * The output-budget math alone packs ~12 agents into one fill call on a
 * high-cap provider. That's fine for a FAST model (gemini ran 15 agents as
 * [12,3] comfortably under budget), but on a slow reasoning model — OpenAI's
 * gpt-5 / o-series, Anthropic's opus — a 12-agent fill (≈4k JSON + hidden
 * reasoning) can push a SINGLE call past the per-call request timeout
 * (DEFAULT_LLM_REQUEST_TIMEOUT_MS = 120s) and, summed with the skeleton call,
 * past the dashboard's generate-plan budget. Capping the batch smaller spreads
 * the same roles across MORE fill calls, which run *concurrently* — so each
 * call finishes well under the per-call timeout and total wall-clock DROPS.
 * Providers not listed here are uncapped (sized purely by output budget).
 * See src/missions/chunkedTeamAssembly.ts and the dashboard's
 * GENERATE_PLAN_TIMEOUT_MS.
 */
const MAX_FILL_BATCH_BY_PROVIDER: Partial<Record<ProviderName, number>> = {
  openai: 6,
  anthropic: 6,
};

export interface FillBatchSizeOptions {
  /** Override the per-agent token estimate (e.g. if the fill prompt grows). */
  estimatedTokensPerAgent?: number;
  /** Override the usable fraction (0–1] of the provider's output budget. */
  reserveFraction?: number;
}

function resolvePerAgent(options: FillBatchSizeOptions): number {
  const v = options.estimatedTokensPerAgent;
  return typeof v === "number" && v > 0 ? v : ESTIMATED_TOKENS_PER_AGENT_FILL;
}

function resolveReserve(provider: ProviderName, options: FillBatchSizeOptions): number {
  const v = options.reserveFraction;
  if (typeof v === "number" && v > 0 && v <= 1) return v;
  return REASONING_PROVIDERS.has(provider) ? REASONING_RESERVE : NON_REASONING_RESERVE;
}

/** The provider's hard output ceiling (the clamp's cap for this provider). */
function providerOutputCeiling(provider: ProviderName): number {
  return clampMaxOutputTokens(provider, Number.POSITIVE_INFINITY);
}

/**
 * How many roles to request per fill call for `provider` so the response stays
 * within a safe, reliably-parseable output budget. Always returns >= 1 (a lone
 * role still gets its own call rather than being dropped).
 */
export function computeFillBatchSize(
  provider: ProviderName,
  options: FillBatchSizeOptions = {},
): number {
  const perAgent = resolvePerAgent(options);
  const reserve = resolveReserve(provider, options);
  const usableCap = Math.floor(providerOutputCeiling(provider) * reserve);
  const jsonTarget = Math.min(TARGET_FILL_JSON_TOKENS, usableCap);
  const budgetSize = Math.max(1, Math.floor(jsonTarget / perAgent));
  // Apply the latency cap for slow reasoning providers (HEL-639). It only ever
  // LOWERS the budget-derived size, and budgetSize is already >= 1, so the
  // result stays >= 1.
  const latencyCap = MAX_FILL_BATCH_BY_PROVIDER[provider];
  return typeof latencyCap === "number" ? Math.min(budgetSize, latencyCap) : budgetSize;
}

/**
 * Split an ordered list of roles into fill batches of at most
 * `computeFillBatchSize(provider)`. Order is preserved; the final batch may be
 * smaller. An empty input yields an empty list (no calls).
 */
export function splitRolesIntoFillBatches<T>(
  roles: readonly T[],
  provider: ProviderName,
  options: FillBatchSizeOptions = {},
): T[][] {
  const size = computeFillBatchSize(provider, options);
  const batches: T[][] = [];
  for (let i = 0; i < roles.length; i += size) {
    batches.push(roles.slice(i, i + size));
  }
  return batches;
}

/**
 * The `maxOutputTokens` to request for a fill call covering `roleCount` roles:
 * the expected JSON (roleCount × per-agent) grossed up by the reasoning
 * reserve to leave thinking headroom, then clamped to the provider's ceiling.
 */
export function recommendedFillCallMaxTokens(
  provider: ProviderName,
  roleCount: number,
  options: FillBatchSizeOptions = {},
): number {
  const perAgent = resolvePerAgent(options);
  const safeRoleCount = Number.isFinite(roleCount) && roleCount > 0 ? Math.floor(roleCount) : 1;
  const jsonTokens = safeRoleCount * perAgent;
  // JSON output + a generous thinking allowance (reasoning models spend part
  // of maxOutputTokens on hidden thinking), clamped to the provider ceiling.
  return clampMaxOutputTokens(provider, jsonTokens + thinkingHeadroom(provider));
}

/**
 * The `maxOutputTokens` to request for the skeleton call. The skeleton is
 * small (roles identity + framing + roadmap), but we grossed it up for
 * thinking headroom and floor it so even a tiny team has room. `roleCountHint`
 * lets the caller size for a larger expected team.
 */
export function recommendedSkeletonMaxTokens(
  provider: ProviderName,
  roleCountHint = 12,
): number {
  const safeHint = Number.isFinite(roleCountHint) && roleCountHint > 0 ? roleCountHint : 12;
  const jsonTokens = safeHint * ESTIMATED_TOKENS_PER_SKELETON_ROLE + SKELETON_FRAMING_TOKENS;
  // Small JSON + generous thinking headroom. The old ratio-derived ~4096
  // truncated the skeleton once gemini's thinking tokens were counted.
  return clampMaxOutputTokens(provider, jsonTokens + thinkingHeadroom(provider));
}
