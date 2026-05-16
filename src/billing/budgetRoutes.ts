import { Router } from "express";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

interface BudgetRow {
  id: string;
  workspace_id: string;
  scope_kind: string;
  scope_id: string | null;
  cap_cents: number;
  period: string;
  used_cents: number;
  created_at: string;
  updated_at: string;
}

export function createBudgetRoutes(pool: Pool) {
  const router = Router();

  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    try {
      const rows = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          const result = await client.query<BudgetRow>(
            `SELECT id, workspace_id, scope_kind, scope_id,
                    cap_cents, period, used_cents, created_at, updated_at
               FROM budgets
              WHERE workspace_id = $1
              ORDER BY scope_kind, period`,
            [workspaceId],
          );
          return result.rows;
        },
      );

      res.json({
        budgets: rows.map((b) => ({
          id: b.id,
          workspaceId: b.workspace_id,
          scopeKind: b.scope_kind,
          scopeId: b.scope_id,
          capCents: b.cap_cents,
          period: b.period,
          usedCents: b.used_cents,
          createdAt: b.created_at,
          updatedAt: b.updated_at,
        })),
        total: rows.length,
      });
    } catch (err) {
      console.error(`[budgets] query failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load budgets" });
    }
  });

  return router;
}
