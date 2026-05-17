/**
 * Mission routes (HEL-23 + HEL-24).
 *
 * POST /api/missions
 *   Create a new mission for the active workspace. Accepts a free-text
 *   statement plus optional structured prompts (industry, target customer,
 *   success metric, runway) stored as `missions.metadata` jsonb.
 *   If the workspace has no company yet, creates a default company named
 *   after the workspace so the mission has somewhere to live. (HEL-23.)
 *
 * GET /api/missions
 *   List the active workspace's missions, newest first. Includes the latest
 *   hiring plan id when present. (HEL-23.)
 *
 * GET /api/missions/:missionId
 *   Single-mission lookup with latest hiring plan if drafted. (HEL-23.)
 *
 * POST /api/missions/:missionId/generate-plan
 *   Reads the mission row, builds a teamAssembly request, calls the
 *   workspace's default LLM, and persists the response as a
 *   `hiring_plans` draft. (HEL-24.)
 */

import { Router } from "express";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  buildTeamAssemblyPrompt,
  DEFAULT_ROLE_LIBRARY,
  parseTeamAssemblyResponse,
  TEAM_ASSEMBLY_SCHEMA_VERSION,
  type TeamAssemblyRequest,
  type TeamAssemblyResult,
} from "../goals/teamAssembly";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { resolveModelForTier } from "../engine/llmRouter";
import { getProvider } from "../engine/llmProviders";
import { computeHiringPlanCostCents } from "./hiringPlanCost";
import { recordHiringPlanCost } from "./hiringPlanCostWriter";
import { ensureUserProfileExists } from "../user/profileStore";

interface MissionRow {
  id: string;
  company_id: string;
  statement: string;
  workspace_id: string;
  company_name: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MissionMetadata {
  industry?: string;
  targetCustomer?: string;
  successMetric?: string;
  runway?: string;
}

export interface MissionListItem {
  id: string;
  statement: string;
  status: string;
  metadata: MissionMetadata;
  createdAt: string;
  companyId: string;
  companyName: string;
  latestHiringPlanId: string | null;
}

const MAX_STATEMENT_LENGTH = 4000;
const MAX_METADATA_FIELD_LENGTH = 280;

function trimMetadataField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_METADATA_FIELD_LENGTH
    ? trimmed.slice(0, MAX_METADATA_FIELD_LENGTH)
    : trimmed;
}

function sanitizeMetadata(input: unknown): MissionMetadata {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const out: MissionMetadata = {};
  const industry = trimMetadataField(raw.industry);
  if (industry) out.industry = industry;
  const targetCustomer = trimMetadataField(raw.targetCustomer);
  if (targetCustomer) out.targetCustomer = targetCustomer;
  const successMetric = trimMetadataField(raw.successMetric);
  if (successMetric) out.successMetric = successMetric;
  const runway = trimMetadataField(raw.runway);
  if (runway) out.runway = runway;
  return out;
}

/**
 * Resolves the workspace's default company id. Creates one named after the
 * workspace if none exists yet. Idempotent: subsequent calls return the
 * existing company.
 *
 * Per the HEL-13 schema, missions require a company_id (NOT NULL). We don't
 * want the customer to deal with "create a company first" friction for the
 * single-company case, so auto-provisioning here keeps the intake flow
 * one-step.
 */
