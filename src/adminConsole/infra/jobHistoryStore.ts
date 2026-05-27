/**
 * admin_infra_job_runs writer + reader (HEL infra dashboard PR #2).
 *
 * Each scheduled job (openrouterHealth, creditExpiration, creditAnomaly
 * Detector, runtimeRetention) calls `logJobRun` at run boundaries so the
 * Compute tab can render a "last 10 runs" panel. The writer is best-effort:
 * a job's own success path must not fail because the dashboard table is
 * unavailable, so callers wrap the call in try/catch.
 */

import type { Pool } from "pg";
import { getPostgresPool } from "../../db/postgres";

export type JobOutcome = "success" | "failure" | "partial" | "skipped";

export interface LogJobRunInput {
  jobName: string;
  startedAt: Date;
  endedAt?: Date | null;
  outcome: JobOutcome;
  message?: string | null;
  payload?: Record<string, unknown>;
}

export async function logJobRun(input: LogJobRunInput, pool?: Pool): Promise<void> {
  const conn = pool ?? getPostgresPool();
  if (!conn) return;
  await conn.query(
    `INSERT INTO admin_infra_job_runs
       (job_name, started_at, ended_at, outcome, message, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.jobName,
      input.startedAt,
      input.endedAt ?? null,
      input.outcome,
      input.message ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

/**
 * Best-effort wrapper used inside scheduled jobs. Swallows write failures
 * (logging to console) so the job's own work is never blocked by infra
 * dashboard plumbing.
 */
export async function safeLogJobRun(input: LogJobRunInput, pool?: Pool): Promise<void> {
  try {
    await logJobRun(input, pool);
  } catch (err) {
    console.warn(
      `[infra-job-history] failed to record run for ${input.jobName}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export interface JobRunRow {
  id: string;
  job_name: string;
  started_at: string;
  ended_at: string | null;
  outcome: JobOutcome;
  message: string | null;
  payload: Record<string, unknown>;
}

/**
 * Lists the most recent runs for each distinct job, capped at `limit` rows
 * per job (default 10). Returned grouped by job name in original order.
 */
export async function listRecentJobRuns(
  jobNames: string[],
  limit = 10,
  pool?: Pool,
): Promise<Record<string, JobRunRow[]>> {
  const conn = pool ?? getPostgresPool();
  if (!conn || jobNames.length === 0) return {};
  const result = await conn.query<JobRunRow>(
    `SELECT id, job_name, started_at, ended_at, outcome, message, payload
       FROM (
         SELECT *,
                ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY started_at DESC) AS rn
           FROM admin_infra_job_runs
          WHERE job_name = ANY($1::text[])
       ) ranked
      WHERE rn <= $2
      ORDER BY job_name, started_at DESC`,
    [jobNames, limit],
  );
  const out: Record<string, JobRunRow[]> = {};
  for (const name of jobNames) out[name] = [];
  for (const row of result.rows) {
    (out[row.job_name] ??= []).push(row);
  }
  return out;
}
