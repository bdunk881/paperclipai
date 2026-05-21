/**
 * Mission team expansion routes:
 *   POST /api/missions/:missionId/add-report — provision one report under a manager
 *   POST /api/missions/:missionId/retire-team — terminate mission agents so delete can proceed
 */

import type { IRouter } from "express";
import type { Pool, PoolClient } from "pg";
import * as Sentry from "@sentry/node";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { DEFAULT_ROLE_LIBRARY } from "../goals/teamAssembly";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  assertAgentCapForConfirm,
  buildStarterJobDescriptionBody,
  emitActivityEvent,
  ensureWorkspaceTeam,
  insertAgent,
  insertStarterJobDescription,
  libraryEntryToRecommendation,
  seedDefaultRoutineForAgent,
} from "./hiringPlanRoutes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MissionScopeRow {
  mission_id: string;
  company_id: string;
  workspace_id: string;
  status: string;
  latest_hiring_plan_id: string | null;
  plan_accepted_at: Date | string | null;
  team_name: string | null;
}

async function loadMissionScope(
  client: PoolClient,
  missionId: string,
  workspaceId: string,
): Promise<MissionScopeRow | null> {
  const result = await client.query<MissionScopeRow>(
    `SELECT m.id AS mission_id,
            m.company_id,
            c.workspace_id,
            m.status,
            (
              SELECT hp.id
                FROM hiring_plans hp
               WHERE hp.mission_id = m.id
               ORDER BY hp.created_at DESC
               LIMIT 1
            ) AS latest_hiring_plan_id,
            (
              SELECT hp.accepted_at
                FROM hiring_plans hp
               WHERE hp.mission_id = m.id
                 AND hp.accepted_at IS NOT NULL
               ORDER BY hp.accepted_at DESC
               LIMIT 1
            ) AS plan_accepted_at,
            (
              SELECT hp.draft->'provisioningPlan'->>'teamName'
                FROM hiring_plans hp
               WHERE hp.mission_id = m.id
                 AND hp.accepted_at IS NOT NULL
               ORDER BY hp.accepted_at DESC
               LIMIT 1
            ) AS team_name
       FROM missions m
       JOIN companies c ON c.id = m.company_id
      WHERE m.id = $1 AND c.workspace_id = $2
      LIMIT 1`,
    [missionId, workspaceId],
  );
  return result.rows[0] ?? null;
}

function agentBelongsToMission(
  agent: { company_id: string; metadata: unknown; status: string },
  scope: MissionScopeRow,
): boolean {
  if (agent.status === "terminated") return false;
  const meta =
    agent.metadata && typeof agent.metadata === "object"
      ? (agent.metadata as Record<string, unknown>)
      : {};
  const taggedMissionId = meta.missionId;
  if (typeof taggedMissionId === "string" && taggedMissionId === scope.mission_id) {
    return true;
  }
  return agent.company_id === scope.company_id;
}

async function listMissionAgentIds(
  client: PoolClient,
  workspaceId: string,
  scope: MissionScopeRow,
): Promise<string[]> {
  const result = await client.query<{
    id: string;
    company_id: string;
    metadata: unknown;
    status: string;
  }>(
    `SELECT id, company_id, metadata, status
       FROM agents
      WHERE workspace_id = $1
        AND status <> 'terminated'`,
    [workspaceId],
  );
  return result.rows
    .filter((row) => agentBelongsToMission(row, scope))
    .map((row) => row.id);
}

