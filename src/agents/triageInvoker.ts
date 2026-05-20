/**
 * LLM-backed triage invoker (HEL-148).
 *
 * Triage fires on EVERY wake event (webhooks, mentions, approvals, upstream
 * completions, scheduled ticks, user messages). For a single workspace
 * with N agents at ~100 events/hour, that's N × 100 LLM calls/hour. Each
 * call carries:
 *
 *   - **Agent identity card** (~500–1500 tokens, stable per-agent)
 *   - **Policy body** (~a few KB, stable per-agent)
 *   - **Event payload** (~50–200 tokens, varies)
 *
 * The first two are the cacheable prefix. Without prompt caching, an
 * agent handling 100 events/hour pays for its identity card 100 times.
 * With Anthropic ephemeral cache (5-minute TTL, ~50–80% input-token
 * discount on cached blocks) this reduces to a single full-price
 * "creation" call every 5 minutes + cheap "read" calls between.
 *
 * Expected per-event cost target: ≤ $0.0005 on Haiku.
 *
 * ## Design
 *
 * The invoker is a factory `createLlmTriageInvoker(deps)` returning a
 * `TriageInvoker`. The factory captures the workspace's LLM credential
 * + tier; the returned function is `TriageInvoker` so existing
 * `triageEvent(pool, event, args, invoker)` plumbing stays unchanged.
 *
 * The cacheable prefix is built ONCE per call from `agentIdentityCard +
 * policyBody + OUTPUT_SCHEMA`. Anthropic caches on the BYTE-EXACT prefix
 * — so this prompt MUST be deterministic across calls for the same
 * agent. Per-event content (the event source, summary, payload) belongs
 * in the user message, never the system block.
 *
 * Depends on HEL-145 (Anthropic prompt caching plumbing) which is live.
 */

import type { Pool } from "pg";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { getProvider } from "../engine/llmProviders";
import { resolveModelForTier } from "../engine/llmRouter";
import type {
  TriageInvokeInput,
  TriageInvokeOutput,
  TriageInvoker,
} from "./triagePolicy";
import type { WakeDecision } from "./wakeEventStore";

/**
 * The output contract the LLM must follow. Kept short so it lands inside
 * the cacheable prefix and doesn't blow up the per-call user prompt.
 */
const OUTPUT_SCHEMA = `OUTPUT FORMAT — return ONLY a single JSON object on one line, no prose:

{
  "decision": "ACT" | "IGNORE" | "DEFER" | "ESCALATE",
  "reason": "<one sentence justifying the decision, max 200 chars>",
  "escalatedTo": "<agent_id when decision=ESCALATE, otherwise null>",
  "deferredUntil": "<ISO-8601 timestamp when decision=DEFER, otherwise null>"
}

Rules:
- decision is required and must be one of the four enum values
- reason is required, never empty
- escalatedTo is required when decision=ESCALATE; null otherwise
- deferredUntil is required when decision=DEFER; null otherwise
- Do not include code fences, prose, or commentary outside the JSON object.`;

export interface CreateLlmTriageInvokerInput {
  pool: Pool;
  /** Workspace owner — used to resolve the LLM credential. */
  userId: string;
  workspaceId: string;
  /** Default 'lite' — triage decisions are small classifications. */
  tier?: "lite" | "standard" | "power";
  /** Cap on output tokens. Triage replies are small JSON. */
  maxOutputTokens?: number;
}

/**
 * Builds the BYTE-IDENTICAL system prompt that will be cached on Anthropic.
 *
 * Critical: this string must NOT include any per-event content. The whole
 * point of caching is that the prefix is stable across calls for the
 * same agent. Per-event variation lives in `buildTriageUserPrompt`.
 *
 * Exported so tests can byte-compare two invocations for the same agent
 * — that's the strongest assertion we can make about cache eligibility
 * without a live API.
 */
export function buildTriageSystemPrompt(
  agentIdentityCard: string,
  policyBody: string,
): string {
  return [
    "You are the triage layer for an autonomous agent. For each incoming",
    "wake event, decide whether the agent should ACT now, IGNORE the event",
    "entirely, DEFER for later, or ESCALATE to a parent agent.",
    "",
    "AGENT IDENTITY CARD",
    "-------------------",
    agentIdentityCard.trim(),
    "",
    "TRIAGE POLICY",
    "-------------",
    policyBody.trim(),
    "",
    OUTPUT_SCHEMA,
  ].join("\n");
}

/**
 * Builds the per-event user prompt — the only part that varies per call.
 * Kept small so the cache prefix dominates the token count.
 */
export function buildTriageUserPrompt(event: TriageInvokeInput["event"]): string {
  return [
    "EVENT",
    "-----",
    `source: ${event.source}`,
    `sourceRef: ${event.sourceRef ?? "null"}`,
    `summary: ${event.summary}`,
    `payload: ${JSON.stringify(event.payload)}`,
  ].join("\n");
}

interface ParsedTriageReply {
  decision: Exclude<WakeDecision, "PENDING">;
  reason: string;
  escalatedTo: string | null;
  deferredUntil: string | null;
}

/**
 * Robust parser for the model's reply. Handles:
 *   - Code-fenced JSON (```json ... ```)
 *   - Extra leading/trailing whitespace
 *   - Missing optional fields
 *
 * Returns null when the reply is unparseable; caller falls back to a
 * safety-default DEFER outcome.
 */
