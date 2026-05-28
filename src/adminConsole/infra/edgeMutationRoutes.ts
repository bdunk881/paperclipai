/**
 * Edge mutation routes for the Infrastructure dashboard (HEL infra PR #7).
 *
 * Every route runs under requireAuth + requirePlatformAdmin + requireAAL2,
 * writes an audit row BEFORE the side-effect, and consumes a rate-limit
 * bucket BEFORE the side-effect. Reason is required on every route.
 *
 * Mounted at /api/admin-console/infra/edge/actions.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAAL2 } from "../../middleware/requireAAL2";
import { recordAdminAction } from "../auditLog";
import { consumeRateLimit } from "../rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import {
  CloudflareClientError,
  getConfiguredCloudflareProjects,
  retryDeployment,
  rollbackDeployment,
} from "./clients/cloudflareClient";
import {
  GithubActionsClientError,
  cancelWorkflowRun,
  rerunWorkflowRun,
} from "./clients/githubActionsClient";

function requireReason(body: unknown): string | null {
  const reason = body && typeof body === "object" ? ((body as { reason?: unknown }).reason ?? "") : "";
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length < 4) return null;
  return trimmed;
}

function clientError(
  err: unknown,
  res: import("express").Response,
  label: string,
): void {
  if (err instanceof CloudflareClientError) {
    res.status(502).json({ error: `${label}_api_error`, status: err.status });
    return;
  }
  if (err instanceof GithubActionsClientError) {
    res.status(502).json({ error: `${label}_api_error`, status: err.status });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: "internal_error", message: msg.slice(0, 200) });
}

export function createEdgeMutationRoutes(_pool: Pool): Router {
  const router = Router();
  router.use(requireAAL2);

  // ---- Cloudflare Pages: rollback production deploy -----------------------
  router.post(
    "/cf-pages/rollback",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const project = String(req.body?.project ?? "").trim();
      const deploymentId = String(req.body?.deployment_id ?? "").trim();
      const confirm = String(req.body?.confirm ?? "").trim();

      if (!getConfiguredCloudflareProjects().includes(project)) {
        return res.status(400).json({ error: "unknown_project" });
      }
      if (!/^[0-9a-f-]{8,64}$/i.test(deploymentId)) {
        return res.status(400).json({ error: "invalid_deployment_id" });
      }
      if (confirm !== "ROLLBACK") {
        return res.status(400).json({
          error: "confirm_required",
          hint: "Type ROLLBACK (uppercase) into the confirm field.",
        });
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "rollback_cf_pages_deploy");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "rollback_cf_pages_deploy" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "rollback_cf_pages_deploy",
        reason,
        payload: { project, deployment_id: deploymentId },
        context: extractAuditContext(req),
      });
      try {
        await rollbackDeployment(project, deploymentId);
        res.json({ ok: true });
      } catch (err) {
        clientError(err, res, "cloudflare");
      }
    }),
  );

  // ---- Cloudflare Pages: retry a deployment -------------------------------
  router.post(
    "/cf-pages/retry",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const project = String(req.body?.project ?? "").trim();
      const deploymentId = String(req.body?.deployment_id ?? "").trim();

      if (!getConfiguredCloudflareProjects().includes(project)) {
        return res.status(400).json({ error: "unknown_project" });
      }
      if (!/^[0-9a-f-]{8,64}$/i.test(deploymentId)) {
        return res.status(400).json({ error: "invalid_deployment_id" });
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "retry_cf_pages_deploy");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "retry_cf_pages_deploy" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "retry_cf_pages_deploy",
        reason,
        payload: { project, deployment_id: deploymentId },
        context: extractAuditContext(req),
      });
      try {
        await retryDeployment(project, deploymentId);
        res.json({ ok: true });
      } catch (err) {
        clientError(err, res, "cloudflare");
      }
    }),
  );

  // ---- GitHub Actions: rerun a workflow run -------------------------------
  router.post(
    "/workflow-runs/:runId/rerun",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const runId = Number.parseInt(String(req.params.runId), 10);
      if (!Number.isFinite(runId) || runId <= 0) {
        return res.status(400).json({ error: "invalid_run_id" });
      }
      const onlyFailed = Boolean(req.body?.only_failed);

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "rerun_workflow_run");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "rerun_workflow_run" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "rerun_workflow_run",
        reason,
        payload: { run_id: runId, only_failed: onlyFailed },
        context: extractAuditContext(req),
      });
      try {
        await rerunWorkflowRun(runId, {}, onlyFailed);
        res.json({ ok: true });
      } catch (err) {
        clientError(err, res, "github_actions");
      }
    }),
  );

  // ---- GitHub Actions: cancel an in-progress workflow run -----------------
  router.post(
    "/workflow-runs/:runId/cancel",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const runId = Number.parseInt(String(req.params.runId), 10);
      if (!Number.isFinite(runId) || runId <= 0) {
        return res.status(400).json({ error: "invalid_run_id" });
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "cancel_workflow_run");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "cancel_workflow_run" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "cancel_workflow_run",
        reason,
        payload: { run_id: runId },
        context: extractAuditContext(req),
      });
      try {
        await cancelWorkflowRun(runId);
        res.json({ ok: true });
      } catch (err) {
        clientError(err, res, "github_actions");
      }
    }),
  );

  return router;
}
