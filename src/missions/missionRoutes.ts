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
  parseTeamAssemblyResponse,
  TEAM_ASSEMBLY_SCHEMA_VERSION,
  type TeamAssemblyRequest,
  type TeamAssemblyResult,
} from "../goals/teamAssembly";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { getProvider } from "../engine/llmProviders";
import { listConnectorHealth } from "../connectors/health";
import { computeHiringPlanCostCents } from "./hiringPlanCost";
import { recordHiringPlanCost } from "./hiringPlanCostWriter";
import { ensureUserProfileExists } from "../user/profileStore";
import { asyncHandler } from "../middleware/asyncHandler";
import { registerMissionTeamRoutes } from "./missionTeamRoutes";
import {
  attachDefaultSelection,
  type HiringPlanDraft,
} from "./hiringPlanDraft";
import { resolveHiringPlanLlm } from "./resolveHiringPlanLlm";

/** Abuse guard — missions.statement is unbounded text in Postgres. */
const MAX_STATEMENT_LENGTH = 50_000;

export interface MissionRow {
  id: string;
  company_id: string;
  statement: string;
  workspace_id: string;
  company_name: string | null;
  company_description: string | null;
  metadata: MissionMetadata | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * HEL-211 — owner-defined free-form context pills surfaced on the Hire page
 * alongside the four canonical fields. Each entry is serialised into the
 * team-assembly prompt as `${label}: ${value}` after the canonical
 * fields so the LLM has the same weight of signal.
 */
export interface MissionCustomContextEntry {
  label: string;
  value: string;
}

export interface MissionMetadata {
  industry?: string;
  targetCustomer?: string;
  successMetric?: string;
  runway?: string;
  customContext?: MissionCustomContextEntry[];
}

const MAX_CUSTOM_CONTEXT_ENTRIES = 12;
const MAX_CUSTOM_CONTEXT_LABEL_LENGTH = 64;

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

const MAX_METADATA_FIELD_LENGTH = 280;

function trimMetadataField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_METADATA_FIELD_LENGTH
    ? trimmed.slice(0, MAX_METADATA_FIELD_LENGTH)
    : trimmed;
}

function trimCustomContextLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_CUSTOM_CONTEXT_LABEL_LENGTH
    ? trimmed.slice(0, MAX_CUSTOM_CONTEXT_LABEL_LENGTH)
    : trimmed;
}

/**
 * HEL-211 — coerce arbitrary input into a vetted list of owner-defined
 * context entries. Drops entries with an empty label *or* value (both
 * halves are load-bearing for the prompt template) and caps the list
 * length so a malicious / runaway client can't blow up the prompt.
 */
