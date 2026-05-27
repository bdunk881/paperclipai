/**
 * Queue inspector reads for the Taskforce.sh-style UI (HEL infra PR #3).
 *
 * Mounted at /api/admin-console/infra/queues/inspector. All routes are
 * READ-ONLY in this PR. Mutation verbs (retry/promote/remove/pause/resume/
 * drain) land in PR #6 alongside the requireAAL2-gated mutation routes.
 *
 *   GET  /                         list every known queue with live counters
 *   GET  /:name                    counters + workers + 60-min throughput
 *   GET  /:name/jobs               jobs filtered by state + search
 *   GET  /:name/jobs/:jobId        full job inspector payload
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { Job, JobType, Queue } from "bullmq";
import { MetricsTime } from "bullmq";
import { asyncHandler } from "../../../middleware/asyncHandler";
import { getAgentPromptQueue, getDlqQueue, getRunQueue } from "../../../queue/queues";

interface QueueEntry {
  name: string;
  queue: Queue | null;
}

function knownQueues(): QueueEntry[] {
  return [
    { name: "runs", queue: getRunQueue() as Queue | null },
    { name: "runs-dlq", queue: getDlqQueue() as Queue | null },
    { name: "agent-prompt", queue: getAgentPromptQueue() as Queue | null },
  ];
}

function resolveQueue(name: string): Queue | null {
  const entry = knownQueues().find((q) => q.name === name);
  return entry?.queue ?? null;
}

interface CountersPayload {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
}

async function readCounters(queue: Queue): Promise<CountersPayload> {
  const c = await queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "failed",
    "completed",
    "paused",
  );
  return {
    waiting: c.waiting ?? 0,
    active: c.active ?? 0,
    delayed: c.delayed ?? 0,
    failed: c.failed ?? 0,
    completed: c.completed ?? 0,
    paused: c.paused ?? 0,
  };
}

const ALLOWED_STATES: JobType[] = [
  "waiting",
  "active",
  "delayed",
  "failed",
  "completed",
  "paused",
];

function parseState(raw: unknown): JobType {
  const s = typeof raw === "string" ? raw : "";
  return (ALLOWED_STATES as string[]).includes(s) ? (s as JobType) : "waiting";
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

interface JobSummary {
  id: string;
  name: string;
  state: string;
  timestamp: number;
  processed_on: number | null;
  finished_on: number | null;
  attempts_made: number;
  attempts_total: number | null;
  delay: number | null;
  failed_reason: string | null;
}

async function summarizeJob(job: Job, state: string): Promise<JobSummary> {
  return {
    id: String(job.id ?? ""),
    name: job.name,
    state,
    timestamp: job.timestamp,
    processed_on: job.processedOn ?? null,
    finished_on: job.finishedOn ?? null,
    attempts_made: job.attemptsMade,
    attempts_total: job.opts?.attempts ?? null,
    delay: job.opts?.delay ?? null,
    failed_reason: job.failedReason ?? null,
  };
}

export function createQueueInspectorRoutes(_pool: Pool): Router {
  const router = Router();

  // GET / — list of queues with live counts
  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const entries = knownQueues();
      const results = await Promise.all(
        entries.map(async ({ name, queue }) => {
          if (!queue) return { name, available: false as const };
          try {
            const counters = await readCounters(queue);
            return { name, available: true as const, counters };
          } catch (err) {
            return {
              name,
              available: true as const,
              counters: null,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      res.json({ queues: results });
    }),
  );

  // GET /:name — counters + workers + throughput sparkline
  router.get(
    "/:name",
    asyncHandler(async (req, res) => {
      const queue = resolveQueue(req.params.name);
      if (!queue) return res.status(404).json({ error: "queue_not_found" });

      const [counters, workers, completed, failed] = await Promise.all([
        readCounters(queue),
        queue.getWorkers().catch(() => [] as Array<{ name?: string }>),
        queue
          .getMetrics("completed", 0, MetricsTime.ONE_HOUR - 1)
          .catch(() => ({ data: [] as number[], count: 0, meta: { count: 0, prevTS: 0, prevCount: 0 } })),
        queue
          .getMetrics("failed", 0, MetricsTime.ONE_HOUR - 1)
          .catch(() => ({ data: [] as number[], count: 0, meta: { count: 0, prevTS: 0, prevCount: 0 } })),
      ]);

      // Workers list: BullMQ returns the raw `client list` rows. Each entry's
      // `name` is the Worker.opts.name (defaults to a UUID) and may be
      // suffixed with the host process id; we surface it raw for now.
      // Fly machine correlation happens in the React layer where the page
      // also has the Fly machines list to match against.
      res.json({
        name: req.params.name,
        counters,
        workers: workers.map((w) => ({
          name: (w as { name?: string }).name ?? null,
          addr: (w as { addr?: string }).addr ?? null,
          age: (w as { age?: number }).age ?? null,
          idle: (w as { idle?: number }).idle ?? null,
        })),
        throughput: {
          completed_per_minute: completed.data,
          failed_per_minute: failed.data,
          window_minutes: MetricsTime.ONE_HOUR,
        },
      });
    }),
  );

  // GET /:name/jobs?state=failed&start=0&end=24&q=
  router.get(
    "/:name/jobs",
    asyncHandler(async (req, res) => {
      const queue = resolveQueue(req.params.name);
      if (!queue) return res.status(404).json({ error: "queue_not_found" });

      const state = parseState(req.query.state);
      const start = parsePositiveInt(req.query.start, 0, 1_000_000);
      const pageSize = parsePositiveInt(req.query.pageSize, 25, 100);
      const end = start + pageSize - 1;
      const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

      const jobs = await queue.getJobs([state] as JobType[], start, end, true);
      const filtered = q
        ? jobs.filter((j) => {
            const idMatch = String(j.id ?? "").toLowerCase().includes(q);
            const nameMatch = j.name.toLowerCase().includes(q);
            return idMatch || nameMatch;
          })
        : jobs;

      const summaries = await Promise.all(filtered.map((j) => summarizeJob(j as Job, state)));
      res.json({
        name: req.params.name,
        state,
        start,
        page_size: pageSize,
        jobs: summaries,
        returned: summaries.length,
      });
    }),
  );

  // GET /:name/jobs/:jobId — full inspector payload (data, returnValue, logs)
  router.get(
    "/:name/jobs/:jobId",
    asyncHandler(async (req, res) => {
      const queue = resolveQueue(req.params.name);
      if (!queue) return res.status(404).json({ error: "queue_not_found" });

      const job = (await queue.getJob(req.params.jobId)) as Job | undefined;
      if (!job) return res.status(404).json({ error: "job_not_found" });

      const [state, logs] = await Promise.all([
        job.getState().catch(() => "unknown"),
        queue.getJobLogs(String(job.id ?? ""), 0, 100, true).catch(() => ({ logs: [] as string[], count: 0 })),
      ]);

      res.json({
        id: String(job.id ?? ""),
        name: job.name,
        state,
        data: job.data,
        return_value: job.returnvalue ?? null,
        failed_reason: job.failedReason ?? null,
        stacktrace: job.stacktrace ?? [],
        attempts_made: job.attemptsMade,
        attempts_total: job.opts?.attempts ?? null,
        opts: job.opts,
        timestamp: job.timestamp,
        processed_on: job.processedOn ?? null,
        finished_on: job.finishedOn ?? null,
        logs: logs.logs,
      });
    }),
  );

  return router;
}
