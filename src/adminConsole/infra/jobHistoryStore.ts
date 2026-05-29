/**
 * admin_infra_job_runs writer + reader (HEL infra dashboard PR #2).
 *
 * Each scheduled job (openrouterHealth, creditExpiration, creditAnomaly
 * Detector, runtimeRetention) calls `logJobRun` at run boundaries so the
 * Compute tab can render a "last 10 runs" panel. The writer is best-effort:
 * a job's own success path must not fail because the dashboard table is
 * unavailable, so callers wrap the call in try/catch.
 *
 * HEL-308: Both reads and writes now run inside a transaction with the
 * `app.is_platform_admin` GUC set, so the admin-only RLS policy on
 * admin_infra_job_runs (migration 092) passes. Writers (cron) use
 * `withSystemAdminContext` to set the GUC; the admin-console reader
 * passes its existing `req.platformAdminDb` PoolClient directly.
 */

import type { Pool, PoolClient } from "pg";
import { getPostgresPool } from "../../db/postgres";
import { withSystemAdminContext } from "../../middleware/workspaceContext";

export type JobOutcome = "success" | "failure" | "partial" | "skipped";

export interface LogJobRunInput {
  jobName: string;
  startedAt: Date;
  endedAt?: Date | null;
  outcome: JobOutcome;
  message?: string | null;
  payload?: Record<string, unknown>;
}

const INSERT_SQL = `INSERT INTO admin_infra_job_runs
       (job_name, started_at, ended_at, outcome, message, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`;

function logRunParams(input: LogJobRunInput): unknown[] {
  return [
    input.jobName,
    input.startedAt,
    input.endedAt ?? null,
    input.outcome,
    input.message ?? null,
    JSON.stringify(input.payload ?? {}),
  ];
}

export async function logJobRun(input: LogJobRunInput, pool?: Pool): Promise<void> {
  const conn = pool ?? getPostgresPool();
  if (!conn) return;
  await withSystemAdminContext(conn, (client) => client.query(INSERT_SQL, logRunParams(input)));
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

const LIST_SQL = `SELECT id, job_name, started_at, ended_at, outcome, message, payload
       FROM (
         SELECT *,
                ROW_NUMBER() OVER (PARTITION BY job_name ORDER BY started_at DESC) AS rn
           FROM admin_infra_job_runs
          WHERE job_name = ANY($1::text[])
       ) ranked
      WHERE rn <= $2
      ORDER BY job_name, started_at DESC`;

/**
 * Lists the most recent runs for each distinct job, capped at `limit` rows
 * per job (default 10). Returned grouped by job name in original order.
 *
 * The caller must pass an admin-context-aware connection: either a PoolClient
 * already inside a `requirePlatformAdmin` transaction (e.g. `req.platformAdminDb`)
 * or a Pool when called outside a request context (where the caller has set
 * up the GUC themselves, e.g. via `withSystemAdminContext`). A bare pool
 * without admin context will see zero rows once the RLS policy is enforced.
 */
export async function listRecentJobRuns(
  conn: Pool | PoolClient,
  jobNames: string[],
  limit = 10,
): Promise<Record<string, JobRunRow[]>> {
  if (jobNames.length === 0) return {};
  const result = await conn.query<JobRunRow>(LIST_SQL, [jobNames, limit]);
  const out: Record<string, JobRunRow[]> = {};
  for (const name of jobNames) out[name] = [];
  for (const row of result.rows) {
    (out[row.job_name] ??= []).push(row);
  }
  return out;
}
