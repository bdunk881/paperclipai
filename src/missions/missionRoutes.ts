/**
 * Mission routes (HEL-23 + HEL-24 + HEL-25).
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
 *
 * GET /api/missions/:missionId/hiring-plans/:planId
 *   Read a single hiring plan draft. (HEL-25.)
 *
 * POST /api/missions/:missionId/hiring-plans/:planId/confirm
 *   Confirm a hiring plan: inserts agents + org_edges, marks the plan
 *   accepted, and emits activity_events. (HEL-25.)
 */

import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
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

export function createMissionRoutes(pool: Pool) {
  const router = Router();

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

    let company: { id: string; name: string };
    try {
      company = await ensureDefaultCompany(pool, workspaceId, userId);
    } catch (err) {
      console.error(`[missions] ensureDefaultCompany failed: ${(err as Error).message}`);
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
      res.status(500).json({ error: "Failed to load mission" });
    }
  });

  router.post("/:missionId/generate-plan", async (req: AuthenticatedRequest, res) => {
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
    });

    const request = teamAssemblyRequestFromMission(mission);
    let rawText: string;
    try {
      rawText = (await provider(buildTeamAssemblyPrompt(request))).text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `LLM call failed: ${msg}` });
      return;
    }

    let plan: TeamAssemblyResult;
    try {
      plan = parseTeamAssemblyResponse(rawText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[missions] plan parse failed: ${msg}`);
      res.status(502).json({ error: `Plan parse failed: ${msg}` });
      return;
    }

    let hiringPlanId: string;
    try {
      hiringPlanId = await persistHiringPlanDraft(pool, workspaceId, missionId, plan);
    } catch (err) {
      console.error(`[missions] hiring plan persist failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to persist hiring plan" });
      return;
    }

    res.json({
      hiringPlanId,
      missionId,
      schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
      plan,
    });
  });

  // ---------------------------------------------------------------------
  // GET /api/missions/:missionId/hiring-plans/:planId (HEL-25)
  // ---------------------------------------------------------------------
  router.get("/:missionId/hiring-plans/:planId", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const { missionId, planId } = req.params;
    if (!UUID_RE.test(missionId) || !UUID_RE.test(planId)) {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }

    interface PlanRow {
      id: string;
      mission_id: string;
      draft: TeamAssemblyResult;
      accepted_at: Date | string | null;
      accepted_by_user_id: string | null;
      created_at: Date | string;
      statement: string;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<PlanRow>(
            `SELECT hp.id, hp.mission_id, hp.draft, hp.accepted_at,
                    hp.accepted_by_user_id, hp.created_at, m.statement
               FROM hiring_plans hp
               JOIN missions m ON m.id = hp.mission_id
               JOIN companies c ON c.id = m.company_id
              WHERE hp.id = $1
                AND m.id = $2
                AND c.workspace_id = $3
              LIMIT 1`,
            [planId, missionId, workspaceId],
          ),
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Hiring plan not found" });
        return;
      }
      const row = result.rows[0];
      res.json({
        id: row.id,
        missionId: row.mission_id,
        missionStatement: row.statement,
        plan: row.draft,
        acceptedAt: row.accepted_at
          ? row.accepted_at instanceof Date
            ? row.accepted_at.toISOString()
            : String(row.accepted_at)
          : null,
        acceptedByUserId: row.accepted_by_user_id,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
      });
    } catch (err) {
      console.error(`[missions] get hiring plan failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load hiring plan" });
    }
  });

  // ---------------------------------------------------------------------
  // POST /api/missions/:missionId/hiring-plans/:planId/confirm (HEL-25)
  //
  // Idempotent: if already accepted returns 200 with the existing agent list.
  // ---------------------------------------------------------------------
  router.post("/:missionId/hiring-plans/:planId/confirm", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const { missionId, planId } = req.params;
    if (!UUID_RE.test(missionId) || !UUID_RE.test(planId)) {
      res.status(400).json({ error: "Invalid ID format" });
      return;
    }

    interface HiringPlanRow {
      id: string;
      mission_id: string;
      draft: TeamAssemblyResult;
      accepted_at: Date | string | null;
      company_id: string;
      mission_statement: string;
    }

    let planRow: HiringPlanRow;
    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<HiringPlanRow>(
            `SELECT hp.id, hp.mission_id, hp.draft, hp.accepted_at,
                    m.company_id, m.statement AS mission_statement
               FROM hiring_plans hp
               JOIN missions m ON m.id = hp.mission_id
               JOIN companies c ON c.id = m.company_id
              WHERE hp.id = $1
                AND m.id = $2
                AND c.workspace_id = $3
              LIMIT 1`,
            [planId, missionId, workspaceId],
          ),
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Hiring plan not found" });
        return;
      }
      planRow = result.rows[0];
    } catch (err) {
      console.error(`[missions] confirm plan lookup failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load hiring plan" });
      return;
    }

    const draft = planRow.draft;
    if (!draft?.provisioningPlan?.agents?.length) {
      res.status(422).json({ error: "Hiring plan has no agents to provision" });
      return;
    }

    // Already confirmed — idempotent return.
    if (planRow.accepted_at) {
      res.json({ alreadyConfirmed: true, planId, missionId });
      return;
    }

    interface ProvisionedAgent {
      id: string;
      roleKey: string;
      name: string;
      modelTier: string;
      budgetMonthlyUsd: number | null;
    }
    const provisionedAgents: ProvisionedAgent[] = [];

    try {
      await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const teamId = await ensureAgentTeam(
          client,
          workspaceId,
          userId,
          planRow.company_id,
          draft.provisioningPlan.teamName,
        );

        const roleKeyToAgentId = new Map<string, string>();

        for (const agentSpec of draft.provisioningPlan.agents) {
          const agentId = randomUUID();
          await client.query(
            `INSERT INTO agents (
               id, workspace_id, user_id, team_id, name, role_key, model,
               budget_monthly_usd, skills, company_id, status
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'active')`,
            [
              agentId,
              workspaceId,
              userId,
              teamId,
              agentSpec.title,
              agentSpec.roleKey,
              agentSpec.modelTier,
              agentSpec.budgetMonthlyUsd ?? 0,
              JSON.stringify(agentSpec.skills ?? []),
              planRow.company_id,
            ],
          );
          roleKeyToAgentId.set(agentSpec.roleKey, agentId);
          provisionedAgents.push({
            id: agentId,
            roleKey: agentSpec.roleKey,
            name: agentSpec.title,
            modelTier: agentSpec.modelTier,
            budgetMonthlyUsd: agentSpec.budgetMonthlyUsd,
          });
        }

        for (const line of (draft.orgChart?.reportingLines ?? [])) {
          const managerAgentId = roleKeyToAgentId.get(line.managerRoleKey);
          const reportAgentId = roleKeyToAgentId.get(line.reportRoleKey);
          if (!managerAgentId || !reportAgentId) continue;
          await client.query(
            `INSERT INTO org_edges (workspace_id, manager_agent_id, agent_id)
             VALUES ($1,$2,$3)
             ON CONFLICT (manager_agent_id, agent_id) DO NOTHING`,
            [workspaceId, managerAgentId, reportAgentId],
          );
        }

        await client.query(
          `UPDATE hiring_plans
              SET accepted_at = now(), accepted_by_user_id = $1
            WHERE id = $2`,
          [userId, planId],
        );

        const actorJson = JSON.stringify({ type: "user", id: userId });
        const planSubjectJson = JSON.stringify({
          type: "hiring_plan",
          id: planId,
          label: draft.provisioningPlan.teamName,
        });

        await client.query(
          `INSERT INTO activity_events
             (workspace_id, kind, actor, subject, payload)
           VALUES ($1,'hiring_plan_accepted',$2::jsonb,$3::jsonb,$4::jsonb)`,
          [
            workspaceId,
            actorJson,
            planSubjectJson,
            JSON.stringify({ missionId, planId }),
          ],
        );

        for (const agent of provisionedAgents) {
          await client.query(
            `INSERT INTO activity_events
               (workspace_id, kind, actor, subject, payload)
             VALUES ($1,'agent_provisioned',$2::jsonb,$3::jsonb,$4::jsonb)`,
            [
              workspaceId,
              actorJson,
              JSON.stringify({ type: "agent", id: agent.id, label: agent.name }),
              JSON.stringify({ roleKey: agent.roleKey, modelTier: agent.modelTier }),
            ],
          );
        }
      });
    } catch (err) {
      console.error(`[missions] confirm plan failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to confirm hiring plan" });
      return;
    }

    res.json({ confirmed: true, planId, missionId, agents: provisionedAgents });
  });

  return router;
}

/**
 * Find or create the agent_team for this workspace+company that will own
 * the hiring-plan provisioned agents. Uses continuous_agents deployment mode
 * to match the hiring plan's intent.
 */
async function ensureAgentTeam(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  companyId: string,
  teamName: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM agent_teams
      WHERE workspace_id = $1 AND company_id = $2
      ORDER BY created_at ASC LIMIT 1`,
    [workspaceId, companyId],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const teamId = randomUUID();
  await client.query(
    `INSERT INTO agent_teams (
       id, workspace_id, user_id, company_id, name,
       deployment_mode, status, budget_monthly_usd,
       tool_budget_ceilings, alert_thresholds
     ) VALUES ($1,$2,$3,$4,$5,'continuous_agents','active',0,'{}','[0.8,0.9,1]'::jsonb)`,
    [teamId, workspaceId, userId, companyId, teamName],
  );
  return teamId;
}
