import { Router } from "express";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

interface MissionRow {
  id: string;
  company_id: string;
  statement: string;
  status: string;
  created_at: string;
}

interface AgentRow {
  id: string;
  name: string;
  role_key: string;
  status: string;
  model: string | null;
  reporting_to_agent_id: string | null;
  company_id: string | null;
  skills: unknown;
  budget_monthly_usd: string;
}

interface OrgEdgeRow {
  id: string;
  manager_agent_id: string;
  agent_id: string;
  created_at: string;
}

export function createOrgGraphRoutes(pool: Pool) {
  const router = Router();

  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    try {
      const { missions, agents, orgEdges } = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          const [mRes, aRes, eRes] = await Promise.all([
            client.query<MissionRow>(
              `SELECT id, company_id, statement, status, created_at
                 FROM missions
                ORDER BY created_at DESC`,
            ),
            client.query<AgentRow>(
              `SELECT id, name, role_key, status, model,
                      reporting_to_agent_id, company_id,
                      skills, budget_monthly_usd
                 FROM agents
                WHERE workspace_id = $1
                ORDER BY name`,
              [workspaceId],
            ),
            client.query<OrgEdgeRow>(
              `SELECT id, manager_agent_id, agent_id, created_at
                 FROM org_edges
                WHERE workspace_id = $1`,
              [workspaceId],
            ),
          ]);
          return { missions: mRes.rows, agents: aRes.rows, orgEdges: eRes.rows };
        },
      );

      res.json({
        mission: missions[0] ?? null,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          roleKey: a.role_key,
          status: a.status,
          model: a.model,
          reportingToAgentId: a.reporting_to_agent_id,
          companyId: a.company_id,
          skills: a.skills,
          budgetMonthlyUsd: Number(a.budget_monthly_usd),
        })),
        orgEdges: orgEdges.map((e) => ({
          id: e.id,
          managerAgentId: e.manager_agent_id,
          agentId: e.agent_id,
          createdAt: e.created_at,
        })),
      });
    } catch (err) {
      console.error(`[org-graph] query failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load org graph" });
    }
  });

  return router;
}
