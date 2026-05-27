/**
 * Job Description wizard (Wave 3).
 *
 * Given four short answers a small-business owner provided ("what's
 * Aaron's main job?", "how should he decide?", "what should he always
 * ask first?", "what should he never do?"), drafts a structured
 * markdown body with three H2 sections:
 *
 *   ## Mission
 *   ## How they work
 *   ## Hard rules
 *
 * The body is stored as a regular `workspace_instructions` row with
 * `kind='instruction'` and `agent_id=<agent>` — the existing
 * three-layer memory adapter already inlines it into the agent's
 * system prompt at boot, so no engine wiring is needed.
 *
 * The wizard is a write-once helper. The page calls it, gets a
 * `{ title, body }` draft, and either lets the user edit + save or
 * undo. Failures are surfaced to the user verbatim including
 * provider + model (same pattern as missionRoutes generate-plan).
 */

import type { Pool } from "pg";
import * as Sentry from "@sentry/node";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../engine/llmRouter";
import { callWithBYOKFallback } from "../billing/credits/hybridCall";

export interface JobDescriptionAnswers {
  /** "In one or two sentences, what's <agent>'s main job?" */
  mission: string;
  /** "How should they make decisions when you're not around?" */
  decisions: string;
  /** "What should they always ask you before doing?" */
  asks: string;
  /** "Anything they should never do?" (optional) */
  hardRules?: string;
}

export interface DraftJobDescriptionInput {
  agentName: string;
  agentRoleKey: string | null;
  missionStatement?: string | null;
  answers: JobDescriptionAnswers;
}

