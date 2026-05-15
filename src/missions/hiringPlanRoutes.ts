/**
 * Hiring plan routes (HEL-25).
 *
 * POST /api/hiring-plans/:hiringPlanId/confirm
 *   Atomically provision the agents the LLM drafted in this hiring plan:
 *
 *     1. Load the plan + parent mission, scoped to the active workspace.
 *     2. Validate the plan isn't already accepted.
 *     3. Inside a single transaction:
 *        a. Insert one agent row per `plan.provisioningPlan.agents` entry.
 *        b. Insert one `org_edges` row per `plan.orgChart.reportingLines`,
 *           translating roleKey → agent_id via the map built in (a).
 *        c. Mark the `hiring_plans` row as accepted (`accepted_at`,
 *           `accepted_by_user_id`).
 *        d. Mark the `missions` row as `active` so the Team page knows
 *           there's a live org graph to render.
 *        e. Emit `activity_events`: one `hiring_plan_accepted` plus one
 *           `agent_provisioned` per agent.
 *     4. Return the provisioned agents + edges so the dashboard can route
 *        immediately to the Team page.
 *
 * Idempotency: a second confirm on an already-accepted plan returns 409
 * with the original `accepted_at` so the client can show the existing
 * org rather than failing.
 *
 * Reference: `Projects/AutoFlow/v2/pages.jsx::AF2_Team` for the org chart
 * the provisioned agents feed into (HEL-26).
 */

import { Router } from "express";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import {
  TEAM_ASSEMBLY_SCHEMA_VERSION,
  type TeamAssemblyResult,
} from "../goals/teamAssembly";
import { resolveModelForTier } from "../engine/llmRouter";
import { llmConfigStore } from "../llmConfig/llmConfigStore";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProvisionedAgentRow {
  id: string;
  roleKey: string;
  name: string;
  modelTier: "lite" | "standard" | "power";
  model: string | null;
  budgetMonthlyUsd: number;
  reportingToAgentId: string | null;
}

export interface ConfirmHiringPlanResponse {
  hiringPlanId: string;
  missionId: string;
  acceptedAt: string;
  agents: ProvisionedAgentRow[];
  orgEdges: Array<{ managerAgentId: string; agentId: string }>;
}

interface PlanLookupRow {
  hiring_plan_id: string;
  mission_id: string;
  company_id: string;
  workspace_id: string;
  draft: TeamAssemblyResult;
  accepted_at: Date | null;
}

/**
 * Loads the hiring plan + mission + company chain, scoped to the active
 * workspace via RLS. Returns null if the plan doesn't exist or the
 * requesting workspace doesn't own it (RLS will return zero rows).
 */
async function loadHiringPlanScopedToWorkspace(
  pool: Pool,
  hiringPlanId: string,
  workspaceId: string,
  userId: string,
): Promise<PlanLookupRow | null> {
  const result = await withWorkspaceContext(
    pool,
    { workspaceId, userId },
    async (client) =>
      client.query<PlanLookupRow>(
        `SELECT hp.id AS hiring_plan_id,
                hp.mission_id,
                hp.draft,
                hp.accepted_at,
                m.company_id,
                c.workspace_id
           FROM hiring_plans hp
           JOIN missions m ON m.id = hp.mission_id
           JOIN companies c ON c.id = m.company_id
          WHERE hp.id = $1
          LIMIT 1`,
        [hiringPlanId],
      ),
  );
  return result.rows[0] ?? null;
}

/**
 * Get-or-create the default `teams` row this workspace uses for newly
 * provisioned canonical agents. The legacy `agents.team_id` column is
 * still NOT NULL (predates HEL-13 canonical model), so we create one
 * team-per-workspace on first confirm and reuse it forever.
 *
 * Named after `provisioningPlan.teamName` from the plan draft on first
 * create; subsequent confirms reuse the same row regardless of plan name.
 */
