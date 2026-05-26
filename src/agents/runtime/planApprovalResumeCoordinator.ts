/**
 * Periodic sweep for approved plan-mode approvals. Mirrors the
 * existing workflow-engine `approvalResumeCoordinator` but for the
 * agent-runtime plan-mode flow.
 *
 * Loop:
 *   1. List approval_requests where status='approved' AND
 *      template_name=PLAN_APPROVAL_TEMPLATE_NAME AND we haven't yet
 *      marked this approval as resumed.
 *   2. For each one, call `resumeApprovedPlan()` which re-runs the
 *      agent with the approved plan folded in.
 *   3. Stamp the approval's `comment` with a `resumed-at: <iso>` marker
 *      so the next sweep doesn't process it twice. (Using the existing
 *      `comment` column avoids a schema change; the marker is a
 *      structured prefix the dashboard ignores.)
 *
 * Best-effort: a row that fails to resume gets a `resume-error:` marker
 * in `comment`, the coordinator logs, and moves on. The dashboard can
 * surface those rows for human follow-up.
 */

import type { Pool } from "pg";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../../db/postgres";
import { PLAN_APPROVAL_TEMPLATE_NAME, resumeApprovedPlan } from "./planApprovalBridge";

const DEFAULT_INTERVAL_MS = 5_000;
const RESUMED_MARKER = "[plan-resume:ok]";
const ERROR_MARKER_PREFIX = "[plan-resume:error]";

interface SweepRow {
  id: string;
  comment: string | null;
}

/**
 * One pass over approved-but-not-yet-resumed plan approvals. Returns
 * the per-row outcomes so tests + observability can inspect what
 * happened without re-querying.
 */
export async function runPlanApprovalResumeSweep(
  pool: Pool = getPostgresPool(),
): Promise<Array<{ approvalId: string; resumed: boolean; reason?: string }>> {
  const result = await pool.query<SweepRow>(
    `SELECT id::text, comment
       FROM approval_requests
      WHERE status = 'approved'
        AND template_name = $1
        AND (comment IS NULL OR comment NOT LIKE $2 || '%')
        AND (comment IS NULL OR comment NOT LIKE $3 || '%')
      ORDER BY resolved_at ASC
      LIMIT 50`,
    [PLAN_APPROVAL_TEMPLATE_NAME, RESUMED_MARKER, ERROR_MARKER_PREFIX],
  );

  const outcomes: Array<{ approvalId: string; resumed: boolean; reason?: string }> = [];
  for (const row of result.rows) {
    const outcome = await resumeApprovedPlan({ pool, approvalId: row.id });
    outcomes.push({ approvalId: row.id, ...outcome });
    const marker = outcome.resumed
      ? RESUMED_MARKER
      : `${ERROR_MARKER_PREFIX} ${outcome.reason ?? "unknown"}`;
    const stamped = row.comment ? `${row.comment}\n${marker}` : marker;
    await pool
      .query(`UPDATE approval_requests SET comment = $2 WHERE id = $1::uuid`, [
        row.id,
        stamped,
      ])
      .catch((err) => {
        console.warn(
          `[planApprovalResumeCoordinator] failed to stamp marker on ${row.id}: ${
            (err as Error).message
          }`,
        );
      });
  }
  return outcomes;
}

// allowlist: process-local sweep handle — the coordinator runs in the same node where it was started
let sweepHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic sweep. Idempotent — calling twice without
 * `stopPlanApprovalResumeCoordinator` first is a no-op so wiring
 * issues during boot don't spawn duplicate timers.
 *
 * Skips in environments without Postgres — the sweep needs to read +
 * stamp the `approval_requests` table.
 */
export function startPlanApprovalResumeCoordinator(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  if (sweepHandle) return;
  if (!isPostgresPersistenceEnabled()) return;
  sweepHandle = setInterval(() => {
    void runPlanApprovalResumeSweep().catch((err) => {
      console.warn(
        `[planApprovalResumeCoordinator] sweep failed: ${(err as Error).message}`,
      );
    });
  }, intervalMs);
  if (typeof sweepHandle.unref === "function") sweepHandle.unref();
}

export function stopPlanApprovalResumeCoordinator(): void {
  if (!sweepHandle) return;
  clearInterval(sweepHandle);
  sweepHandle = null;
}
