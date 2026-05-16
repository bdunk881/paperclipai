import { Router } from "express";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

interface EntitlementRow {
  workspace_id: string;
  runs_per_month: number;
  agent_cap: number;
  integration_cap: number;
  byok_allowed: boolean;
  log_retention_days: number;
  approval_tier_max: number;
  plan: string;
  updated_at: string;
}

export function createEntitlementRoutes(pool: Pool) {
  const router = Router();

  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    try {
      const row = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          const result = await client.query<EntitlementRow>(
            `SELECT workspace_id, runs_per_month, agent_cap, integration_cap,
                    byok_allowed, log_retention_days, approval_tier_max, plan, updated_at
               FROM entitlements
              WHERE workspace_id = $1`,
            [workspaceId],
          );
          return result.rows[0] ?? null;
        },
      );

      if (!row) {
        res.json({
          workspaceId,
          plan: "explore",
          runsPerMonth: 25,
          agentCap: 1,
          integrationCap: 1,
          byokAllowed: false,
          logRetentionDays: 14,
          approvalTierMax: 0,
          updatedAt: null,
        });
        return;
      }

      res.json({
        workspaceId: row.workspace_id,
        plan: row.plan,
        runsPerMonth: row.runs_per_month,
        agentCap: row.agent_cap,
        integrationCap: row.integration_cap,
        byokAllowed: row.byok_allowed,
        logRetentionDays: row.log_retention_days,
        approvalTierMax: row.approval_tier_max,
        updatedAt: row.updated_at,
      });
    } catch (err) {
      console.error(`[entitlements] query failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load entitlements" });
    }
  });

  return router;
}