async function ensureWorkspaceTeam(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  companyId: string,
  teamName: string,
): Promise<string> {
  // Reuse an existing team if one exists for this workspace.
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM teams WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [workspaceId],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const teamId = randomUUID();
  await client.query(
    `INSERT INTO teams (id, workspace_id, user_id, company_id, name, deployment_mode, status)
       VALUES ($1, $2, $3, $4, $5, 'continuous_agents', 'active')`,
    [teamId, workspaceId, userId, companyId, teamName],
  );
  return teamId;
}

interface AgentInsertParams {
  workspaceId: string;
  userId: string;
  teamId: string;
  companyId: string;
  roleKey: string;
  name: string;
  modelTier: "lite" | "standard" | "power";
  budgetMonthlyUsd: number;
  skills: string[];
  mandate: string;
}

async function insertAgent(
  client: PoolClient,
  params: AgentInsertParams,
  defaultProvider: "openai" | "anthropic" | null,
): Promise<{ id: string; model: string | null }> {
  const id = randomUUID();
  // Resolve the model only if a workspace default LLM is configured.
  // Without a provider context we can't decode model name from tier — leave
  // null so the engine picks it up at run-time via the workspace's default
  // LLM config (same path the runner already uses for unassigned agents).
  const model = defaultProvider ? resolveModelForTier(defaultProvider, params.modelTier) : null;

  await client.query(
    `INSERT INTO agents (
       id, workspace_id, user_id, team_id, company_id,
       name, role_key, model, instructions, budget_monthly_usd,
       skills, schedule, status
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11::jsonb, '{"type":"manual"}'::jsonb, 'active'
     )`,
    [
      id,
      params.workspaceId,
      params.userId,
      params.teamId,
      params.companyId,
      params.name,
      params.roleKey,
      model,
      params.mandate,
      params.budgetMonthlyUsd,
      JSON.stringify(params.skills),
    ],
  );
  return { id, model };
}

async function emitActivityEvent(
  client: PoolClient,
  workspaceId: string,
  kind: string,
  actorUserId: string,
  subject: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO activity_events (workspace_id, kind, actor, subject, payload)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
    [
      workspaceId,
      kind,
      JSON.stringify({ type: "user", id: actorUserId }),
      JSON.stringify(subject),
      JSON.stringify(payload),
    ],
  );
}