export function registerMissionTeamRoutes(router: IRouter, pool: Pool): void {
  router.post(
    "/:missionId/add-report",
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

      const body = req.body as { managerAgentId?: unknown; roleKey?: unknown };
      const managerAgentId =
        typeof body.managerAgentId === "string" ? body.managerAgentId.trim() : "";
      const roleKey = typeof body.roleKey === "string" ? body.roleKey.trim() : "";
      if (!managerAgentId || !UUID_RE.test(managerAgentId)) {
        res.status(400).json({ error: "managerAgentId is required" });
        return;
      }
      if (!roleKey) {
        res.status(400).json({ error: "roleKey is required" });
        return;
      }

      const libraryEntry = DEFAULT_ROLE_LIBRARY.find((r) => r.roleKey === roleKey);
      if (!libraryEntry) {
        res.status(400).json({ error: `Unknown role key: ${roleKey}` });
        return;
      }

      const capViolation = await assertAgentCapForConfirm(pool, workspaceId, 1);
      if (capViolation) {
        res.status(capViolation.status).json(capViolation.body);
        return;
      }

      let defaultProvider: "openai" | "anthropic" | null = null;
      try {
        const resolved = await llmConfigStore.getDecryptedDefault(userId);
        if (
          resolved &&
          (resolved.config.provider === "openai" || resolved.config.provider === "anthropic")
        ) {
          defaultProvider = resolved.config.provider;
        }
      } catch {
        // non-fatal
      }

      try {
        const payload = await withWorkspaceContext(
          pool,
          { workspaceId, userId },
          async (client) => {
            const scope = await loadMissionScope(client, missionId, workspaceId);
            if (!scope) return { notFound: true as const };
            if (!scope.plan_accepted_at) {
              return {
                needsConfirm: true as const,
                hiringPlanId: scope.latest_hiring_plan_id,
              };
            }

            const managerRow = await client.query<{
              id: string;
              role_key: string | null;
              company_id: string;
              metadata: unknown;
              status: string;
              team_id: string | null;
            }>(
              `SELECT id, role_key, company_id, metadata, status, team_id
                 FROM agents
                WHERE id = $1 AND workspace_id = $2
                LIMIT 1`,
              [managerAgentId, workspaceId],
            );
            const manager = managerRow.rows[0];
            if (!manager || !agentBelongsToMission(manager, scope)) {
              return { badManager: true as const };
            }

            const existingRole = await client.query<{ id: string }>(
              `SELECT id FROM agents
                WHERE workspace_id = $1
                  AND role_key = $2
                  AND status <> 'terminated'
                  AND (
                    metadata->>'missionId' = $3
                    OR company_id = $4::uuid
                  )
                LIMIT 1`,
              [workspaceId, roleKey, missionId, scope.company_id],
            );
            if (existingRole.rows.length > 0) {
              return { duplicateRole: true as const, roleKey };
            }

            const hiringPlanId = scope.latest_hiring_plan_id ?? missionId;
            const teamId = await ensureWorkspaceTeam(
              client,
              workspaceId,
              userId,
              scope.company_id,
              scope.team_name ?? "Mission team",
            );

            const recommendation = libraryEntryToRecommendation(libraryEntry, new Set([manager.role_key ?? ""]));
            const { id: agentId, model } = await insertAgent(
              client,
              {
                workspaceId,
                userId,
                teamId,
                companyId: scope.company_id,
                missionId,
                hiringPlanId,
                roleKey: recommendation.roleKey,
                name: recommendation.title,
                modelTier: recommendation.modelTier,
                budgetMonthlyUsd: recommendation.budgetMonthlyUsd ?? 0,
                skills: recommendation.skills,
                mandate: recommendation.mandate,
              },
              defaultProvider,
            );

            await client.query(
              `INSERT INTO org_edges (workspace_id, manager_agent_id, agent_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (manager_agent_id, agent_id) DO NOTHING`,
              [workspaceId, managerAgentId, agentId],
            );
            await client.query(
              `UPDATE agents SET reporting_to_agent_id = $1 WHERE id = $2`,
              [managerAgentId, agentId],
            );

            const starterBody = buildStarterJobDescriptionBody({
              title: recommendation.title,
              mandate: recommendation.mandate,
              justification: recommendation.justification,
              kpis: recommendation.kpis,
              tools: recommendation.tools,
              budgetMonthlyUsd: recommendation.budgetMonthlyUsd,
            });
            await client.query("SAVEPOINT starter_jd");
            try {
              await insertStarterJobDescription(client, {
                workspaceId,
                userId,
                agentId,
                agentTitle: recommendation.title,
                body: starterBody,
              });
              await client.query("RELEASE SAVEPOINT starter_jd");
            } catch (jdErr) {
              await client.query("ROLLBACK TO SAVEPOINT starter_jd");
              Sentry.captureException(jdErr);
            }

            await client.query("SAVEPOINT starter_routine");
            try {
              await seedDefaultRoutineForAgent(client, {
                workspaceId,
                agentId,
                agentName: recommendation.title,
                mandate: recommendation.mandate,
                modelTier: recommendation.modelTier,
              });
              await client.query("RELEASE SAVEPOINT starter_routine");
            } catch (routineErr) {
              await client.query("ROLLBACK TO SAVEPOINT starter_routine");
              Sentry.captureException(routineErr);
            }

            await emitActivityEvent(
              client,
              workspaceId,
              "agent_provisioned",
              userId,
              { type: "agent", id: agentId, label: recommendation.title },
              {
                roleKey: recommendation.roleKey,
                modelTier: recommendation.modelTier,
                managerAgentId,
                missionId,
                source: "add_report",
              },
            );

            return {
              ok: true as const,
              agent: {
                id: agentId,
                name: recommendation.title,
                roleKey: recommendation.roleKey,
                model,
                managerAgentId,
              },
            };
          },
        );

        if ("notFound" in payload && payload.notFound) {
          res.status(404).json({ error: "Mission not found" });
          return;
        }
        if ("needsConfirm" in payload && payload.needsConfirm) {
          res.status(409).json({
            error: "Confirm your hiring plan before adding reports to the live team.",
            hiringPlanId: payload.hiringPlanId,
          });
          return;
        }
        if ("badManager" in payload && payload.badManager) {
          res.status(400).json({ error: "Manager agent not found for this mission" });
          return;
        }
        if ("duplicateRole" in payload && payload.duplicateRole) {
          res.status(409).json({
            error: `An agent with role "${payload.roleKey}" already exists on this mission team.`,
          });
          return;
        }

        res.status(201).json(payload);
      } catch (err) {
        console.error(`[missions] add-report failed: ${(err as Error).message}`);
        Sentry.captureException(err, {
          tags: { route: "POST /api/missions/:missionId/add-report" },
        });
        res.status(500).json({ error: "Failed to add report" });
      }
    }),
  );

  router.post(
    "/:missionId/retire-team",
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
            const scope = await loadMissionScope(client, missionId, workspaceId);
            if (!scope) return { notFound: true as const };

            const agentIds = await listMissionAgentIds(client, workspaceId, scope);
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
              `UPDATE missions SET status = 'archived' WHERE id = $1`,
              [missionId],
            );

            await emitActivityEvent(
              client,
              workspaceId,
              "mission_team_retired",
              userId,
              { type: "mission", id: missionId },
              { agentCount: agentIds.length },
            );

            return { ok: true as const, retiredAgentCount: agentIds.length };
          },
        );

        if ("notFound" in result && result.notFound) {
          res.status(404).json({ error: "Mission not found" });
          return;
        }

        res.status(200).json(result);
      } catch (err) {
        console.error(`[missions] retire-team failed: ${(err as Error).message}`);
        Sentry.captureException(err, {
          tags: { route: "POST /api/missions/:missionId/retire-team" },
        });
        res.status(500).json({ error: "Failed to retire team" });
      }
    }),
  );
}
