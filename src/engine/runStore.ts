/**
 * Workflow run store.
 *
 * Uses PostgreSQL when DATABASE_URL is configured and falls back to the
 * in-memory map for tests and local development without a database.
 */

import { PoolClient } from "pg";
import { WorkflowRun } from "../types/workflow";
import { parseJsonValue, serializeJson } from "../db/json";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

const memoryStore = new Map<string, WorkflowRun>();

function postgresPersistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("runStore requires DATABASE_URL outside development/test.");
}

function cloneRun(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    input: { ...run.input },
    output: run.output ? { ...run.output } : undefined,
    stepResults: [...run.stepResults],
    workflowDag: run.workflowDag ? cloneJson(run.workflowDag) : undefined,
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveWorkspaceId(run: WorkflowRun): string | undefined {
  const candidates = [
    run.workspaceId,
    run.input["workspaceId"],
    run.runtimeState?.config["workspaceId"],
    run.runtimeState?.context["workspaceId"],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function buildWorkflowDag(run: WorkflowRun): Record<string, unknown> {
  if (run.workflowDag && typeof run.workflowDag === "object" && !Array.isArray(run.workflowDag)) {
    return cloneJson(run.workflowDag as Record<string, unknown>);
  }

  return {
    id: run.templateId,
    name: run.templateName,
    version: run.workflowVersion ?? 1,
    steps: [],
    legacyRuntimeSnapshot: true,
  };
}

function costCentsFor(result: WorkflowRun["stepResults"][number]): number {
  const estimatedCostUsd = result.costLog?.estimatedCostUsd;
  if (typeof estimatedCostUsd !== "number" || !Number.isFinite(estimatedCostUsd)) {
    return 0;
  }

  return Math.max(0, Math.round(estimatedCostUsd * 100));
}

function mapRowToRun(row: Record<string, unknown>): WorkflowRun {
  return {
    id: String(row["id"]),
    templateId: String(row["template_id"] ?? row["workflow_id"]),
    templateName: String(row["template_name"]),
    workspaceId: typeof row["workspace_id"] === "string" ? row["workspace_id"] : undefined,
    routineId: typeof row["routine_id"] === "string" ? row["routine_id"] : undefined,
    workflowId: typeof row["workflow_id"] === "string" ? row["workflow_id"] : undefined,
    workflowVersionId: typeof row["workflow_version_id"] === "string" ? row["workflow_version_id"] : undefined,
    workflowVersion: row["workflow_version"] === null || row["workflow_version"] === undefined
      ? undefined
      : Number(row["workflow_version"]),
    workflowDag: parseJsonValue<WorkflowRun["workflowDag"] | undefined>(row["workflow_dag"], undefined),
    status: row["status"] as WorkflowRun["status"],
    startedAt: new Date(String(row["started_at"])).toISOString(),
    completedAt: row["ended_at"] ? new Date(String(row["ended_at"])).toISOString() : undefined,
    input: parseJsonValue<Record<string, unknown>>(row["input"], {}),
    output: parseJsonValue<Record<string, unknown> | undefined>(row["output"], undefined),
    runtimeState: parseJsonValue<WorkflowRun["runtimeState"] | undefined>(row["runtime_state_json"], undefined),
    error: typeof row["error"] === "string" ? row["error"] : undefined,
    failureReason: typeof row["failure_reason"] === "string" ? row["failure_reason"] : undefined,
    failedAt: row["failed_at"] ? new Date(String(row["failed_at"])).toISOString() : undefined,
    userId: typeof row["user_id"] === "string" ? row["user_id"] : undefined,
    stepResults: [],
  };
}

async function loadStepResults(runId: string) {
  const grouped = await loadStepResultsByRunIds([runId]);
  return grouped.get(runId) ?? [];
}

async function loadStepResultsByRunIds(runIds: string[]) {
  const grouped = new Map<string, WorkflowRun["stepResults"]>();
  for (const runId of runIds) {
    grouped.set(runId, []);
  }

  if (runIds.length === 0) {
    return grouped;
  }

  const pool = getPostgresPool();
  const result = await pool.query(
    `
      SELECT run_id, step_id, step_name, status, output, duration_ms, error, agent_slot_results_json, cost_log_json, idempotency_key
      FROM step_results
      WHERE run_id = ANY($1::uuid[])
      ORDER BY run_id ASC, ordinal ASC
    `,
    [runIds]
  );

  for (const row of result.rows) {
    const runId = String(row.run_id);
    const stepResults = grouped.get(runId);
    if (!stepResults) {
      continue;
    }

    stepResults.push({
      stepId: String(row.step_id),
      stepName: String(row.step_name),
      status: row.status,
      output: parseJsonValue<Record<string, unknown>>(row.output, {}),
      durationMs: Number(row.duration_ms),
      error: typeof row.error === "string" ? row.error : undefined,
      agentSlotResults: parseJsonValue(row.agent_slot_results_json, undefined),
      costLog: parseJsonValue(row.cost_log_json, undefined),
      idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : undefined,
    });
  }

  return grouped;
}

async function writeStepResults(
  runId: string,
  stepResults: WorkflowRun["stepResults"],
  existingClient?: PoolClient
): Promise<void> {
  const pool = getPostgresPool();
  const client = existingClient ?? (await pool.connect());

  try {
    if (!existingClient) {
      await client.query("BEGIN");
    }
    await client.query("SELECT id FROM runs WHERE id = $1::uuid FOR UPDATE", [runId]);
    await client.query("DELETE FROM step_results WHERE run_id = $1::uuid", [runId]);

    for (const [index, result] of stepResults.entries()) {
      await client.query(
        `
          INSERT INTO step_results (
            run_id, step_id, step_name, status, output, cost_cents, duration_ms, error,
            agent_slot_results_json, cost_log_json, ordinal, idempotency_key
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
          ON CONFLICT (run_id, step_id, ordinal) DO UPDATE
          SET step_name = EXCLUDED.step_name,
              status = EXCLUDED.status,
              output = EXCLUDED.output,
              cost_cents = EXCLUDED.cost_cents,
              duration_ms = EXCLUDED.duration_ms,
              error = EXCLUDED.error,
              agent_slot_results_json = EXCLUDED.agent_slot_results_json,
              cost_log_json = EXCLUDED.cost_log_json,
              idempotency_key = COALESCE(step_results.idempotency_key, EXCLUDED.idempotency_key)
        `,
        [
          runId,
          result.stepId,
          result.stepName,
          result.status,
          serializeJson(result.output),
          costCentsFor(result),
          result.durationMs,
          result.error ?? null,
          serializeJson(result.agentSlotResults),
          serializeJson(result.costLog),
          index,
          result.idempotencyKey ?? null,
        ]
      );
    }

    if (!existingClient) {
      await client.query("COMMIT");
    }
  } catch (error) {
    if (!existingClient) {
      await rollbackQuietly(client);
    }
    throw error;
  } finally {
    if (!existingClient) {
      client.release();
    }
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original persistence error if rollback also fails.
  }
}

async function setWorkspaceSession(client: PoolClient, run: WorkflowRun): Promise<void> {
  const workspaceId = resolveWorkspaceId(run);
  if (!workspaceId) {
    return;
  }

  await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
  if (run.userId) {
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [run.userId]);
  }
}

async function ensureWorkflowVersion(
  client: PoolClient,
  run: WorkflowRun
): Promise<{
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  workflowDag: Record<string, unknown>;
}> {
  const workspaceId = resolveWorkspaceId(run) ?? null;
  const dag = buildWorkflowDag(run);
  const workflowResult = await client.query(
    workspaceId
      ? `
          INSERT INTO workflows (workspace_id, external_template_id, name)
          VALUES ($1::uuid, $2, $3)
          ON CONFLICT (workspace_id, external_template_id)
          WHERE workspace_id IS NOT NULL AND external_template_id IS NOT NULL
          DO UPDATE SET name = EXCLUDED.name, updated_at = now()
          RETURNING id
        `
      : `
          INSERT INTO workflows (workspace_id, external_template_id, name)
          VALUES (NULL, $2, $3)
          ON CONFLICT (external_template_id)
          WHERE workspace_id IS NULL AND external_template_id IS NOT NULL
          DO UPDATE SET name = EXCLUDED.name, updated_at = now()
          RETURNING id
        `,
    [workspaceId, run.templateId, run.templateName]
  );
  const workflowId = String(workflowResult.rows[0].id);

  const existingVersion = await client.query(
    `
      SELECT id, version
      FROM workflow_versions
      WHERE workflow_id = $1::uuid
        AND dag = $2::jsonb
      ORDER BY version DESC
      LIMIT 1
    `,
    [workflowId, serializeJson(dag)]
  );

  if (existingVersion.rows[0]) {
    const versionId = String(existingVersion.rows[0].id);
    const version = Number(existingVersion.rows[0].version);
    await client.query(
      "UPDATE workflows SET latest_version_id = $2::uuid, updated_at = now() WHERE id = $1::uuid",
      [workflowId, versionId]
    );
    return { workflowId, workflowVersionId: versionId, workflowVersion: version, workflowDag: dag };
  }

  const maxVersion = await client.query(
    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM workflow_versions WHERE workflow_id = $1::uuid",
    [workflowId]
  );
  const nextVersion = Number(maxVersion.rows[0].next_version);
  const insertedVersion = await client.query(
    `
      INSERT INTO workflow_versions (workflow_id, version, dag, created_by_user_id)
      VALUES ($1::uuid, $2, $3::jsonb, $4)
      RETURNING id, version
    `,
    [workflowId, nextVersion, serializeJson(dag), run.userId ?? null]
  );
  const versionId = String(insertedVersion.rows[0].id);

  await client.query(
    "UPDATE workflows SET latest_version_id = $2::uuid, updated_at = now() WHERE id = $1::uuid",
    [workflowId, versionId]
  );

  return { workflowId, workflowVersionId: versionId, workflowVersion: nextVersion, workflowDag: dag };
}

export const runStore = {
  async create(run: WorkflowRun): Promise<WorkflowRun> {
    const cloned = cloneRun(run);
    memoryStore.set(cloned.id, cloned);

    if (!postgresPersistenceAvailable()) {
      return cloneRun(cloned);
    }

    try {
      const pool = getPostgresPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setWorkspaceSession(client, cloned);
        const version = await ensureWorkflowVersion(client, cloned);
        cloned.workspaceId = resolveWorkspaceId(cloned);
        cloned.workflowId = version.workflowId;
        cloned.workflowVersionId = version.workflowVersionId;
        cloned.workflowVersion = version.workflowVersion;
        cloned.workflowDag = version.workflowDag;

        await client.query(
        `
          INSERT INTO runs (
            id, workspace_id, routine_id, workflow_version_id, status, started_at, ended_at,
            input, output, runtime_state_json, error, user_id
          )
          VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
        `,
        [
          cloned.id,
          cloned.workspaceId ?? null,
          cloned.routineId ?? null,
          cloned.workflowVersionId,
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
        await writeStepResults(cloned.id, cloned.stepResults, client);
        await client.query("COMMIT");
        memoryStore.set(cloned.id, cloned);
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("[runStore] Postgres persist failed, using in-memory:", (err as Error).message);
    }
    return cloneRun(cloned);
  },

  async get(id: string): Promise<WorkflowRun | undefined> {
    const local = memoryStore.get(id);
    if (local) {
      return cloneRun(local);
    }
    if (!postgresPersistenceAvailable()) {
      return undefined;
    }

    try {
      const pool = getPostgresPool();
      const result = await pool.query(
        `
          SELECT
            r.id,
            r.workspace_id::text,
            r.routine_id::text,
            v.workflow_id::text,
            r.workflow_version_id::text,
            v.version AS workflow_version,
            v.dag AS workflow_dag,
            w.external_template_id AS template_id,
            w.name AS template_name,
            r.status,
            r.started_at,
            r.ended_at,
            r.input,
            r.output,
            r.runtime_state_json,
            r.error,
            r.failure_reason,
            r.failed_at,
            r.user_id
          FROM runs r
          JOIN workflow_versions v ON v.id = r.workflow_version_id
          JOIN workflows w ON w.id = v.workflow_id
          WHERE r.id = $1::uuid
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
    } catch (err) {
      console.error("[runStore] Postgres read failed, using in-memory:", (err as Error).message);
      return undefined;
    }
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

    memoryStore.set(id, updated);

    if (!postgresPersistenceAvailable()) {
      return cloneRun(updated);
    }

    try {
      const pool = getPostgresPool();
      await pool.query(
        `
          UPDATE runs
          SET status = $2,
              started_at = $3,
              ended_at = $4,
              input = $5::jsonb,
              output = $6::jsonb,
              runtime_state_json = $7::jsonb,
              error = $8,
              user_id = $9,
              updated_at = now()
          WHERE id = $1::uuid
        `,
        [
          id,
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
    } catch (err) {
      console.error("[runStore] Postgres persist failed, using in-memory:", (err as Error).message);
    }
    return cloneRun(updated);
  },

  async list(templateId?: string, userId?: string, status?: string): Promise<WorkflowRun[]> {
    const localRuns = () => {
      const runs = Array.from(memoryStore.values());
      return runs
        .filter((run) => (templateId ? run.templateId === templateId : true))
        .filter((run) => (userId ? run.userId === userId : true))
        .filter((run) => (status ? run.status === status : true))
        .map((run) => cloneRun(run));
    };

    if (!postgresPersistenceAvailable()) {
      return localRuns();
    }

    try {
      const pool = getPostgresPool();
      const result = await pool.query(
        `
          SELECT
            r.id,
            r.workspace_id::text,
            r.routine_id::text,
            v.workflow_id::text,
            r.workflow_version_id::text,
            v.version AS workflow_version,
            v.dag AS workflow_dag,
            w.external_template_id AS template_id,
            w.name AS template_name,
            r.status,
            r.started_at,
            r.ended_at,
            r.input,
            r.output,
            r.runtime_state_json,
            r.error,
            r.failure_reason,
            r.failed_at,
            r.user_id
          FROM runs r
          JOIN workflow_versions v ON v.id = r.workflow_version_id
          JOIN workflows w ON w.id = v.workflow_id
          WHERE ($1::text IS NULL OR w.external_template_id = $1)
            AND ($2::text IS NULL OR r.user_id = $2)
            AND ($3::text IS NULL OR r.status = $3)
          ORDER BY r.started_at DESC
        `,
        [templateId ?? null, userId ?? null, status ?? null]
      );

      const runs = result.rows.map((row) => mapRowToRun(row));
      const stepResultsByRunId = await loadStepResultsByRunIds(runs.map((run) => run.id));
      for (const run of runs) {
        run.stepResults = stepResultsByRunId.get(run.id) ?? [];
      }

      return runs;
    } catch (err) {
      console.error("[runStore] Postgres read failed, falling back to in-memory:", (err as Error).message);
      return localRuns();
    }
  },

  async countByWorkspaceCurrentMonth(workspaceId: string): Promise<number> {
    const yearMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

    const memoryCount = () =>
      Array.from(memoryStore.values()).filter((run) => {
        const ws = resolveWorkspaceId(run);
        return ws === workspaceId && run.startedAt.startsWith(yearMonth);
      }).length;

    if (!postgresPersistenceAvailable()) {
      return memoryCount();
    }

    try {
      const pool = getPostgresPool();
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM runs WHERE workspace_id = $1 AND started_at >= date_trunc('month', now())`,
        [workspaceId],
      );
      return Number(result.rows[0]?.count ?? 0);
    } catch (err) {
      console.error("[runStore] countByWorkspaceCurrentMonth postgres failed, using in-memory:", (err as Error).message);
      return memoryCount();
    }
  },

  async clear(): Promise<void> {
    memoryStore.clear();

    if (!postgresPersistenceAvailable()) {
      return;
    }

    try {
      const pool = getPostgresPool();
      await pool.query("DELETE FROM runs");
    } catch (err) {
      console.error("[runStore] Postgres clear failed:", (err as Error).message);
    }
  },

  async markFailed(id: string, reason: string): Promise<WorkflowRun | undefined> {
    const now = new Date().toISOString();
    const existing = memoryStore.get(id);
    if (existing) {
      existing.status = "failed";
      existing.failureReason = reason;
      existing.failedAt = now;
      existing.completedAt = now;
      memoryStore.set(id, existing);
    }

    if (!postgresPersistenceAvailable()) {
      return existing ? cloneRun(existing) : undefined;
    }

    try {
      const pool = getPostgresPool();
      await pool.query(
        `UPDATE runs
            SET status = 'failed',
                failure_reason = $2,
                failed_at = now(),
                ended_at = COALESCE(ended_at, now()),
                updated_at = now()
          WHERE id = $1::uuid`,
        [id, reason]
      );
    } catch (err) {
      console.error("[runStore] markFailed Postgres update failed:", (err as Error).message);
    }

    return this.get(id);
  },
};