export function createHiringPlanRoutes(pool: Pool) {
  const router = Router();

  // HEL-105: side-by-side review needs to read the plan + mission context
  // in one call. Returns the draft TeamAssemblyResult under `plan`, plus the
  // mission statement / acceptance state so the review page can show
  // "already confirmed" without a second roundtrip.
  router.get("/:hiringPlanId", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const hiringPlanId = req.params.hiringPlanId;
    if (!hiringPlanId || !UUID_RE.test(hiringPlanId)) {
      res.status(400).json({ error: "Invalid hiring plan ID format" });
      return;
    }

    interface PlanDetailRow {
      id: string;
      mission_id: string;
      mission_statement: string;
      draft: TeamAssemblyResult;
      accepted_at: Date | string | null;
      accepted_by_user_id: string | null;
      created_at: Date | string;
    }

    try {
      const result = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) =>
          client.query<PlanDetailRow>(
            `SELECT hp.id, hp.mission_id, m.statement AS mission_statement,
                    hp.draft, hp.accepted_at, hp.accepted_by_user_id, hp.created_at
               FROM hiring_plans hp
               JOIN missions m ON m.id = hp.mission_id
               JOIN companies c ON c.id = m.company_id
              WHERE hp.id = $1
              LIMIT 1`,
            [hiringPlanId],
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
        missionStatement: row.mission_statement,
        plan: row.draft,
        acceptedAt:
          row.accepted_at instanceof Date
            ? row.accepted_at.toISOString()
            : row.accepted_at,
        acceptedByUserId: row.accepted_by_user_id,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
      });
    } catch (err) {
      console.error(`[hiring-plans] get failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load hiring plan" });
    }
  });

  router.post("/:hiringPlanId/confirm", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const hiringPlanId = req.params.hiringPlanId;
    if (!hiringPlanId || !UUID_RE.test(hiringPlanId)) {
      res.status(400).json({ error: "Invalid hiring plan ID format" });
      return;
    }

    let lookup: PlanLookupRow | null;
    try {
      lookup = await loadHiringPlanScopedToWorkspace(pool, hiringPlanId, workspaceId, userId);
    } catch (err) {
      console.error(`[hiring-plans] lookup failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load hiring plan" });
      return;
    }
    if (!lookup) {
      res.status(404).json({ error: "Hiring plan not found" });
      return;
    }

    if (lookup.accepted_at) {
      res.status(409).json({
        error: "Hiring plan already accepted",
        acceptedAt:
          lookup.accepted_at instanceof Date
            ? lookup.accepted_at.toISOString()
            : String(lookup.accepted_at),
      });
      return;
    }

    // Schema sanity check: the draft must be a TeamAssemblyResult matching
    // the schema version this code knows how to provision. A mismatch is a
    // 422 because the user can re-generate the plan rather than retry-retry.
    const draft = lookup.draft;
    if (!draft || draft.schemaVersion !== TEAM_ASSEMBLY_SCHEMA_VERSION) {
      res.status(422).json({
        error: `Hiring plan schema version mismatch (got ${
          draft?.schemaVersion ?? "missing"
        }, expected ${TEAM_ASSEMBLY_SCHEMA_VERSION}). Re-generate the plan.`,
      });
      return;
    }

    // Resolve the workspace's default LLM provider so we can pick a model
    // name per agent's tier. If no provider is configured, agents land with
    // model=null and the engine will use the workspace default at run-time.
    let defaultProvider: "openai" | "anthropic" | null = null;
    try {
      const resolved = await llmConfigStore.getDecryptedDefault(userId);
      if (resolved && (resolved.config.provider === "openai" || resolved.config.provider === "anthropic")) {
        defaultProvider = resolved.config.provider;
      }
    } catch {
      // Non-fatal — fall through with null. Agents are still provisionable.
    }

    let response: ConfirmHiringPlanResponse;
    try {
      response = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          await client.query("BEGIN");

          try {
            // Re-check inside the transaction to avoid the two-confirm race.
            const recheck = await client.query<{ accepted_at: Date | null }>(
              `SELECT accepted_at FROM hiring_plans WHERE id = $1 FOR UPDATE`,
              [hiringPlanId],
            );
            if (recheck.rows[0]?.accepted_at) {
              throw new Error(
                `__already_accepted:${
                  recheck.rows[0].accepted_at instanceof Date
                    ? recheck.rows[0].accepted_at.toISOString()
                    : String(recheck.rows[0].accepted_at)
                }`,
              );
            }

            const teamId = await ensureWorkspaceTeam(
              client,
              workspaceId,
              userId,
              lookup!.company_id,
              draft.provisioningPlan.teamName,
            );

            // 1. Insert agents, build roleKey → agentId map.
            const agentRows: ProvisionedAgentRow[] = [];
            const roleKeyToAgentId = new Map<string, string>();
            for (const agent of draft.provisioningPlan.agents) {
              const { id, model } = await insertAgent(
                client,
                {
                  workspaceId,
                  userId,
                  teamId,
                  companyId: lookup!.company_id,
                  roleKey: agent.roleKey,
                  name: agent.title,
                  modelTier: agent.modelTier,
                  budgetMonthlyUsd: agent.budgetMonthlyUsd ?? 0,
                  skills: agent.skills,
                  mandate: agent.mandate,
                },
                defaultProvider,
              );
              roleKeyToAgentId.set(agent.roleKey, id);
              agentRows.push({
                id,
                roleKey: agent.roleKey,
                name: agent.title,
                modelTier: agent.modelTier,
                model,
                budgetMonthlyUsd: agent.budgetMonthlyUsd ?? 0,
                reportingToAgentId: null,
              });
            }

            // 2. Insert org_edges from reportingLines.
            const orgEdges: Array<{ managerAgentId: string; agentId: string }> = [];
            for (const edge of draft.orgChart.reportingLines) {
              const managerAgentId = roleKeyToAgentId.get(edge.managerRoleKey);
              const reportAgentId = roleKeyToAgentId.get(edge.reportRoleKey);
              if (!managerAgentId || !reportAgentId) {
                // The plan references a role the provisioning step didn't
                // emit. Skip rather than fail — the missing edge is a
                // recoverable issue (user can fix the plan + reprovision).
                continue;
              }
              if (managerAgentId === reportAgentId) {
                // Self-loop guard mirrored from the db CHECK constraint.
                continue;
              }
              await client.query(
                `INSERT INTO org_edges (workspace_id, manager_agent_id, agent_id)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (manager_agent_id, agent_id) DO NOTHING`,
                [workspaceId, managerAgentId, reportAgentId],
              );
              orgEdges.push({ managerAgentId, agentId: reportAgentId });

              // Also update the legacy agents.reporting_to_agent_id for the
              // simple parent-pointer query path the existing dashboard uses.
              await client.query(
                `UPDATE agents SET reporting_to_agent_id = $1 WHERE id = $2`,
                [managerAgentId, reportAgentId],
              );
              const row = agentRows.find((r) => r.id === reportAgentId);
              if (row) row.reportingToAgentId = managerAgentId;
            }

            // 3. Mark the hiring plan accepted.
            const accept = await client.query<{ accepted_at: Date }>(
              `UPDATE hiring_plans
                  SET accepted_at = now(),
                      accepted_by_user_id = $2
                WHERE id = $1
                RETURNING accepted_at`,
              [hiringPlanId, userId],
            );
            const acceptedAt =
              accept.rows[0]?.accepted_at instanceof Date
                ? accept.rows[0].accepted_at.toISOString()
                : String(accept.rows[0]?.accepted_at);

            // 4. Mark the parent mission active.
            await client.query(
              `UPDATE missions SET status = 'active' WHERE id = $1 AND status <> 'active'`,
              [lookup!.mission_id],
            );

            // 5. Emit activity events.
            await emitActivityEvent(
              client,
              workspaceId,
              "hiring_plan_accepted",
              userId,
              { type: "hiring_plan", id: hiringPlanId, missionId: lookup!.mission_id },
              { agentCount: agentRows.length, edgeCount: orgEdges.length },
            );
            for (const agent of agentRows) {
              await emitActivityEvent(
                client,
                workspaceId,
                "agent_provisioned",
                userId,
                { type: "agent", id: agent.id, label: agent.name },
                {
                  roleKey: agent.roleKey,
                  modelTier: agent.modelTier,
                  budgetMonthlyUsd: agent.budgetMonthlyUsd,
                  hiringPlanId,
                },
              );
            }

            await client.query("COMMIT");

            return {
              hiringPlanId,
              missionId: lookup!.mission_id,
              acceptedAt,
              agents: agentRows,
              orgEdges,
            } satisfies ConfirmHiringPlanResponse;
          } catch (err) {
            try {
              await client.query("ROLLBACK");
            } catch {
              // Swallow ROLLBACK errors so the original cause surfaces.
            }
            throw err;
          }
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("__already_accepted:")) {
        const acceptedAt = message.split(":")[1];
        res.status(409).json({ error: "Hiring plan already accepted", acceptedAt });
        return;
      }
      console.error(`[hiring-plans] confirm failed: ${message}`);
      res.status(500).json({ error: "Failed to confirm hiring plan" });
      return;
    }

    res.status(200).json(response);
  });

  return router;
}