export interface DraftJobDescriptionResult {
  title: string;
  body: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

const MAX_ANSWER_LENGTH = 500;

export function buildJobDescriptionPrompt(input: DraftJobDescriptionInput): string {
  const role = input.agentRoleKey?.trim() || "operator";
  const mission = input.missionStatement?.trim() ?? "(not specified)";
  return [
    "You are drafting a Job Description for an AutoFlow agent that a small business owner just hired.",
    `The agent's name is "${input.agentName}" and their role is "${role}".`,
    `The owner's overall mission for this team is: "${mission}"`,
    "",
    "Take the owner's four short answers below and turn them into a clear, plain-English markdown document with exactly three H2 sections in this order:",
    "",
    "## Mission",
    "(2–4 sentences. Tell the agent what they are responsible for in plain English. No buzzwords.)",
    "",
    "## How they work",
    "(3–6 sentences. Describe day-to-day behavior: what the agent can decide on its own, when it should pause and ask the owner. Use concrete examples drawn from the answers.)",
    "",
    "## Hard rules",
    "(2–5 bullet points starting with 'Never'. Lift directly from the owner's never-do list; if none was provided, fall back to safe defaults like 'Never share customer data with parties not approved in writing.')",
    "",
    "Style rules:",
    "- Write in second-person ('You') as if speaking to the agent.",
    "- Keep sentences short and concrete.",
    "- Do not invent specific tools, numbers, or customer names that weren't in the answers.",
    "- Output ONLY the markdown body. No preamble, no closing remarks, no code fences.",
    "",
    "Owner's answers:",
    `Q1 (main job): ${input.answers.mission.trim()}`,
    `Q2 (how to decide alone): ${input.answers.decisions.trim()}`,
    `Q3 (always ask first): ${input.answers.asks.trim()}`,
    `Q4 (never do): ${(input.answers.hardRules ?? "").trim() || "(owner did not specify)"}`,
  ].join("\n");
}

function validateAnswers(answers: JobDescriptionAnswers): string | null {
  const required: Array<["mission" | "decisions" | "asks", string]> = [
    ["mission", answers.mission],
    ["decisions", answers.decisions],
    ["asks", answers.asks],
  ];
  for (const [key, value] of required) {
    if (typeof value !== "string" || !value.trim()) {
      return `${key} is required`;
    }
  }
  for (const value of [
    answers.mission,
    answers.decisions,
    answers.asks,
    answers.hardRules ?? "",
  ]) {
    if (value.length > MAX_ANSWER_LENGTH) {
      return `each answer must be ≤ ${MAX_ANSWER_LENGTH} characters`;
    }
  }
  return null;
}

/**
 * Calls the workspace's default LLM (via llmConfigStore) and returns
 * the drafted JD. Throws with a provider/model-tagged Error so the
 * route handler can surface the message verbatim to the dashboard
 * (consistent with the existing missionRoutes generate-plan error
 * pattern).
 *
 * `pool` is accepted for future use (e.g. recording wizard cost on a
 * separate step_results row) but is not used yet — passing it now keeps
 * the route signature stable.
 *
 * When `workspaceId` is provided, BYOK failures (429 / 401 / 403 / 5xx /
 * network) fall back to hosted credits via `callWithBYOKFallback`. The
 * wizard succeeds as long as the workspace has either a working BYOK
 * key OR a funded credits wallet — same code path either way. Customers
 * without credits get the original BYOK error verbatim.
 */
export async function draftAgentJobDescription(
  userId: string,
  input: DraftJobDescriptionInput,
  _pool?: Pool,
  workspaceId?: string,
): Promise<DraftJobDescriptionResult> {
  const validationError = validateAnswers(input.answers);
  if (validationError) {
    throw Object.assign(new Error(validationError), {
      code: "VALIDATION",
    });
  }

  const resolved = await llmConfigStore.getDecryptedDefault(userId);
  if (!resolved) {
    throw Object.assign(
      new Error(
        "No LLM provider configured. Go to Settings > LLM Providers to connect one.",
      ),
      { code: "NO_PROVIDER" },
    );
  }

  // Standard tier — drafting a 3-section job description is a
  // multi-step reasoning task, not a high-stakes one.
  const model = resolveModelForTier(resolved.config.provider, "standard");
  const maxOutputTokens = 1000;
  const prompt = buildJobDescriptionPrompt(input);

  const result = await callWithBYOKFallback({
    byokConfig: {
      provider: resolved.config.provider,
      model,
      apiKey: resolved.apiKey,
      // HEL-147: job descriptions are 3 sections (~500-700 tokens
      // typical). 1000 covers the long tail without budgeting for the
      // model to ramble across the full 4096 default.
      maxOutputTokens,
    },
    prompt,
    creditsFallback: workspaceId
      ? {
          workspaceId,
          userId,
          // Rough estimate — prompt is ~300 tokens of fixed scaffolding
          // plus the answers (~200 each, capped at 600 by the form).
          promptTokensEstimate: Math.max(800, Math.ceil(prompt.length / 4)),
          maxOutputTokens,
          relatedKind: "agent_job_description",
        }
      : undefined,
  });

  if (!result.ok) {
    const userFacing = (() => {
      switch (result.error.kind) {
        case "byok_error_no_fallback":
          return result.error.message;
        case "byok_error_fallback_failed":
          return `${result.error.byokMessage} — credits fallback also failed: ${result.error.fallbackError}`;
        case "credits_only":
          return result.error.reason;
      }
    })();
    Sentry.captureException(new Error(userFacing), {
      tags: {
        route: "POST /api/agents/:agentId/job-description/draft",
        phase: "llm_call",
        provider: resolved.config.provider,
        model,
        error_kind: result.error.kind,
      },
    });
    throw Object.assign(
      new Error(
        `Wizard call failed (${resolved.config.provider}/${model}): ${userFacing}`,
      ),
      { code: "LLM_FAILED", provider: resolved.config.provider, model },
    );
  }

  const body = result.response.text.trim();
  if (!body) {
    throw new Error("LLM returned an empty response");
  }
  return {
    title: `${input.agentName} — Job description`,
    body,
    provider: resolved.config.provider,
    model,
    promptTokens: result.response.usage?.promptTokens ?? 0,
    completionTokens: result.response.usage?.completionTokens ?? 0,
  };
}
