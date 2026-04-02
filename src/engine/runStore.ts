/**
 * Workflow run store.
 *
 * Uses PostgreSQL when DATABASE_URL is configured and falls back to the
 * in-memory map for tests and local development without a database.
 */

import { WorkflowRun } from "../types/workflow";
import { parseJsonValue, serializeJson } from "../db/json";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";

const memoryStore = new Map<string, WorkflowRun>();

function cloneRun(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    input: { ...run.input },
    output: run.output ? { ...run.output } : undefined,
    stepResults: [...run.stepResults],
    runtimeState: run.runtimeState
      ? {
          config: { ...run.runtimeState.config },
          context: { ...run.runtimeState.context },
          currentStepIndex: run.runtimeState.currentStepIndex,
          waitingApprovalId: run.runtimeState.waitingApprovalId,
        }
      : undefined,
  };
}

function mapRowToRun(row: Record<string, unknown>): WorkflowRun {
  return {
    id: String(row["id"]),
    templateId: String(row["template_id"]),
    templateName: String(row["template_name"]),
    status: row["status"] as WorkflowRun["status"],
    startedAt: new Date(String(row["started_at"])).toISOString(),
    completedAt: row["completed_at"] ? new Date(String(row["completed_at"])).toISOString() : undefined,
    input: parseJsonValue<Record<string, unknown>>(row["input_json"], {}),
    output: parseJsonValue<Record<string, unknown> | undefined>(row["output_json"], undefined),
    runtimeState: parseJsonValue<WorkflowRun["runtimeState"] | undefined>(row["runtime_state_json"], undefined),
    error: typeof row["error"] === "string" ? row["error"] : undefined,
    userId: typeof row["user_id"] === "string" ? row["user_id"] : undefined,
    stepResults: [],
  };
}

async function loadStepResults(runId: string) {
  const pool = getPostgresPool();
  const result = await pool.query(
    `
      SELECT step_id, step_name, status, output_json, duration_ms, error, agent_slot_results_json, cost_log_json
      FROM workflow_step_results
      WHERE run_id = $1
      ORDER BY ordinal ASC
    `,
    [runId]
  );

  return result.rows.map((row) => ({
    stepId: String(row.step_id),
    stepName: String(row.step_name),
    status: row.status,
    output: parseJsonValue<Record<string, unknown>>(row.output_json, {}),
    durationMs: Number(row.duration_ms),
    error: typeof row.error === "string" ? row.error : undefined,
    agentSlotResults: parseJsonValue(row.agent_slot_results_json, undefined),
    costLog: parseJsonValue(row.cost_log_json, undefined),
  }));
}

async function writeStepResults(runId: string, stepResults: WorkflowRun["stepResults"]): Promise<void> {
  const pool = getPostgresPool();
  await pool.query("DELETE FROM workflow_step_results WHERE run_id = $1", [runId]);

  if (stepResults.length === 0) {
    return;
  }

  for (const [index, result] of stepResults.entries()) {
    await pool.query(
      `
        INSERT INTO workflow_step_results (
          run_id, step_id, step_name, status, output_json, duration_ms, error,
          agent_slot_results_json, cost_log_json, ordinal
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10)
      `,
      [
        runId,
        result.stepId,
        result.stepName,
        result.status,
        serializeJson(result.output),
        result.durationMs,
        result.error ?? null,
        serializeJson(result.agentSlotResults),
        serializeJson(result.costLog),
        index,
      ]
    );
  }
}

