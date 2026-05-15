/**
 * Cost recorder for hiring-plan generation (HEL-74).
 *
 * The acceptance criteria call for "cost reflected in `step_results` for
 * the generation call itself." `step_results` has FK constraints up
 * through `runs → workflow_versions → workflows`, so this module
 * lazily ensures a per-workspace "system" workflow + v1 version + a
 * fresh `runs` row, then inserts a single `step_results` row carrying
 * the LLM cost.
 *
 * This is intentionally minimal scaffolding — it sets up the exact
 * row shape the canonical engine (HEL-27 routine builder + future
 * runner) will produce, so dashboards that aggregate `step_results`
 * (HEL-61 Budget page, future cost surfaces) work for hiring-plan
 * costs out of the gate.
 *
 * Errors are swallowed and logged: a step_results write failure
 * must NEVER fail the user-facing plan generation request.
 */

import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { withWorkspaceContext } from "../middleware/workspaceContext";

const SYSTEM_WORKFLOW_TEMPLATE_ID = "__system_hiring_plan_generation";
const SYSTEM_WORKFLOW_NAME = "Hiring plan generation (system)";

export interface RecordHiringPlanCostInput {
  pool: Pool;
  workspaceId: string;
  userId: string;
  missionId: string;
  hiringPlanId: string;
  costCents: number;
  durationMs: number;
  status: "success" | "failure";
  errorMessage?: string;
  rateMatched: boolean;
  promptTokens: number;
  completionTokens: number;
  provider: string;
  model: string;
}

async function ensureSystemWorkflowVersionId(
  client: PoolClient,
  workspaceId: string,
  userId: string,
): Promise<string> {
  // Look up an existing system workflow for this workspace, identified by
  // external_template_id so it survives rename + appears uniquely.
  const existing = await client.query<{ id: string; latest_version_id: string | null }>(
    `SELECT id, latest_version_id
       FROM workflows
      WHERE workspace_id = $1 AND external_template_id = $2
      LIMIT 1`,
    [workspaceId, SYSTEM_WORKFLOW_TEMPLATE_ID],
  );

  let workflowId: string;
  let versionId: string | null;
  if (existing.rows.length > 0) {
    workflowId = existing.rows[0].id;
    versionId = existing.rows[0].latest_version_id;
  } else {
    workflowId = randomUUID();
    await client.query(
      `INSERT INTO workflows (id, workspace_id, external_template_id, name)
         VALUES ($1, $2, $3, $4)`,
      [workflowId, workspaceId, SYSTEM_WORKFLOW_TEMPLATE_ID, SYSTEM_WORKFLOW_NAME],
    );
    versionId = null;
  }

  if (!versionId) {
    versionId = randomUUID();
    await client.query(
      `INSERT INTO workflow_versions (id, workflow_id, version, dag, created_by_user_id)
         VALUES ($1, $2, 1, '{}'::jsonb, $3)`,
      [versionId, workflowId, userId],
    );
    await client.query(
      `UPDATE workflows SET latest_version_id = $1, updated_at = now() WHERE id = $2`,
      [versionId, workflowId],
    );
  }

  return versionId;
}

/**
 * Inserts a synthetic run + step_result for one hiring-plan generation
 * call. Returns the run id + step_result id for downstream telemetry.
 *
 * Failures are LOGGED but NOT THROWN — the caller's plan-generation
 * response should not be tied to bookkeeping success.
 */
export async function recordHiringPlanCost(
  input: RecordHiringPlanCostInput,
): Promise<{ runId: string; stepResultId: string } | null> {
  try {
    return await withWorkspaceContext(
      input.pool,
      { workspaceId: input.workspaceId, userId: input.userId },
      async (client) => {
        const workflowVersionId = await ensureSystemWorkflowVersionId(
          client,
          input.workspaceId,
          input.userId,
        );

        const runId = randomUUID();
        const startedAt = new Date(Date.now() - input.durationMs);
        await client.query(
          `INSERT INTO runs (
             id, workspace_id, workflow_version_id, status,
             started_at, ended_at, input, output, user_id
           ) VALUES (
             $1, $2, $3, $4,
             $5, now(), $6::jsonb, $7::jsonb, $8
           )`,
          [
            runId,
            input.workspaceId,
            workflowVersionId,
            input.status === "success" ? "completed" : "failed",
            startedAt,
            JSON.stringify({ missionId: input.missionId, hiringPlanId: input.hiringPlanId }),
            JSON.stringify({ hiringPlanId: input.hiringPlanId }),
            input.userId,
          ],
        );

        const stepResultId = randomUUID();
        await client.query(
          `INSERT INTO step_results (
             id, run_id, step_id, step_name, status, output,
             cost_cents, duration_ms, error, cost_log_json, ordinal
           ) VALUES (
             $1, $2, $3, $4, $5, $6::jsonb,
             $7, $8, $9, $10::jsonb, 1
           )`,
          [
            stepResultId,
            runId,
            "hiring_plan_generation",
            "Hiring plan generation",
            input.status,
            JSON.stringify({
              missionId: input.missionId,
              hiringPlanId: input.hiringPlanId,
            }),
            input.costCents,
            input.durationMs,
            input.errorMessage ?? null,
            JSON.stringify({
              provider: input.provider,
              model: input.model,
              promptTokens: input.promptTokens,
              completionTokens: input.completionTokens,
              rateMatched: input.rateMatched,
            }),
          ],
        );

        return { runId, stepResultId };
      },
    );
  } catch (err) {
    // Swallow + log — bookkeeping can't be allowed to break the user
    // flow. A budget gate (HEL-17) when it lands will run BEFORE the
    // LLM call and is the right place for hard failures.
    console.error(
      `[hiring-plan-cost] step_results write failed (missionId=${input.missionId}, ` +
        `hiringPlanId=${input.hiringPlanId}, cost=${input.costCents}c): ${
          (err as Error).message
        }`,
    );
    return null;
  }
}