async function ensureDefaultCompany(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<{ id: string; name: string }> {
  return withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
    const existing = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM companies
         WHERE workspace_id = $1
         ORDER BY created_at ASC
         LIMIT 1`,
      [workspaceId],
    );
    if (existing.rows.length > 0) return existing.rows[0];

    const workspaceRow = await client.query<{ name: string }>(
      `SELECT name FROM workspaces WHERE id = $1 LIMIT 1`,
      [workspaceId],
    );
    const workspaceName = workspaceRow.rows[0]?.name ?? "Untitled workspace";
    const id = randomUUID();
    await client.query(
      `INSERT INTO companies (id, workspace_id, name)
         VALUES ($1, $2, $3)`,
      [id, workspaceId, workspaceName],
    );
    return { id, name: workspaceName };
  });
}

async function loadMissionScopedToWorkspace(
  pool: Pool,
  missionId: string,
  workspaceId: string,
): Promise<MissionRow | null> {
  const result = await withWorkspaceContext(
    pool,
    { workspaceId, userId: "mission-route" },
    async (client) =>
      client.query<MissionRow>(
        `SELECT m.id, m.company_id, m.statement, c.workspace_id, c.name AS company_name
           FROM missions m
           JOIN companies c ON c.id = m.company_id
          WHERE m.id = $1
          LIMIT 1`,
        [missionId],
      ),
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/**
 * Builds a teamAssembly request from a mission. The mission carries only
 * the goal statement; the rest of the normalizedGoalDocument is filled
 * with defensible defaults that signal "we don't know this yet" rather
 * than fabricating numbers the LLM might anchor on.
 */
function teamAssemblyRequestFromMission(mission: MissionRow): TeamAssemblyRequest {
  return {
    companyName: mission.company_name ?? undefined,
    normalizedGoalDocument: {
      sourceType: "free_text",
      goal: mission.statement,
      targetCustomer: null,
      successMetrics: [],
      constraints: [],
      budget: null,
      timeHorizon: null,
      planReadinessThreshold: 0.6,
    },
    roleLibrary: [...DEFAULT_ROLE_LIBRARY],
  };
}

async function persistHiringPlanDraft(
  pool: Pool,
  workspaceId: string,
  missionId: string,
  draft: TeamAssemblyResult,
): Promise<string> {
  const id = randomUUID();
  await withWorkspaceContext(
    pool,
    { workspaceId, userId: "mission-route" },
    async (client) =>
      client.query(
        `INSERT INTO hiring_plans (id, mission_id, draft)
            VALUES ($1, $2, $3::jsonb)`,
        [id, missionId, JSON.stringify(draft)],
      ),
  );
  return id;
}

export interface CreateMissionRoutesOptions {
  /**
   * Optional rate-limit middleware applied only to LLM-heavy routes
   * (today: POST /:missionId/generate-plan, which calls a model to
   * draft a hiring plan). Passed in so app.ts owns the shared budget
   * across every LLM-touching endpoint instead of duplicating it
   * here. When omitted, no per-router limiter is applied — safe for
   * tests that don't want a shared quota.
   *
   * Critically, this is NOT applied to the GET handlers — those are
   * cheap database reads that the dashboard polls on every page load
   * (Hire, MissionState, Home). Pre-fix the blanket router-level
   * llmEndpointRateLimiter on /api/missions caused 10/hour LLM cap
   * to block dashboard list reads too, surfacing as "Too Many
   * Requests" on /mission-state, /hire's "Past missions" pane, etc.
   */
  llmRouteLimiter?: import("express").RequestHandler;
}

export function createMissionRoutes(
  pool: Pool,
  options: CreateMissionRoutesOptions = {},
) {
  const router = Router();
  const llmRouteLimiter = options.llmRouteLimiter;

  // ---------------------------------------------------------------------
  // POST /api/missions — create a mission (HEL-23)
  // ---------------------------------------------------------------------
  router.post("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const body = req.body as { statement?: unknown; metadata?: unknown };
    const rawStatement =
      typeof body?.statement === "string" ? body.statement.trim() : "";
    if (!rawStatement) {
      res.status(400).json({ error: "Mission statement is required" });
      return;
    }
    if (rawStatement.length > MAX_STATEMENT_LENGTH) {
      res.status(400).json({
        error: `Mission statement is too long (max ${MAX_STATEMENT_LENGTH} characters)`,
      });
      return;
    }
    const metadata = sanitizeMetadata(body?.metadata);

    // missions.created_by_user_id FKs into user_profiles(user_id). The
    // profile row is only created when the user explicitly saves Profile
    // Settings, so OAuth-only users hit a FK violation here on their
    // first mission. Auto-provision an empty profile (display_name NULL,
    // timezone 'UTC' default) so the insert below succeeds; the user can
    // fill the profile in later via PATCH /api/profile.
    try {
      await ensureUserProfileExists(userId);
    } catch (err) {
      console.error(`[missions] ensureUserProfileExists failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to provision user profile" });
      return;
    }

    let company: { id: string; name: string };
    try {
      company = await ensureDefaultCompany(pool, workspaceId, userId);
    } catch (err) {
      console.error(`[missions] ensureDefaultCompany failed: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: { route: "POST /api/missions", phase: "ensureDefaultCompany" },
        contexts: { mission: { workspaceId, userId } },
      });
      res.status(500).json({ error: "Failed to resolve workspace company" });
      return;
    }

    const missionId = randomUUID();
    try {
      await withWorkspaceContext(pool, { workspaceId, userId }, async (client) =>
        client.query(
          `INSERT INTO missions (id, company_id, statement, status, created_by_user_id, metadata)
             VALUES ($1, $2, $3, 'draft', $4, $5::jsonb)`,
          [missionId, company.id, rawStatement, userId, JSON.stringify(metadata)],
        ),
      );
    } catch (err) {
      console.error(`[missions] insert failed: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: { route: "POST /api/missions", phase: "insert" },
        contexts: { mission: { workspaceId, userId, missionId, companyId: company.id } },
      });
      res.status(500).json({ error: "Failed to create mission" });
      return;
    }

    res.status(201).json({
      id: missionId,
      statement: rawStatement,
      status: "draft",
      metadata,
      createdAt: new Date().toISOString(),
      companyId: company.id,
      companyName: company.name,
      latestHiringPlanId: null,
    } satisfies MissionListItem);
  });

  // ---------------------------------------------------------------------
  // GET /api/missions — list this workspace's missions (HEL-23)
  // ---------------------------------------------------------------------
  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    interface ListRow {
      id: string;
      statement: string;
      status: string;
      metadata: MissionMetadata;
      created_at: Date | string;
      company_id: string;
      company_name: string;
      latest_hiring_plan_id: string | null;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<ListRow>(
            `SELECT m.id, m.statement, m.status, m.metadata, m.created_at,
                    m.company_id, c.name AS company_name,
                    (
                      SELECT hp.id FROM hiring_plans hp
                       WHERE hp.mission_id = m.id
                       ORDER BY hp.created_at DESC
                       LIMIT 1
                    ) AS latest_hiring_plan_id
               FROM missions m
               JOIN companies c ON c.id = m.company_id
              WHERE c.workspace_id = $1
              ORDER BY m.created_at DESC
              LIMIT 100`,
            [workspaceId],
          ),
      );
      res.json({
        missions: result.rows.map<MissionListItem>((row) => ({
          id: row.id,
          statement: row.statement,
          status: row.status,
          metadata: row.metadata ?? {},
          createdAt:
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : String(row.created_at),
          companyId: row.company_id,
          companyName: row.company_name,
          latestHiringPlanId: row.latest_hiring_plan_id,
        })),
      });
    } catch (err) {
      console.error(`[missions] list failed: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: { route: "GET /api/missions", phase: "list" },
        contexts: { mission: { workspaceId, userId } },
      });
      res.status(500).json({ error: "Failed to list missions" });
    }
  });

  // ---------------------------------------------------------------------
  // GET /api/missions/:missionId — single mission lookup (HEL-23)
  // ---------------------------------------------------------------------
  router.get("/:missionId", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const missionId = req.params.missionId;
    if (!missionId || !UUID_RE.test(missionId)) {
      res.status(400).json({ error: "Invalid mission ID format" });
      return;
    }

    interface DetailRow {
      id: string;
      statement: string;
      status: string;
      metadata: MissionMetadata;
      created_at: Date | string;
      company_id: string;
      company_name: string;
      latest_hiring_plan_id: string | null;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<DetailRow>(
            `SELECT m.id, m.statement, m.status, m.metadata, m.created_at,
                    m.company_id, c.name AS company_name,
                    (
                      SELECT hp.id FROM hiring_plans hp
                       WHERE hp.mission_id = m.id
                       ORDER BY hp.created_at DESC
                       LIMIT 1
                    ) AS latest_hiring_plan_id
               FROM missions m
               JOIN companies c ON c.id = m.company_id
              WHERE m.id = $1 AND c.workspace_id = $2
              LIMIT 1`,
            [missionId, workspaceId],
          ),
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Mission not found" });
        return;
      }
      const row = result.rows[0];
      res.json({
        id: row.id,
        statement: row.statement,
        status: row.status,
        metadata: row.metadata ?? {},
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        companyId: row.company_id,
        companyName: row.company_name,
        latestHiringPlanId: row.latest_hiring_plan_id,
      } satisfies MissionListItem);
    } catch (err) {
      console.error(`[missions] get failed: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: { route: "GET /api/missions/:missionId", phase: "get" },
        contexts: { mission: { workspaceId, userId, missionId } },
      });
      res.status(500).json({ error: "Failed to load mission" });
    }
  });

  // ---------------------------------------------------------------------
  // DELETE /api/missions/:missionId — discard a mission + any drafts
  //
  // Semantics:
  //   - Draft hiring_plans (accepted_by_user_id IS NULL) cascade away
  //     via the FK on hiring_plans.mission_id (ON DELETE CASCADE in
  //     migration 022).
  //   - If ANY hiring_plan for this mission was confirmed
  //     (accepted_by_user_id IS NOT NULL), we refuse with 409 — those
  //     plans provisioned agents + org_edges and need a dedicated
  //     "retire team" flow (Wave 1.5 / future PR) before the parent
  //     mission can be safely removed.
  //   - Returns 204 on success (no body) so the dashboard just refreshes
  //     the list.
  // ---------------------------------------------------------------------
  router.delete("/:missionId", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const missionId = req.params.missionId;
    if (!missionId || !UUID_RE.test(missionId)) {
      res.status(400).json({ error: "Invalid mission ID format" });
      return;
    }

    try {
      await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        // Confirm the mission belongs to this workspace before the
        // delete fires, so a 404 surfaces cleanly instead of a silent
        // no-op (DELETE … WHERE returns rowcount 0 either way).
        const own = await client.query<{ id: string }>(
          `SELECT m.id
             FROM missions m
             JOIN companies c ON c.id = m.company_id
            WHERE m.id = $1 AND c.workspace_id = $2
            LIMIT 1`,
          [missionId, workspaceId],
        );
        if (own.rows.length === 0) {
          // Use a sentinel value the outer caller maps to 404.
          throw Object.assign(new Error("Mission not found"), { code: "NOT_FOUND" });
        }

        // Guard against blowing away a confirmed plan's parent. The
        // dedicated "retire team" flow lives in a later wave.
        const confirmed = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM hiring_plans
            WHERE mission_id = $1
              AND accepted_by_user_id IS NOT NULL`,
          [missionId],
        );
        if (Number(confirmed.rows[0]?.count ?? "0") > 0) {
          throw Object.assign(
            new Error(
              "This mission has a confirmed hiring plan and active agents — retire the team before deleting the mission.",
            ),
            { code: "CONFIRMED_PLAN_EXISTS" },
          );
        }

        // Draft hiring_plans drop via FK ON DELETE CASCADE.
        await client.query(
          `DELETE FROM missions WHERE id = $1`,
          [missionId],
        );
      });
      res.status(204).end();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "NOT_FOUND") {
        res.status(404).json({ error: "Mission not found" });
        return;
      }
      if (code === "CONFIRMED_PLAN_EXISTS") {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      console.error(`[missions] delete failed: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: { route: "DELETE /api/missions/:missionId", phase: "delete" },
        contexts: { mission: { workspaceId, userId, missionId } },
      });
      res.status(500).json({ error: "Failed to delete mission" });
    }
  });

  const generatePlanMiddleware: import("express").RequestHandler[] = llmRouteLimiter
    ? [llmRouteLimiter]
    : [];
  router.post("/:missionId/generate-plan", ...generatePlanMiddleware, async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as AuthenticatedRequest & { workspace?: { id: string } }).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const missionId = req.params.missionId;
    if (!missionId || !UUID_RE.test(missionId)) {
      res.status(400).json({ error: "Invalid mission ID format" });
      return;
    }

    let mission: MissionRow | null;
    try {
      mission = await loadMissionScopedToWorkspace(pool, missionId, workspaceId);
    } catch (err) {
      console.error(`[missions] mission lookup failed: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: { route: "POST /api/missions/:missionId/generate-plan", phase: "lookup" },
        contexts: { mission: { workspaceId, userId, missionId } },
      });
      res.status(500).json({ error: "Mission lookup failed" });
      return;
    }
    if (!mission) {
      res.status(404).json({ error: "Mission not found" });
      return;
    }

    const resolved = await llmConfigStore.getDecryptedDefault(userId);
    if (!resolved) {
      res.status(422).json({
        error: "No LLM provider configured. Go to Settings > LLM Providers to connect one.",
      });
      return;
    }

    const assemblyModel = resolveModelForTier(resolved.config.provider, "power");
    const provider = getProvider({
      provider: resolved.config.provider,
      model: assemblyModel,
      apiKey: resolved.apiKey,
      // Ask the provider for native JSON-mode output. The team-assembly
      // prompt was the original trigger for the Mistral "Sure! Here's
      // the plan:\n```json\n…```" 502 — switching to json_object mode
      // forces clean JSON on every provider that supports it (OpenAI,
      // Anthropic via forced tool-use, Mistral, Gemini, Groq, Fireworks,
      // Together, xAI, DeepSeek, Perplexity, Ollama, LocalAI, OpenCode
      // Zen). Providers without native mode (Bedrock, Vertex AI, Cohere)
      // ignore the hint; the Tier 1 chatty-tolerant extractor catches
      // their output downstream. The full zod schema still validates the
      // shape after extraction, so type-safety is preserved.
      responseFormat: { type: "json_object" },
    });

    const request = teamAssemblyRequestFromMission(mission);
    // HEL-74: wrap the LLM call so we can capture wall time + token usage
    // and emit a step_results row regardless of parse success/failure.
    let rawText: string;
    let promptTokens = 0;
    let completionTokens = 0;
    const llmStartedAtMs = Date.now();
    try {
      const llmResponse = await provider(buildTeamAssemblyPrompt(request));
      rawText = llmResponse.text;
      promptTokens = llmResponse.usage?.promptTokens ?? 0;
      completionTokens = llmResponse.usage?.completionTokens ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // HEL-74: record the failed-LLM-call step_result so the budget +
      // observability surfaces see the attempt + cost (likely zero on
      // hard provider errors, non-zero if the provider charges for
      // partial work).
      void recordHiringPlanCost({
        pool,
        workspaceId,
        userId,
        missionId,
        hiringPlanId: "(none)",
        costCents: 0,
        durationMs: Date.now() - llmStartedAtMs,
        status: "failure",
        errorMessage: msg,
        rateMatched: false,
        promptTokens: 0,
        completionTokens: 0,
        provider: resolved.config.provider,
        model: assemblyModel,
      });
      console.error(
        `[missions] LLM call failed (${resolved.config.provider}/${assemblyModel}): ${msg}`,
      );
      Sentry.captureException(err, {
        tags: {
          route: "POST /api/missions/:missionId/generate-plan",
          phase: "llm_call",
          provider: resolved.config.provider,
          model: assemblyModel,
        },
        contexts: { mission: { workspaceId, userId, missionId } },
      });
      // Surface provider + model in the user-facing error so they can
      // self-diagnose (e.g. "model not found" → switch tier in Settings).
      res.status(502).json({
        error: `LLM call failed (${resolved.config.provider}/${assemblyModel}): ${msg}`,
        provider: resolved.config.provider,
        model: assemblyModel,
      });
      return;
    }
    const llmDurationMs = Date.now() - llmStartedAtMs;

    let plan: TeamAssemblyResult;
    try {
      plan = parseTeamAssemblyResponse(rawText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[missions] plan parse failed: ${msg}`);
      Sentry.captureException(err, {
        tags: {
          route: "POST /api/missions/:missionId/generate-plan",
          phase: "parse",
          provider: resolved.config.provider,
          model: assemblyModel,
        },
        contexts: {
          mission: { workspaceId, userId, missionId },
          // First 500 chars of the model's output so we can see what
          // the parser tripped on without dumping the full response.
          llm_response: { excerpt: rawText.slice(0, 500) },
        },
      });
      res.status(502).json({
        error: `Plan parse failed (${resolved.config.provider}/${assemblyModel}): ${msg}`,
        provider: resolved.config.provider,
        model: assemblyModel,
      });
      return;
    }

    let hiringPlanId: string;
    try {
      hiringPlanId = await persistHiringPlanDraft(pool, workspaceId, missionId, plan);
    } catch (err) {
      console.error(`[missions] hiring plan persist failed: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: {
          route: "POST /api/missions/:missionId/generate-plan",
          phase: "persist",
        },
        contexts: { mission: { workspaceId, userId, missionId } },
      });
      res.status(500).json({ error: "Failed to persist hiring plan" });
      return;
    }

    // HEL-74: compute cost from token usage + record a successful
    // step_results row so the Budget page + observability surfaces see
    // the generation. Write is fire-and-forget; failure is logged but
    // never breaks the user response.
    const costResult = computeHiringPlanCostCents({
      provider: resolved.config.provider,
      model: assemblyModel,
      promptTokens,
      completionTokens,
    });
    void recordHiringPlanCost({
      pool,
      workspaceId,
      userId,
      missionId,
      hiringPlanId,
      costCents: costResult.costCents,
      durationMs: llmDurationMs,
      status: "success",
      rateMatched: costResult.matched,
      promptTokens,
      completionTokens,
      provider: resolved.config.provider,
      model: assemblyModel,
    });

    res.json({
      hiringPlanId,
      missionId,
      schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
      plan,
      costCents: costResult.costCents,
    });
  });

  return router;
}