export const runStore = {
  async create(run: WorkflowRun): Promise<WorkflowRun> {
    const cloned = cloneRun(run);

    if (!isPostgresPersistenceEnabled()) {
      memoryStore.set(cloned.id, cloned);
      return cloneRun(cloned);
    }

    const pool = getPostgresPool();
    await pool.query(
      `
        INSERT INTO workflow_runs (
          id, template_id, template_name, status, started_at, completed_at,
          input_json, output_json, runtime_state_json, error, user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
      `,
      [
        cloned.id,
        cloned.templateId,
        cloned.templateName,
        cloned.status,
        cloned.startedAt,
        cloned.completedAt ?? null,
        serializeJson(cloned.input),
        serializeJson(cloned.output),
        serializeJson(cloned.runtimeState),
        cloned.error ?? null,
        cloned.userId ?? null,
      ]
    );
    await writeStepResults(cloned.id, cloned.stepResults);
    return cloneRun(cloned);
  },

  async get(id: string): Promise<WorkflowRun | undefined> {
    if (!isPostgresPersistenceEnabled()) {
      const run = memoryStore.get(id);
      return run ? cloneRun(run) : undefined;
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `
        SELECT id, template_id, template_name, status, started_at, completed_at, input_json, output_json, runtime_state_json, error, user_id
        FROM workflow_runs
        WHERE id = $1
      `,
      [id]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const run = mapRowToRun(row);
    run.stepResults = await loadStepResults(id);
    return run;
  },

  async update(id: string, patch: Partial<WorkflowRun>): Promise<WorkflowRun | undefined> {
    const existing = await this.get(id);
    if (!existing) {
      return undefined;
    }

    const updated = {
      ...existing,
      ...patch,
      input: patch.input ? { ...patch.input } : existing.input,
      output: patch.output ? { ...patch.output } : existing.output,
      stepResults: patch.stepResults ? [...patch.stepResults] : existing.stepResults,
      runtimeState: patch.runtimeState
        ? {
            config: { ...patch.runtimeState.config },
            context: { ...patch.runtimeState.context },
            currentStepIndex: patch.runtimeState.currentStepIndex,
            waitingApprovalId: patch.runtimeState.waitingApprovalId,
          }
        : existing.runtimeState,
    };

    if (!isPostgresPersistenceEnabled()) {
      memoryStore.set(id, updated);
      return cloneRun(updated);
    }

    const pool = getPostgresPool();
    await pool.query(
      `
        UPDATE workflow_runs
        SET template_id = $2,
            template_name = $3,
            status = $4,
            started_at = $5,
            completed_at = $6,
            input_json = $7::jsonb,
            output_json = $8::jsonb,
            runtime_state_json = $9::jsonb,
            error = $10,
            user_id = $11,
            updated_at = now()
        WHERE id = $1
      `,
      [
        id,
        updated.templateId,
        updated.templateName,
        updated.status,
        updated.startedAt,
        updated.completedAt ?? null,
        serializeJson(updated.input),
        serializeJson(updated.output),
        serializeJson(updated.runtimeState),
        updated.error ?? null,
        updated.userId ?? null,
      ]
    );
    await writeStepResults(id, updated.stepResults);
    return cloneRun(updated);
  },

  async list(templateId?: string, userId?: string): Promise<WorkflowRun[]> {
    if (!isPostgresPersistenceEnabled()) {
      const runs = Array.from(memoryStore.values());
      const filtered = runs
        .filter((run) => (templateId ? run.templateId === templateId : true))
        .filter((run) => (userId ? run.userId === userId : true));
      return filtered.map((run) => cloneRun(run));
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `
        SELECT id, template_id, template_name, status, started_at, completed_at, input_json, output_json, runtime_state_json, error, user_id
        FROM workflow_runs
        WHERE ($1::text IS NULL OR template_id = $1)
          AND ($2::text IS NULL OR user_id = $2)
        ORDER BY started_at DESC
      `,
      [templateId ?? null, userId ?? null]
    );

    const runs = await Promise.all(
      result.rows.map(async (row) => {
        const run = mapRowToRun(row);
        run.stepResults = await loadStepResults(run.id);
        return run;
      })
    );

    return runs;
  },

  async clear(): Promise<void> {
    memoryStore.clear();

    if (!isPostgresPersistenceEnabled()) {
      return;
    }

    const pool = getPostgresPool();
    await pool.query("DELETE FROM workflow_runs");
  },
};