function parseTriageReply(rawText: string): ParsedTriageReply | null {
  const stripped = rawText
    .trim()
    // Strip ```json ... ``` or ``` ... ``` fences.
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  // Defensive: find the first top-level JSON object if there's leading prose.
  const objectStart = stripped.indexOf("{");
  const objectEnd = stripped.lastIndexOf("}");
  if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
    return null;
  }
  const candidate = stripped.slice(objectStart, objectEnd + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const decision = obj.decision;
  if (
    decision !== "ACT" &&
    decision !== "IGNORE" &&
    decision !== "DEFER" &&
    decision !== "ESCALATE"
  ) {
    return null;
  }
  const reason = typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim() : null;
  if (!reason) return null;
  return {
    decision,
    reason,
    escalatedTo: typeof obj.escalatedTo === "string" ? obj.escalatedTo : null,
    deferredUntil: typeof obj.deferredUntil === "string" ? obj.deferredUntil : null,
  };
}

/**
 * Anthropic's cached-token output usage shape. The provider doesn't
 * surface a discrete unit price for cached vs uncached tokens, so we
 * approximate cost from the `usage` snapshot returned by the LLM call.
 * Pricing is per-1k-token; values match the Haiku/Sonnet/Opus rates as
 * of 2026-05. Update when Anthropic ships a new model tier.
 */
const HAIKU_INPUT_PRICE_PER_1K = 0.00025; // $0.25 / 1M input tokens
const HAIKU_OUTPUT_PRICE_PER_1K = 0.00125; // $1.25 / 1M output tokens

function estimateCostUsd(
  usage: { promptTokens: number; completionTokens: number },
): number {
  // Conservative estimate — assumes Haiku rates. Standard tier would
  // bump these, but `lite` is the default for triage so most calls
  // land on Haiku anyway.
  const inputCost = (usage.promptTokens / 1000) * HAIKU_INPUT_PRICE_PER_1K;
  const outputCost = (usage.completionTokens / 1000) * HAIKU_OUTPUT_PRICE_PER_1K;
  return Number((inputCost + outputCost).toFixed(6));
}

/**
 * Factory: returns a `TriageInvoker` bound to a workspace's LLM
 * credential + tier. Wire into `triageEvent(pool, event, args, invoker)`
 * by passing the returned function as the `invoker` parameter.
 *
 * Caching contract: the system prompt is built from the agent's
 * identity card + policy body, byte-identical across calls for the
 * same agent. Anthropic caches it for 5 minutes; per-event variation
 * lives only in the user message.
 */
export function createLlmTriageInvoker(
  deps: CreateLlmTriageInvokerInput,
): TriageInvoker {
  const tier = deps.tier ?? "lite";
  const maxOutputTokens = deps.maxOutputTokens ?? 300;

  return async (input: TriageInvokeInput): Promise<TriageInvokeOutput> => {
    // Resolve the workspace's LLM credential lazily so a credential
    // rotation doesn't require recreating the invoker.
    const resolved = await llmConfigStore.getDecryptedDefault(deps.userId);
    if (!resolved) {
      // No credential — fall back to the safety default (DEFER 1h).
      // This mirrors triagePolicy.ts's exception-handler shape.
      return {
        decision: "DEFER",
        reason:
          "LLM triage credential not configured. Connect a provider in Settings → Models. Defer 1h.",
        deferredUntil: new Date(Date.now() + 3600_000).toISOString(),
        costUsd: 0,
      };
    }

    const model = resolveModelForTier(resolved.config.provider, tier);
    const systemPrompt = buildTriageSystemPrompt(
      input.agentIdentityCard,
      input.policyBody,
    );
    const userPrompt = buildTriageUserPrompt(input.event);

    const provider = getProvider({
      provider: resolved.config.provider,
      model,
      apiKey: resolved.apiKey,
      systemPrompt,
      // HEL-148 / HEL-145: tag the system block as cacheable on Anthropic.
      // Reads as a no-op on providers that don't expose cache controls.
      cacheSystemPrompt: true,
      maxOutputTokens,
    });

    let response: Awaited<ReturnType<typeof provider>>;
    try {
      response = await provider(userPrompt);
    } catch (err) {
      return {
        decision: "DEFER",
        reason: `LLM triage call failed: ${(err as Error).message.slice(0, 140)}. Defer 1h.`,
        deferredUntil: new Date(Date.now() + 3600_000).toISOString(),
        costUsd: 0,
      };
    }

    const parsed = parseTriageReply(response.text);
    if (!parsed) {
      // Model returned something we can't parse — DEFER as a safety
      // default. Surface the raw text in the reason for operators.
      return {
        decision: "DEFER",
        reason: `LLM triage returned an unparseable reply: ${response.text.slice(0, 140)}. Defer 1h.`,
        deferredUntil: new Date(Date.now() + 3600_000).toISOString(),
        costUsd: estimateCostUsd(response.usage ?? { promptTokens: 0, completionTokens: 0 }),
      };
    }

    return {
      decision: parsed.decision,
      reason: parsed.reason,
      escalatedTo: parsed.escalatedTo,
      deferredUntil: parsed.deferredUntil,
      costUsd: estimateCostUsd(response.usage ?? { promptTokens: 0, completionTokens: 0 }),
    };
  };
}
