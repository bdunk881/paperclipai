import { Router } from "express";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

interface StepResultRow {
  id: string;
  run_id: string;
  step_id: string;
  step_name: string;
  status: string;
  output: Record<string, unknown>;
  cost_cents: number;
  duration_ms: number;
  error: string | null;
  ordinal: number;
  created_at: string;
}

export function createStepResultRoutes(pool: Pool) {
  const router = Router({ mergeParams: true });

  router.get("/", async (req: AuthenticatedRequest, res) => {
    const userId = req.auth?.sub;
    const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
    const { runId } = req.params as { runId: string };

    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    try {
      const rows = await withWorkspaceContext(
        pool,
        { workspaceId, userId },
        async (client) => {
          // Verify the run belongs to this workspace before listing its steps.
          const runCheck = await client.query<{ id: string }>(
            `SELECT id FROM runs WHERE id = $1 AND workspace_id = $2`,
            [runId, workspaceId],
          );
          if (runCheck.rowCount === 0) {
            return null;
          }
          const result = await client.query<StepResultRow>(
            `SELECT id, run_id, step_id, step_name, status, output,
                    cost_cents, duration_ms, error, ordinal, created_at
               FROM step_results
              WHERE run_id = $1
              ORDER BY ordinal`,
            [runId],
          );
          return result.rows;
        },
      );

      if (rows === null) {
        res.status(404).json({ error: `Run not found: ${runId}` });
        return;
      }

      res.json({
        runId,
        stepResults: rows.map((r) => ({
          id: r.id,
          runId: r.run_id,
          stepId: r.step_id,
          stepName: r.step_name,
          status: r.status,
          output: r.output,
          costCents: r.cost_cents,
          durationMs: r.duration_ms,
          error: r.error,
          ordinal: r.ordinal,
          createdAt: r.created_at,
        })),
        total: rows.length,
      });
    } catch (err) {
      console.error(`[step-results] query failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load step results" });
    }
  });

  return router;
}