function sanitizeCustomContext(input: unknown): MissionCustomContextEntry[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const entries: MissionCustomContextEntry[] = [];
  for (const raw of input) {
    if (entries.length >= MAX_CUSTOM_CONTEXT_ENTRIES) break;
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;
    const label = trimCustomContextLabel(candidate.label);
    const value = trimMetadataField(candidate.value);
    if (!label || !value) continue;
    entries.push({ label, value });
  }
  return entries.length > 0 ? entries : undefined;
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
  const customContext = sanitizeCustomContext(raw.customContext);
  if (customContext) out.customContext = customContext;
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
        `SELECT m.id, m.company_id, m.statement, m.metadata,
                c.workspace_id, c.name AS company_name,
                c.description AS company_description
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
 * Builds a teamAssembly request from a mission row.
 *
 * Wires through the structured fields the mission-intake form captures
 * (industry, target customer, success metric, runway) plus the company's
 * own description so the LLM has actual company-specific signal — not
 * just a one-line goal + the generic role library.
 *
 * Mission generate-plan does not inject DEFAULT_ROLE_LIBRARY; the model
 * should design roles from the goal. Other callers may pass a library
 * explicitly when they want vocabulary reference material.
 */
export function teamAssemblyRequestFromMission(
  mission: MissionRow,
  connectedToolSlugs: string[] = [],
): TeamAssemblyRequest {
  const metadata = sanitizeMetadata(mission.metadata);

  const constraints: string[] = [];
  if (metadata.industry) constraints.push(`Industry: ${metadata.industry}`);

  const summaryLines: string[] = [];
  if (mission.company_name) summaryLines.push(`Company: ${mission.company_name}`);
  if (mission.company_description) {
    summaryLines.push(`About the company: ${mission.company_description}`);
  }
  if (metadata.industry) summaryLines.push(`Industry: ${metadata.industry}`);
  if (metadata.targetCustomer) {
    summaryLines.push(`Target customer: ${metadata.targetCustomer}`);
  }
  if (metadata.successMetric) {
    summaryLines.push(`Success metric: ${metadata.successMetric}`);
  }
  if (metadata.runway) summaryLines.push(`Budget / runway: ${metadata.runway}`);
  // HEL-211: serialise the owner-defined free-form pills after the
  // canonical fields. Same `${label}: ${value}` shape so the LLM
  // treats them with the same weight as the structured prompts.
  if (metadata.customContext && metadata.customContext.length > 0) {
    for (const entry of metadata.customContext) {
      summaryLines.push(`${entry.label}: ${entry.value}`);
    }
  }

  return {
    companyName: mission.company_name ?? undefined,
    normalizedGoalDocument: {
      sourceType: "free_text",
      goal: mission.statement,
      targetCustomer: metadata.targetCustomer ?? null,
      successMetrics: metadata.successMetric ? [metadata.successMetric] : [],
      constraints,
      budget: metadata.runway ?? null,
      timeHorizon: null,
      importedContextSummary: summaryLines.length > 0 ? summaryLines.join("\n") : null,
      planReadinessThreshold: 0.6,
    },
    roleLibrary: [],
    connectedToolSlugs,
  };
}

async function persistHiringPlanDraft(
  pool: Pool,
  workspaceId: string,
  missionId: string,
  draft: HiringPlanDraft,
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
  router.post("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
  }));

  // ---------------------------------------------------------------------
  // GET /api/missions — list this workspace's missions (HEL-23)
  // ---------------------------------------------------------------------
  router.get("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
  }));

  // ---------------------------------------------------------------------
  // GET /api/missions/:missionId — single mission lookup (HEL-23)
  // ---------------------------------------------------------------------
  router.get("/:missionId", asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
  }));

  // ---------------------------------------------------------------------
  // PATCH /api/missions/:missionId — edit a draft mission's brief (HEL-192)
  //
  // Semantics:
  //   - Only `statement` and `metadata` are editable. Both are optional;
  //     at least one must be present.
  //   - Only `status='draft'` missions accept edits. Once a hiring plan
  //     has been confirmed (status moves past draft), the brief is
  //     immutable. The dashboard should hide the edit affordance there.
  //   - Returns the updated MissionListItem so the dashboard can replace
  //     the row in place without a refetch.
  // ---------------------------------------------------------------------
  router.patch("/:missionId", asyncHandler<AuthenticatedRequest>(async (req, res) => {
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

    const body = req.body as { statement?: unknown; metadata?: unknown };
    const hasStatement = body?.statement !== undefined;
    const hasMetadata = body?.metadata !== undefined;
    if (!hasStatement && !hasMetadata) {
      res.status(400).json({
        error: "At least one of `statement` or `metadata` must be provided",
      });
      return;
    }

    let nextStatement: string | undefined;
    if (hasStatement) {
      if (typeof body.statement !== "string") {
        res.status(400).json({ error: "Mission statement must be a string" });
        return;
      }
      nextStatement = body.statement.trim();
      if (!nextStatement) {
        res.status(400).json({ error: "Mission statement is required" });
        return;
      }
      if (nextStatement.length > MAX_STATEMENT_LENGTH) {
        res.status(400).json({
          error: `Mission statement is too long (max ${MAX_STATEMENT_LENGTH} characters)`,
        });
        return;
      }
    }

    const nextMetadata = hasMetadata ? sanitizeMetadata(body.metadata) : undefined;

    interface UpdatedRow {
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
        async (client) => {
          // Confirm ownership + status='draft' before the UPDATE so the
          // error surfaces as 404 (wrong workspace) vs 409 (not draft)
          // rather than a silent no-op.
          const existing = await client.query<{ status: string }>(
            `SELECT m.status
               FROM missions m
               JOIN companies c ON c.id = m.company_id
              WHERE m.id = $1 AND c.workspace_id = $2
              LIMIT 1`,
            [missionId, workspaceId],
          );
          if (existing.rows.length === 0) {
            throw Object.assign(new Error("Mission not found"), { code: "NOT_FOUND" });
          }
          if (existing.rows[0].status !== "draft") {
            throw Object.assign(
              new Error(
                "Only draft missions can be edited. Withdraw the hiring plan first.",
              ),
              { code: "NOT_DRAFT" },
            );
          }

          // Build a partial UPDATE so we only touch the columns the
          // caller asked to change.
          const sets: string[] = [];
          const args: unknown[] = [];
          if (nextStatement !== undefined) {
            args.push(nextStatement);
            sets.push(`statement = $${args.length}`);
          }
          if (nextMetadata !== undefined) {
            args.push(JSON.stringify(nextMetadata));
            sets.push(`metadata = $${args.length}::jsonb`);
          }
          args.push(missionId);
          const missionIdIdx = args.length;

          await client.query(
            `UPDATE missions
                SET ${sets.join(", ")}
              WHERE id = $${missionIdIdx}`,
            args,
          );

          return client.query<UpdatedRow>(
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
              WHERE m.id = $1
              LIMIT 1`,
            [missionId],
          );
        },
      );

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
      const code = (err as { code?: string } | null)?.code;
      if (code === "NOT_FOUND") {
        res.status(404).json({ error: "Mission not found" });
        return;
      }
      if (code === "NOT_DRAFT") {
        res.status(409).json({ error: (err as Error).message });
        return;
      }
      console.error(`[missions] patch failed: ${(err as Error).message}`);
      Sentry.captureException(err, {
        tags: { route: "PATCH /api/missions/:missionId", phase: "patch" },
        contexts: { mission: { workspaceId, userId, missionId } },
      });
      res.status(500).json({ error: "Failed to update mission" });
    }
  }));

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
  router.delete("/:missionId", asyncHandler<AuthenticatedRequest>(async (req, res) => {
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

        const missionStatus = await client.query<{ status: string }>(
          `SELECT status FROM missions WHERE id = $1 LIMIT 1`,
          [missionId],
        );
        const status = missionStatus.rows[0]?.status ?? "";

        // Guard against deleting a live team. After retire-team the mission
        // is archived and agents are terminated — delete is allowed.
        if (status !== "archived") {
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
  }));

  const generatePlanMiddleware: import("express").RequestHandler[] = llmRouteLimiter
    ? [llmRouteLimiter]
    : [];
  router.post("/:missionId/generate-plan", ...generatePlanMiddleware, asyncHandler<AuthenticatedRequest>(async (req, res) => {
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

    const body = req.body as { llmConfigId?: unknown };
    const requestedLlmConfigId =
      typeof body?.llmConfigId === "string" && body.llmConfigId.trim().length > 0
        ? body.llmConfigId.trim()
        : undefined;

    const llmChoice = await resolveHiringPlanLlm(userId, requestedLlmConfigId);
    if (!llmChoice) {
      res.status(422).json({
        error: requestedLlmConfigId
          ? "LLM configuration not found or unavailable. Choose a connected model in Settings."
          : "No LLM provider configured. Go to Settings > LLM Providers to connect one.",
      });
      return;
    }

    const { resolved, llmConfigId, assemblyModel } = llmChoice;
    const provider = getProvider({
      provider: resolved.config.provider,
      model: assemblyModel,
      apiKey: resolved.apiKey,
      responseFormat: { type: "json_object" },
      maxOutputTokens: 8192,
    });

    let connectedToolSlugs: string[] = [];
    try {
      const health = await listConnectorHealth(userId);
      connectedToolSlugs = health
        .filter((record) => record.state === "healthy")
        .map((record) => record.connectorKey);
    } catch {
      connectedToolSlugs = [];
    }

    const request = teamAssemblyRequestFromMission(mission, connectedToolSlugs);
    // HEL-74: wrap the LLM call so we can capture wall time + token usage
    // and emit a step_results row regardless of parse success/failure.
    //
    // DASH-31: explicit per-call provider/model/tokens log so we can
    // answer "which provider actually generated this plan?" from a
    // single grep instead of digging through step_results. Surfaced
    // both in Fly logs and Sentry breadcrumbs (via console-logging
    // integration). Useful for: confirming the workspace's expected
    // BYOK provider is being hit, catching provider misroutes, and
    // proving plans aren't stale-cached.
    let rawText: string;
    let promptTokens = 0;
    let completionTokens = 0;
    const llmStartedAtMs = Date.now();
    console.log(
      `[missions] LLM call dispatching for hiring plan: provider=${resolved.config.provider} model=${assemblyModel} userId=${userId} missionId=${missionId}`,
    );
    try {
      const llmResponse = await provider(buildTeamAssemblyPrompt(request));
      rawText = llmResponse.text;
      promptTokens = llmResponse.usage?.promptTokens ?? 0;
      completionTokens = llmResponse.usage?.completionTokens ?? 0;
      console.log(
        `[missions] LLM call succeeded: provider=${resolved.config.provider} model=${assemblyModel} promptTokens=${promptTokens} completionTokens=${completionTokens} durationMs=${Date.now() - llmStartedAtMs} responseChars=${rawText.length}`,
      );
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
      const userError = buildHiringPlanUserError(msg, "llm_call");
      console.error(
        `[missions] LLM call failed (${resolved.config.provider}/${assemblyModel}) [ref=${userError.reference}]: ${msg}`,
      );
      Sentry.captureException(err, {
        tags: {
          route: "POST /api/missions/:missionId/generate-plan",
          phase: "llm_call",
          provider: resolved.config.provider,
          model: assemblyModel,
          reference: userError.reference,
        },
        contexts: { mission: { workspaceId, userId, missionId } },
      });
      res.status(502).json(userError);
      return;
    }
    const llmDurationMs = Date.now() - llmStartedAtMs;

    let plan: HiringPlanDraft;
    try {
      const parsed = parseTeamAssemblyResponse(rawText);
      plan = attachDefaultSelection(parsed);
      plan.generationMeta = {
        provider: resolved.config.provider,
        model: assemblyModel,
        llmConfigId,
      };
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
      provider: resolved.config.provider,
      model: assemblyModel,
      llmConfigId,
      promptTokens,
      completionTokens,
    });
  }));

  // ---------------------------------------------------------------------
  // POST /api/missions/:missionId/complete — HEL-210
  //
  // Flags a mission as complete without tearing the team down. Optional
  // `note` is appended to `missions.metadata.completionNote`. Returns
  // 409 if the mission is already in a terminal state.
  // ---------------------------------------------------------------------
  router.post(
    "/:missionId/complete",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
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

      const body = req.body as { note?: unknown };
      const note =
        typeof body?.note === "string" && body.note.trim().length > 0
          ? body.note.trim().slice(0, 2000)
          : null;

      try {
        const result = await withWorkspaceContext(
          pool,
          { workspaceId, userId },
          async (client) => {
            const existing = await client.query<{
              status: string;
              metadata: MissionMetadata | null;
            }>(
              `SELECT m.status, m.metadata
                 FROM missions m
                 JOIN companies c ON c.id = m.company_id
                WHERE m.id = $1 AND c.workspace_id = $2
                LIMIT 1`,
              [missionId, workspaceId],
            );
            if (existing.rows.length === 0) {
              throw Object.assign(new Error("Mission not found"), { code: "NOT_FOUND" });
            }
            const current = existing.rows[0];
            if (current.status === "completed" || current.status === "archived") {
              throw Object.assign(
                new Error("Mission already terminal."),
                { code: "ALREADY_TERMINAL" },
              );
            }
            const nextMetadata: Record<string, unknown> = {
              ...(current.metadata ?? {}),
            };
            if (note) nextMetadata.completionNote = note;
            nextMetadata.completedAt = new Date().toISOString();
            const updated = await client.query<{
              status: string;
              completed_at: string;
            }>(
              `UPDATE missions
                  SET status = 'completed',
                      metadata = $1::jsonb
                WHERE id = $2
                RETURNING status, (metadata->>'completedAt') AS completed_at`,
              [JSON.stringify(nextMetadata), missionId],
            );
            return updated.rows[0];
          },
        );
        res.status(200).json({
          id: missionId,
          status: result.status,
          completedAt: result.completed_at,
        });
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "NOT_FOUND") {
          res.status(404).json({ error: "Mission not found" });
          return;
        }
        if (code === "ALREADY_TERMINAL") {
          res.status(409).json({ error: (err as Error).message });
          return;
        }
        console.error(`[missions] complete failed: ${(err as Error).message}`);
        Sentry.captureException(err, {
          tags: { route: "POST /api/missions/:missionId/complete" },
          contexts: { mission: { workspaceId, userId, missionId } },
        });
        res.status(500).json({ error: "Failed to complete mission" });
      }
    }),
  );

  // ---------------------------------------------------------------------
  // POST /api/missions/:missionId/stop — HEL-210
  //
  // Terminates open assignments + archives the mission. Idempotent.
  // ---------------------------------------------------------------------
  router.post(
    "/:missionId/stop",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
        const result = await withWorkspaceContext(
          pool,
          { workspaceId, userId },
          async (client) => {
            const own = await client.query<{ id: string; company_id: string }>(
              `SELECT m.id, m.company_id
                 FROM missions m
                 JOIN companies c ON c.id = m.company_id
                WHERE m.id = $1 AND c.workspace_id = $2
                LIMIT 1`,
              [missionId, workspaceId],
            );
            if (own.rows.length === 0) {
              throw Object.assign(new Error("Mission not found"), { code: "NOT_FOUND" });
            }
            const companyId = own.rows[0].company_id;
            const agentRows = await client.query<{
              id: string;
              metadata: unknown;
              company_id: string;
              status: string;
            }>(
              `SELECT id, metadata, company_id, status
                 FROM agents
                WHERE workspace_id = $1
                  AND status <> 'terminated'`,
              [workspaceId],
            );
            const agentIds = agentRows.rows
              .filter((row) => {
                if (row.status === "terminated") return false;
                const meta =
                  row.metadata && typeof row.metadata === "object"
                    ? (row.metadata as Record<string, unknown>)
                    : {};
                if (meta.missionId === missionId) return true;
                return row.company_id === companyId;
              })
              .map((row) => row.id);

            if (agentIds.length > 0) {
              await client.query(
                `UPDATE agents
                    SET status = 'terminated', updated_at = NOW()
                  WHERE id = ANY($1::uuid[])`,
                [agentIds],
              );
              await client.query(
                `DELETE FROM org_edges
                  WHERE workspace_id = $1
                    AND (manager_agent_id = ANY($2::uuid[]) OR agent_id = ANY($2::uuid[]))`,
                [workspaceId, agentIds],
              );
              await client.query(
                `UPDATE agents
                    SET reporting_to_agent_id = NULL
                  WHERE id = ANY($1::uuid[])`,
                [agentIds],
              );
            }

            await client.query(
              `UPDATE missions SET status = 'stopped' WHERE id = $1`,
              [missionId],
            );

            return { terminatedAgentCount: agentIds.length };
          },
        );

        res.status(200).json({
          id: missionId,
          status: "stopped",
          terminatedAgentCount: result.terminatedAgentCount,
        });
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "NOT_FOUND") {
          res.status(404).json({ error: "Mission not found" });
          return;
        }
        console.error(`[missions] stop failed: ${(err as Error).message}`);
        Sentry.captureException(err, {
          tags: { route: "POST /api/missions/:missionId/stop" },
          contexts: { mission: { workspaceId, userId, missionId } },
        });
        res.status(500).json({ error: "Failed to stop mission" });
      }
    }),
  );

  registerMissionTeamRoutes(router, pool);

  // -------------------------------------------------------------------------
  // HEL-214 / PR J scaffold — POST /api/missions/:missionId/team-assembly/sandbox
  //
  // TODO: HEL-214 wire real implementation. Pro Mode's MissionPromptEditor
  // re-runs team assembly with a hand-edited prompt; today we return a
  // synthetic plan so the UI flow is reviewable.
  // -------------------------------------------------------------------------
  router.post(
    "/:missionId/team-assembly/sandbox",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const body = (req.body ?? {}) as { prompt?: unknown };
      const prompt =
        typeof body.prompt === "string" ? body.prompt : "<no prompt>";
      res.status(200).json({
        missionId: req.params.missionId,
        echoedPrompt: prompt,
        plan: {
          roles: [
            { roleKey: "founder", title: "Founder", reportsTo: null },
            { roleKey: "marketing_lead", title: "Marketing Lead", reportsTo: "founder" },
            { roleKey: "growth_associate", title: "Growth Associate", reportsTo: "marketing_lead" },
          ],
          rationale: "Scaffold plan. Real implementation arrives in a follow-up.",
        },
      });
    }),
  );

  return router;
}
