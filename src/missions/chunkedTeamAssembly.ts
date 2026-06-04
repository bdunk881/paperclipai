/**
 * PR5 — the orchestrator for chunked team-assembly generation.
 * (Project: Chunked team-assembly generation — HEL-553.)
 *
 * Runs the three stages — skeleton (PR2) → parallel batched fills (PR3) →
 * reduce/assemble (PR4) — sized by the per-provider budget helpers (PR1).
 * Each fill batch retries once on failure before giving up. Token usage is
 * aggregated across every sub-call so the caller records true cost.
 *
 * Gated behind `TEAM_ASSEMBLY_CHUNKED` at the route; this module itself is
 * pure orchestration over `getProvider`, so it is unit-testable by mocking
 * the provider factory.
 */

import { getProvider } from "../engine/llmProviders";
import type { ProviderName } from "../engine/llmProviders/types";
import type { TeamAssemblyRequest, TeamAssemblyResult } from "../goals/teamAssembly";
import { buildTeamSkeletonPrompt, parseTeamSkeletonResponse, type TeamSkeleton } from "../goals/teamSkeleton";
import { buildRoleDetailPrompt, parseRoleDetailResponse, type RoleDetail } from "../goals/roleDetail";
import { assembleTeamPlan } from "../goals/assembleTeamPlan";
import {
  computeFillBatchSize,
  splitRolesIntoFillBatches,
  recommendedFillCallMaxTokens,
  recommendedSkeletonMaxTokens,
} from "./teamAssemblyBudget";

/** True when the chunked generation path is enabled for this process. */
export function isChunkedTeamAssemblyEnabled(): boolean {
  return process.env.TEAM_ASSEMBLY_CHUNKED === "true";
}

export interface ChunkedLlm {
  provider: ProviderName;
  model: string;
  /** May be undefined; the provider factory throws a clear error if so. */
  apiKey: string | undefined;
}

export interface ChunkedUsage {
  promptTokens: number;
  completionTokens: number;
  /** Number of LLM calls made (1 skeleton + N fills, including retries). */
  calls: number;
}

export interface ChunkedGenerationResult {
  result: TeamAssemblyResult;
  usage: ChunkedUsage;
}

type ProviderFn = ReturnType<typeof getProvider>;

export async function generateTeamPlanChunked(
  request: TeamAssemblyRequest,
  llm: ChunkedLlm,
): Promise<ChunkedGenerationResult> {
  const usage: ChunkedUsage = { promptTokens: 0, completionTokens: 0, calls: 0 };
  const accumulate = (u?: { promptTokens?: number; completionTokens?: number }): void => {
    usage.promptTokens += u?.promptTokens ?? 0;
    usage.completionTokens += u?.completionTokens ?? 0;
    usage.calls += 1;
  };

  // --- Stage 1: skeleton (structure + framing + roadmap) ---------------
  const skeletonProvider = getProvider({
    provider: llm.provider,
    model: llm.model,
    apiKey: llm.apiKey,
    responseFormat: { type: "json_object" },
    maxOutputTokens: recommendedSkeletonMaxTokens(llm.provider),
  });
  const skeletonResp = await skeletonProvider(buildTeamSkeletonPrompt(request));
  accumulate(skeletonResp.usage);
  let skeleton: TeamSkeleton;
  try {
    skeleton = parseTeamSkeletonResponse(skeletonResp.text);
  } catch (err) {
    throw augmentWithRaw("skeleton", err, skeletonResp.text);
  }

  // --- Stage 2: fills (heavy per-agent fields), batched + parallel -----
  const roleKeys = skeleton.roles.map((r) => r.roleKey);
  const batchSize = computeFillBatchSize(llm.provider);
  const fillProvider = getProvider({
    provider: llm.provider,
    model: llm.model,
    apiKey: llm.apiKey,
    responseFormat: { type: "json_object" },
    maxOutputTokens: recommendedFillCallMaxTokens(llm.provider, batchSize),
  });
  const batches = splitRolesIntoFillBatches(roleKeys, llm.provider);
  const batchResults = await Promise.all(
    batches.map((batch) => runFillBatch(fillProvider, request, skeleton, batch, accumulate)),
  );
  const fills: Record<string, RoleDetail> = Object.assign({}, ...batchResults);

  // --- Stage 3: reduce -------------------------------------------------
  const result = assembleTeamPlan(skeleton, fills);
  return { result, usage };
}

/**
 * Run one fill batch, retrying ONCE on any failure (parse/schema/provider).
 * gemini variance or a single malformed batch shouldn't sink the whole plan.
 */
async function runFillBatch(
  fillProvider: ProviderFn,
  request: TeamAssemblyRequest,
  skeleton: TeamSkeleton,
  batch: readonly string[],
  accumulate: (u?: { promptTokens?: number; completionTokens?: number }) => void,
): Promise<Record<string, RoleDetail>> {
  const prompt = buildRoleDetailPrompt(request, skeleton, batch);
  try {
    const resp = await fillProvider(prompt);
    accumulate(resp.usage);
    return parseRoleDetailResponse(resp.text, batch);
  } catch {
    // fall through to a single retry
  }
  const resp = await fillProvider(prompt);
  accumulate(resp.usage);
  try {
    return parseRoleDetailResponse(resp.text, batch);
  } catch (err) {
    throw augmentWithRaw(`fill[${batch.join(",")}]`, err, resp.text);
  }
}

/**
 * Re-throw a parse/validation error with a snippet of the raw model output so
 * the failure mode (truncated mid-JSON vs. wrong shape) is diagnosable from the
 * server logs / Sentry without re-running. Server-side only — the route still
 * returns the branded user error.
 */
function augmentWithRaw(stage: string, err: unknown, raw: string): Error {
  const base = err instanceof Error ? err.message : String(err);
  const head = raw.slice(0, 180).replace(/\s+/g, " ");
  const tail = raw.length > 360 ? ` … ${raw.slice(-120).replace(/\s+/g, " ")}` : "";
  return new Error(`${base} | ${stage} raw(${raw.length}c): "${head}"${tail}`);
}
