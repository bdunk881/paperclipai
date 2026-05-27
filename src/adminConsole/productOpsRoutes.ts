/**
 * Product-troubleshooting routes — activity timeline, re-fire a run step,
 * force integration refresh, clear a user's cache, set feature-flag override
 * for a workspace.
 *
 * Mounted under /api/admin-console/product-ops.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WorkflowEngineFacade {
  replayFromStep(
    runId: string,
    stepIndex: number,
    userId?: string,
    options?: { skipExecution?: boolean },
  ): Promise<{ id: string }>;
}

export interface ProductOpsRouteDeps {
  engine?: WorkflowEngineFacade;
}

async function getDefaultEngine(): Promise<WorkflowEngineFacade | null> {
  try {
    const mod = await import("../engine/WorkflowEngine");
    const Engine = (mod as { WorkflowEngine?: new () => WorkflowEngineFacade }).WorkflowEngine;
    if (!Engine) return null;
    return new Engine();
  } catch {
    return null;
  }
}

export function createProductOpsRoutes(_pool: Pool, deps: ProductOpsRouteDeps = {}): Router {
  const router = Router();

  // POST /runs/:runId/replay  — { from_step, dry_run, reason }
  router.post(
    "/runs/:runId/replay",
    asyncHandler(async (req, res) => {
      const runId = req.params.runId;
      if (!UUID_RE.test(runId)) return res.status(400).json({ error: "invalid run id" });
      const fromStep = Number(req.body?.from_step);
      const dryRun = req.body?.dry_run !== false; // default DRY-RUN
      const reason = String(req.body?.reason ?? "").trim();

      if (!Number.isInteger(fromStep) || fromStep <= 0) {
        return res.status(400).json({ error: "from_step must be a positive integer" });
      }
      if (!dryRun && !reason) {
        return res.status(400).json({ error: "reason required for live re-run" });
      }

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: dryRun ? "view_run_replay" : "execute_run_replay",
        reason: reason || "(dry run)",
        payload: { run_id: runId, from_step: fromStep, dry_run: dryRun },
        context: extractAuditContext(req),
      });

      const engine = deps.engine ?? (await getDefaultEngine());
      if (!engine) return res.status(503).json({ error: "WorkflowEngine not available" });

      const newRun = await engine.replayFromStep(runId, fromStep, undefined, {
        skipExecution: dryRun,
      });
      return res.json({ run: newRun, dry_run: dryRun });
    }),
  );

  // POST /workspaces/:workspaceId/feature-overrides  — { flag, enabled, reason, expires_at? }
  router.post(
    "/workspaces/:workspaceId/feature-overrides",
    asyncHandler(async (req, res) => {
      const workspaceId = req.params.workspaceId;
      if (!UUID_RE.test(workspaceId)) return res.status(400).json({ error: "invalid workspace id" });

      const flag = String(req.body?.flag ?? "").trim();
      const enabled = req.body?.enabled === true;
      const reason = String(req.body?.reason ?? "").trim();
      const expiresAt = req.body?.expires_at ? String(req.body.expires_at) : null;
      if (!/^[a-zA-Z0-9_:-]{1,64}$/.test(flag)) {
        return res.status(400).json({ error: "invalid flag" });
      }
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "set_feature_override",
        targetWorkspaceId: workspaceId,
        reason,
        payload: { flag, enabled, expires_at: expiresAt },
        context: extractAuditContext(req),
      });

      await client.query(
        `INSERT INTO workspace_feature_overrides
            (workspace_id, flag, enabled, set_by_admin_id, reason, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (workspace_id, flag)
          DO UPDATE SET enabled = EXCLUDED.enabled,
                        set_by_admin_id = EXCLUDED.set_by_admin_id,
                        reason = EXCLUDED.reason,
                        expires_at = EXCLUDED.expires_at,
                        created_at = now()`,
        [workspaceId, flag, enabled, admin, reason, expiresAt],
      );

      return res.json({ ok: true });
    }),
  );

  // DELETE /workspaces/:workspaceId/feature-overrides/:flag
  router.delete(
    "/workspaces/:workspaceId/feature-overrides/:flag",
    asyncHandler(async (req, res) => {
      const workspaceId = req.params.workspaceId;
      const flag = req.params.flag;
      if (!UUID_RE.test(workspaceId)) return res.status(400).json({ error: "invalid workspace id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "clear_feature_override",
        targetWorkspaceId: workspaceId,
        reason,
        payload: { flag },
        context: extractAuditContext(req),
      });

      const result = await client.query(
        "DELETE FROM workspace_feature_overrides WHERE workspace_id = $1 AND flag = $2",
        [workspaceId, flag],
      );
      return res.json({ removed: result.rowCount ?? 0 });
    }),
  );

  return router;
}
