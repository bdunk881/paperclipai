/**
 * Compute mutation routes for the Infrastructure dashboard (HEL infra PR #6).
 *
 * Every route runs under requireAuth + requirePlatformAdmin + requireAAL2,
 * writes an audit row BEFORE the side-effect, and consumes a rate-limit
 * bucket BEFORE the side-effect. Reason is required on every route.
 *
 * Mounted at /api/admin-console/infra/compute/actions.
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { Job, Queue } from "bullmq";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAAL2 } from "../../middleware/requireAAL2";
import { recordAdminAction } from "../auditLog";
import { consumeRateLimit } from "../rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import {
  FlyClientError,
  getConfiguredFlyApps,
  restartMachine,
} from "./clients/flyClient";
import { getAgentPromptQueue, getDlqQueue, getRunQueue } from "../../queue/queues";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLY_MACHINE_ID_RE = /^[0-9a-z]{6,32}$/;
const QUEUE_NAMES = new Set(["runs", "runs-dlq", "agent-prompt"]);
const SCHEDULED_JOB_NAMES = new Set([
  "openrouter_health",
  "credit_expiration",
  "credit_anomaly_detector",
  "runtime_retention",
]);

function resolveQueue(name: string): Queue | null {
  switch (name) {
    case "runs":
      return getRunQueue() as Queue | null;
    case "runs-dlq":
      return getDlqQueue() as Queue | null;
    case "agent-prompt":
      return getAgentPromptQueue() as Queue | null;
    default:
      return null;
  }
}

function requireReason(body: unknown): string | null {
  const reason = body && typeof body === "object" ? ((body as { reason?: unknown }).reason ?? "") : "";
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length < 4) return null;
  return trimmed;
}

function isProductionApp(appName: string): boolean {
  return /production|prod\b/i.test(appName);
}

function flyErrorToHttp(err: unknown, res: import("express").Response): void {
  if (err instanceof FlyClientError) {
    res.status(502).json({ error: "fly_api_error", status: err.status });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: "internal_error", message: msg.slice(0, 200) });
}

export function createComputeMutationRoutes(_pool: Pool): Router {
  const router = Router();

  // Every route under this router requires AAL2 step-up.
  router.use(requireAAL2);

  // ---- Fly: restart machine -----------------------------------------------
  router.post(
    "/fly/restart-machine",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });

      const app = String(req.body?.app ?? "").trim();
      const machineId = String(req.body?.machine_id ?? "").trim();
      const confirm = String(req.body?.confirm ?? "").trim();

      if (!getConfiguredFlyApps().includes(app)) {
        return res.status(400).json({ error: "unknown_app" });
      }
      if (!FLY_MACHINE_ID_RE.test(machineId)) {
        return res.status(400).json({ error: "invalid_machine_id" });
      }
      if (isProductionApp(app) && confirm !== "RESTART") {
        return res.status(400).json({
          error: "confirm_required",
          hint: "Type RESTART (uppercase) into the confirm field for production apps.",
        });
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;

      try {
        consumeRateLimit(adminId, "restart_fly_machine");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "restart_fly_machine" });
      }

      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "restart_fly_machine",
        reason,
        payload: { app, machine_id: machineId, production: isProductionApp(app) },
        context: extractAuditContext(req),
      });

      try {
        await restartMachine(app, machineId);
        return res.json({ ok: true });
      } catch (err) {
        flyErrorToHttp(err, res);
      }
    }),
  );

  // ---- BullMQ: retry one failed job ---------------------------------------
  router.post(
    "/queues/:queueName/retry-job/:jobId",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const queueName = String(req.params.queueName);
      const jobId = String(req.params.jobId);
      if (!QUEUE_NAMES.has(queueName)) return res.status(400).json({ error: "unknown_queue" });

      const queue = resolveQueue(queueName);
      if (!queue) return res.status(503).json({ error: "queue_unavailable" });

      const job = (await queue.getJob(jobId)) as Job | undefined;
      if (!job) return res.status(404).json({ error: "job_not_found" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "retry_queue_job");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "retry_queue_job" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "retry_queue_job",
        reason,
        payload: { queue: queueName, job_id: jobId, attempts_made: job.attemptsMade },
        context: extractAuditContext(req),
      });
      await job.retry();
      res.json({ ok: true });
    }),
  );

  // ---- BullMQ: promote delayed job ----------------------------------------
  router.post(
    "/queues/:queueName/promote-job/:jobId",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const queueName = String(req.params.queueName);
      const jobId = String(req.params.jobId);
      if (!QUEUE_NAMES.has(queueName)) return res.status(400).json({ error: "unknown_queue" });

      const queue = resolveQueue(queueName);
      if (!queue) return res.status(503).json({ error: "queue_unavailable" });
      const job = (await queue.getJob(jobId)) as Job | undefined;
      if (!job) return res.status(404).json({ error: "job_not_found" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "promote_queue_job");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "promote_queue_job" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "promote_queue_job",
        reason,
        payload: { queue: queueName, job_id: jobId },
        context: extractAuditContext(req),
      });
      await job.promote();
      res.json({ ok: true });
    }),
  );

  // ---- BullMQ: remove job -------------------------------------------------
  router.post(
    "/queues/:queueName/remove-job/:jobId",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const queueName = String(req.params.queueName);
      const jobId = String(req.params.jobId);
      if (!QUEUE_NAMES.has(queueName)) return res.status(400).json({ error: "unknown_queue" });

      const queue = resolveQueue(queueName);
      if (!queue) return res.status(503).json({ error: "queue_unavailable" });
      const job = (await queue.getJob(jobId)) as Job | undefined;
      if (!job) return res.status(404).json({ error: "job_not_found" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "remove_queue_job");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "remove_queue_job" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "remove_queue_job",
        reason,
        payload: { queue: queueName, job_id: jobId },
        context: extractAuditContext(req),
      });
      await job.remove();
      res.json({ ok: true });
    }),
  );

  // ---- BullMQ: replay a DLQ job back onto the runs queue ------------------
  router.post(
    "/queues/runs-dlq/replay/:jobId",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const jobId = String(req.params.jobId);

      const dlq = getDlqQueue() as Queue | null;
      const runs = getRunQueue() as Queue | null;
      if (!dlq || !runs) return res.status(503).json({ error: "queues_unavailable" });

      const dlqJob = (await dlq.getJob(jobId)) as Job | undefined;
      if (!dlqJob) return res.status(404).json({ error: "job_not_found_in_dlq" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "replay_dlq_job");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "replay_dlq_job" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "replay_dlq_job",
        reason,
        payload: { dlq_job_id: jobId, name: dlqJob.name },
        context: extractAuditContext(req),
      });

      const newJob = await runs.add(dlqJob.name, dlqJob.data, {
        // Keep the original idempotency key in the data; reset BullMQ state
        // so the new job runs fresh.
        attempts: dlqJob.opts?.attempts,
      });
      await dlqJob.remove();
      res.json({ ok: true, new_job_id: String(newJob.id) });
    }),
  );

  // ---- BullMQ: pause / resume / drain a queue -----------------------------
  router.post(
    "/queues/:queueName/pause",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const queueName = String(req.params.queueName);
      if (!QUEUE_NAMES.has(queueName)) return res.status(400).json({ error: "unknown_queue" });

      const queue = resolveQueue(queueName);
      if (!queue) return res.status(503).json({ error: "queue_unavailable" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "pause_queue");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "pause_queue" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "pause_queue",
        reason,
        payload: { queue: queueName },
        context: extractAuditContext(req),
      });
      await queue.pause();
      res.json({ ok: true });
    }),
  );

  router.post(
    "/queues/:queueName/resume",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const queueName = String(req.params.queueName);
      if (!QUEUE_NAMES.has(queueName)) return res.status(400).json({ error: "unknown_queue" });

      const queue = resolveQueue(queueName);
      if (!queue) return res.status(503).json({ error: "queue_unavailable" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "resume_queue");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "resume_queue" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "resume_queue",
        reason,
        payload: { queue: queueName },
        context: extractAuditContext(req),
      });
      await queue.resume();
      res.json({ ok: true });
    }),
  );

  // Drain is the most destructive verb on this router — requires explicit
  // `acknowledge: "DRAIN"` in the body on top of the reason + AAL2 cookie.
  router.post(
    "/queues/:queueName/drain",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const queueName = String(req.params.queueName);
      if (!QUEUE_NAMES.has(queueName)) return res.status(400).json({ error: "unknown_queue" });
      const acknowledge = String(req.body?.acknowledge ?? "");
      if (acknowledge !== "DRAIN") {
        return res
          .status(400)
          .json({ error: "acknowledge_required", hint: 'Set { "acknowledge": "DRAIN" } to confirm.' });
      }
      const delayed = Boolean(req.body?.delayed);

      const queue = resolveQueue(queueName);
      if (!queue) return res.status(503).json({ error: "queue_unavailable" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "drain_queue");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "drain_queue" });
      }
      // Capture counts BEFORE the drain so the audit row reflects how much
      // was actually wiped.
      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed",
        "completed",
      );
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "drain_queue",
        reason,
        payload: { queue: queueName, counts_before: counts, included_delayed: delayed },
        context: extractAuditContext(req),
      });
      await queue.drain(delayed);
      res.json({ ok: true, counts_before: counts });
    }),
  );

  // ---- Trigger a scheduled job (one-shot) ---------------------------------
  // Reuses the existing runOpenrouterHealthCheck / runCreditExpirationCycle
  // / runCreditAnomalyDetection / cleanupRuntimePersistenceHistory exports
  // so we don't bypass safeLogJobRun.
  router.post(
    "/scheduled-jobs/:jobName/trigger",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const jobName = String(req.params.jobName);
      if (!SCHEDULED_JOB_NAMES.has(jobName)) return res.status(400).json({ error: "unknown_scheduled_job" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "trigger_scheduled_job");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "trigger_scheduled_job" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "trigger_scheduled_job",
        reason,
        payload: { job: jobName },
        context: extractAuditContext(req),
      });

      // Run async so the HTTP response doesn't block on the job; the
      // safeLogJobRun call inside the scheduler writes a fresh run row to
      // admin_infra_job_runs which the Compute page picks up on its next
      // poll.
      void (async () => {
        try {
          switch (jobName) {
            case "openrouter_health": {
              const mod = await import("../../billing/credits/openrouterHealthJob");
              await mod.runOpenrouterHealthCheck();
              break;
            }
            case "credit_expiration": {
              const mod = await import("../../billing/credits/creditExpirationJob");
              await mod.runCreditExpirationCycle();
              break;
            }
            case "credit_anomaly_detector": {
              const mod = await import("../../billing/credits/creditAnomalyDetectorJob");
              await mod.runCreditAnomalyDetection();
              break;
            }
            case "runtime_retention": {
              const mod = await import("../../db/runtimeRetention");
              await mod.cleanupRuntimePersistenceHistory();
              break;
            }
          }
        } catch (err) {
          console.error(
            `[infra:trigger_scheduled_job] ${jobName} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      })();

      res.status(202).json({ ok: true, triggered: jobName });
    }),
  );

  return router;
}
