/**
 * PR3 — the "fill" stage of chunked team-assembly generation.
 * (Project: Chunked team-assembly generation — HEL-551.)
 *
 * Given the already-decided skeleton, fill in the heavy per-agent fields for a
 * BATCH of roles in one call, returned as a JSON object keyed by roleKey. The
 * orchestrator (PR5) runs several of these in parallel, sized by PR1 so each
 * response stays within the provider's output budget.
 */

import { z } from "zod";
import { extractStructuredOutput } from "../engine/structuredOutput";
import { modelTierSchema, type TeamAssemblyRequest } from "./teamAssembly";
import type { TeamSkeleton } from "./teamSkeleton";

const roleDetailSchema = z.object({
  mandate: z.string().trim().min(1),
  justification: z.string().trim().min(1),
  kpis: z.array(z.string().trim().min(1)).min(1),
  skills: z.array(z.string().trim().min(1)).min(1),
  tools: z.array(z.string().trim().min(1)).min(1),
  modelTier: modelTierSchema,
  budgetMonthlyUsd: z.number().min(0).nullable(),
  provisioningInstructions: z.string().trim().min(1),
});

export type RoleDetail = z.infer<typeof roleDetailSchema>;

/**
 * Coerce the two format-fragile fields so a single bad value doesn't fail an
 * entire batch (and trigger a retry): a non-numeric `budgetMonthlyUsd`
 * (e.g. "$500") → null (= unspecified, allowed); an out-of-enum `modelTier`
 * → "standard" (the safe middle). This normalizes FORMAT only — it never
 * invents semantic content (mandates, KPIs, etc. still come from the model).
 */
function normalizeRoleDetailBatch(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  let record = input as Record<string, unknown>;
  // HEL-648: Anthropic's forced-tool JSON sometimes nests the whole record under
  // a single {"input": {...}} envelope — the open-key record tool input_schema
  // gives Claude no named keys to anchor to, so it falls back to the tool's
  // "input" field. Unwrap it so the record validates. Guarded to the exact
  // envelope shape (sole key "input" mapping to an object): a real fill is keyed
  // by roleKey slugs (never a lone "input"), so bare records from gemini/openai
  // — and single-role batches — are left untouched.
  const keys = Object.keys(record);
  if (
    keys.length === 1 &&
    keys[0] === "input" &&
    record.input &&
    typeof record.input === "object"
  ) {
    record = record.input as Record<string, unknown>;
  }
  for (const value of Object.values(record)) {
    if (!value || typeof value !== "object") continue;
    const detail = value as Record<string, unknown>;
    if (typeof detail.budgetMonthlyUsd !== "number" || !Number.isFinite(detail.budgetMonthlyUsd)) {
      detail.budgetMonthlyUsd = null;
    }
    if (
      detail.modelTier !== "lite" &&
      detail.modelTier !== "standard" &&
      detail.modelTier !== "power"
    ) {
      detail.modelTier = "standard";
    }
  }
  return record;
}

export const roleDetailBatchSchema = z.preprocess(
  normalizeRoleDetailBatch,
  z.record(z.string().trim().min(1), roleDetailSchema),
);

export type RoleDetailBatch = Record<string, RoleDetail>;

/**
 * Prompt for one fill call. Passes the full roster for coherence but asks for
 * detail on ONLY `batchRoleKeys`, returned keyed by roleKey.
 */
export function buildRoleDetailPrompt(
  input: TeamAssemblyRequest,
  skeleton: Pick<TeamSkeleton, "roles">,
  batchRoleKeys: readonly string[],
): string {
  const roster = skeleton.roles
    .map(
      (r) =>
        `  - ${r.roleKey} (${r.title}, ${r.roleType}, dept: ${r.department}${
          r.reportsToRoleKey ? `, reports to ${r.reportsToRoleKey}` : ", top role"
        })`,
    )
    .join("\n");
  const batchList = batchRoleKeys.join(", ");
  const exampleKey = batchRoleKeys[0] ?? "role-key";

  return [
    "You are staffing an agentic AI team. The team STRUCTURE is already decided (full roster below).",
    "Write the detailed spec for ONLY the roles in 'Roles to detail in THIS response'.",
    "",
    `Goal:\n${input.normalizedGoalDocument.goal}`,
    "",
    "Full team roster (context only — do NOT detail roles outside the batch):",
    roster,
    "",
    `Roles to detail in THIS response: ${batchList}`,
    "",
    "For each roleKey, return an object with ALL of these fields — never omit any:",
    "  {",
    '    "mandate": string,                  // specific ownership for THIS mission',
    '    "justification": string,            // why this role is essential to THIS goal',
    '    "kpis": [string, ...],              // 2-6 quantifiable outcomes (at least one)',
    '    "skills": [string, ...],            // concrete capabilities (at least one)',
    '    "tools": [string, ...],             // kebab-case SaaS slugs (at least one); include platforms named in the goal',
    '    "modelTier": "lite" | "standard" | "power",',
    '    "budgetMonthlyUsd": number | null,',
    '    "provisioningInstructions": string  // actionable day-one brief',
    "  }",
    "",
    "Output format:",
    "  - Return JSON only. No prose, no markdown fences.",
    `  - The top-level object's keys are EXACTLY these roleKeys: ${batchList}`,
    "  - Do not include any other roleKeys.",
    "",
    "Example shape (repeat the inner object for every roleKey above):",
    `{ "${exampleKey}": { "mandate": "...", "justification": "...", "kpis": ["..."], "skills": ["..."], "tools": ["..."], "modelTier": "standard", "budgetMonthlyUsd": null, "provisioningInstructions": "..." } }`,
  ].join("\n");
}

/**
 * Parse a fill response and return detail for exactly `expectedRoleKeys`.
 * Extra (hallucinated) keys are dropped; any MISSING key throws so the
 * orchestrator can retry just this batch.
 */
export function parseRoleDetailResponse(
  rawText: string,
  expectedRoleKeys: readonly string[],
): RoleDetailBatch {
  const batch = extractStructuredOutput<RoleDetailBatch>(rawText, {
    schema: roleDetailBatchSchema,
    label: "role-detail",
  });
  const out: RoleDetailBatch = {};
  const missing: string[] = [];
  for (const key of expectedRoleKeys) {
    if (Object.prototype.hasOwnProperty.call(batch, key)) {
      out[key] = batch[key];
    } else {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(`role-detail batch missing roleKeys: ${missing.join(", ")}`);
  }
  return out;
}
