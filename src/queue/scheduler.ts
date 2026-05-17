/**
 * Scheduler bootstrap for cron-driven routines (HEL-108).
 *
 * syncRepeatableJobs() is called on worker startup. It queries the DB for
 * every enabled routine that has a schedule_cron, upserts a BullMQ job
 * scheduler for each one, and removes schedulers for routines that are no
 * longer in the result set (disabled or deleted).
 *
 * Individual enable/disable API calls also call addRepeatableJob /
 * removeRepeatableJob directly so the scheduler stays in sync at mutation
 * time without needing a full re-sync.
 */

import type { Queue } from "bullmq";
import type { Pool } from "pg";
import type { RunJobPayload } from "./queues";

/**
 * Upserts a BullMQ job scheduler for a single enabled routine.
 * Safe to call multiple times — BullMQ deduplicates by scheduler ID.
 */
export async function addRepeatableJob(
  queue: Queue<RunJobPayload>,
  routineId: string,
  scheduleCron: string,
  workspaceId: string
): Promise<void> {
  await queue.upsertJobScheduler(
    `routine:${routineId}`,
    { pattern: scheduleCron },
    {
      data: {
        runId: "",
        templateId: "",
        workspaceId,
        stepIndex: 0,
        idempotencyKey: `scheduler:${routineId}`,
      },
    }
  );
}

/**
 * Removes the BullMQ job scheduler for a routine.
 * No-op if the scheduler does not exist.
 */
export async function removeRepeatableJob(
  queue: Queue<RunJobPayload>,
  routineId: string
): Promise<void> {
  await queue.removeJobScheduler(`routine:${routineId}`);
}

interface RoutineRow {
  id: string;
  schedule_cron: string;
  workspace_id: string;
}

/**
 * Full reconciliation: upsert schedulers for all enabled cron routines and
 * remove schedulers that no longer have a matching enabled routine.
 *
 * Called once on worker startup so cron schedules survive process restarts
 * without accumulating duplicates.
 */
export async function syncRepeatableJobs(
  queue: Queue<RunJobPayload>,
  pool: Pool
): Promise<void> {
  const result = await pool.query<RoutineRow>(
    `SELECT id, schedule_cron, workspace_id::text
       FROM routines
      WHERE enabled = true
        AND schedule_cron IS NOT NULL`
  );

  const activeRoutineIds = new Set(result.rows.map((r) => r.id));

  // Upsert a scheduler for every active cron routine.
  for (const row of result.rows) {
    await addRepeatableJob(queue, row.id, row.schedule_cron, row.workspace_id ?? "");
  }

  // Remove schedulers whose routine is no longer active.
  const schedulers = await queue.getJobSchedulers();
  for (const scheduler of schedulers) {
    const id = String(scheduler.id ?? "");
    if (!id.startsWith("routine:")) continue;
    const routineId = id.slice("routine:".length);
    if (!activeRoutineIds.has(routineId)) {
      await queue.removeJobScheduler(id);
    }
  }
}
