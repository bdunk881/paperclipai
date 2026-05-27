/**
 * Infra dashboard Compute reads (HEL infra PR #2).
 *
 * Mounted under /api/admin-console/infra/compute. All routes assume
 * requirePlatformAdmin has run upstream.
 *
 * GET /  → bundle for the InfraCompute page:
 *           - Fly machines for all configured apps
 *           - BullMQ counters for the three known queues
 *           - Recent runs of every scheduled job
 *
 * Mutation verbs (restart machine, retry/promote/replay job, pause queue,
 * trigger scheduled job) land in PR #6 with requireAAL2 composed.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { recordAdminAction } from "../auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import type { Queue } from "bullmq";
import {
  getAgentPromptQueue,
  getDlqQueue,
  getRunQueue,
} from "../../queue/queues";
import { checkRedisConnection, isRedisConfigured } from "../../queue/redisClient";
import { getConfiguredFlyApps, listMachinesForApps } from "./clients/flyClient";
import { listRecentJobRuns } from "./jobHistoryStore";

interface QueueCounters {
  name: string;
  available: boolean;
  waiting?: number;
  active?: number;
  delayed?: number;
  failed?: number;
  completed?: number;
  paused?: number;
  error?: string;
}

const SCHEDULED_JOBS = [
  "openrouter_health",
  "credit_expiration",
  "credit_anomaly_detector",
  "runtime_retention",
];

async function readQueueCounters(): Promise<QueueCounters[]> {
  const entries: Array<{ name: string; queue: Queue | null }> = [
    { name: "runs", queue: getRunQueue() as Queue | null },
    { name: "runs-dlq", queue: getDlqQueue() as Queue | null },
    { name: "agent-prompt", queue: getAgentPromptQueue() as Queue | null },
  ];

  return Promise.all(
    entries.map(async ({ name, queue }) => {
      if (!queue) return { name, available: false };
      try {
        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "failed",
          "completed",
          "paused",
        );
        return {
          name,
          available: true,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
          paused: counts.paused ?? 0,
        };
      } catch (err) {
        return {
          name,
          available: true,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

export function createComputeRoutes(_pool: Pool): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "view_infra_compute",
        reason: "",
        context: extractAuditContext(req),
      });

      const apps = getConfiguredFlyApps();
      const flyResult = process.env.FLY_API_TOKEN
        ? await listMachinesForApps(apps).catch((err) => {
            return apps.map((appName) => ({
              appName,
              machines: [],
              error: err instanceof Error ? err.message : String(err),
            }));
          })
        : apps.map((appName) => ({
            appName,
            machines: [],
            error: "FLY_API_TOKEN not configured",
          }));

      const [queues, jobRuns, redisOk] = await Promise.all([
        readQueueCounters(),
        listRecentJobRuns(SCHEDULED_JOBS, 10),
        isRedisConfigured() ? checkRedisConnection() : Promise.resolve(false),
      ]);

      res.json({
        fly: flyResult,
        queues,
        scheduled_jobs: jobRuns,
        redis: { configured: isRedisConfigured(), reachable: redisOk },
        bullboard_url: "/api/admin-console/infra/queues/_ui",
      });
    }),
  );

  return router;
}
