/**
 * Run-batch store (HEL-702).
 *
 * A batch groups N durable workflow runs fanned out over N inputs (see
 * {@link triggerBatch}). This store owns the `run_batches` table only — the runs
 * themselves live in `runs` (via {@link runStore}); a batch just holds their ids
 * so a caller can track the set with one handle. Batch *status* is computed by
 * the API route from {@link runStore.listByIds}(`run_ids`), not stored here, so
 * the row is immutable after creation.
 *
 * Mirrors `runStore`'s proven Postgres-or-in-memory posture: writes set the
 * workspace session inside their transaction (so the FORCE-RLS WITH CHECK passes
 * on any path that drops to the autoflow_api role); reads use a plain pooled
 * query with an explicit `workspace_id` filter (tenant isolation at the SQL
 * level, exactly like `runStore.get/list`). Falls back to an in-memory map for
 * tests / local dev without a database.
 */

import { PoolClient } from "pg";
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
} from "../db/postgres";

export interface RunBatch {
  id: string;
  workspaceId: string;
  /** The workflow version every run in the batch executed (all share one). */
  workflowVersionId?: string;
  /** The workflow's external template id (the `templateId` callers pass). */
  externalTemplateId?: string;
  name: string;
  total: number;
  /** Ids of the runs in this batch (each a row in `runs`). */
  runIds: string[];
  /** True when triggered as a dry run (HEL-786): every run no-ops side effects. */
  dryRun: boolean;
  createdByUserId?: string;
  createdAt: string;
}

// allowlist: in-process registry / runtime state (not customer data)
const memoryStore = new Map<string, RunBatch>();

function postgresPersistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("batchStore requires DATABASE_URL outside development/test.");
}

function cloneBatch(batch: RunBatch): RunBatch {
  return { ...batch, runIds: [...batch.runIds] };
}

function mapRow(row: Record<string, unknown>): RunBatch {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    workflowVersionId:
      typeof row["workflow_version_id"] === "string" ? row["workflow_version_id"] : undefined,
    externalTemplateId:
      typeof row["external_template_id"] === "string" ? row["external_template_id"] : undefined,
    name: String(row["name"]),
    total: Number(row["total"]),
    runIds: Array.isArray(row["run_ids"]) ? (row["run_ids"] as unknown[]).map(String) : [],
    dryRun: row["dry_run"] === true,
    createdByUserId:
      typeof row["created_by_user_id"] === "string" ? row["created_by_user_id"] : undefined,
    createdAt: new Date(String(row["created_at"])).toISOString(),
  };
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original persistence error if rollback also fails.
  }
}

const SELECT_COLUMNS = `
  id::text,
  workspace_id::text,
  workflow_version_id::text,
  external_template_id,
  name,
  total,
  run_ids::text[] AS run_ids,
  dry_run,
  created_by_user_id::text,
  created_at
`;

export const batchStore = {
  async create(batch: RunBatch): Promise<RunBatch> {
    const cloned = cloneBatch(batch);
    memoryStore.set(cloned.id, cloned);

    if (!postgresPersistenceAvailable()) {
      return cloneBatch(cloned);
    }

    try {
      const pool = getPostgresPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Mirror runStore.create: set the workspace (+ user) session so the
        // FORCE-RLS WITH CHECK passes on any path enforcing policies.
        await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [
          cloned.workspaceId,
        ]);
        if (cloned.createdByUserId) {
          await client.query("SELECT set_config('app.current_user_id', $1, true)", [
            cloned.createdByUserId,
          ]);
        }
        await client.query(
          `
            INSERT INTO run_batches (
              id, workspace_id, workflow_version_id, external_template_id,
              name, total, run_ids, dry_run, created_by_user_id, created_at
            )
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid[], $8, $9::uuid, $10)
          `,
          [
            cloned.id,
            cloned.workspaceId,
            cloned.workflowVersionId ?? null,
            cloned.externalTemplateId ?? null,
            cloned.name,
            cloned.total,
            cloned.runIds,
            cloned.dryRun,
            cloned.createdByUserId ?? null,
            cloned.createdAt,
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(
        "[batchStore] Postgres persist failed, using in-memory:",
        (err as Error).message,
      );
    }
    return cloneBatch(cloned);
  },

  async get(id: string, workspaceId?: string): Promise<RunBatch | undefined> {
    const local = memoryStore.get(id);
    if (local) {
      if (workspaceId && local.workspaceId !== workspaceId) {
        return undefined;
      }
      return cloneBatch(local);
    }

    if (!postgresPersistenceAvailable()) {
      return undefined;
    }

    try {
      const pool = getPostgresPool();
      const result = await pool.query(
        `
          SELECT ${SELECT_COLUMNS}
          FROM run_batches
          WHERE id = $1::uuid
            AND ($2::text IS NULL OR workspace_id::text = $2)
          LIMIT 1
        `,
        [id, workspaceId ?? null],
      );
      const row = result.rows[0];
      return row ? mapRow(row) : undefined;
    } catch (err) {
      console.error("[batchStore] Postgres read failed:", (err as Error).message);
      return undefined;
    }
  },

  async list(workspaceId: string, limit = 50): Promise<RunBatch[]> {
    const localBatches = () =>
      Array.from(memoryStore.values())
        .filter((batch) => batch.workspaceId === workspaceId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, limit)
        .map(cloneBatch);

    if (!postgresPersistenceAvailable()) {
      return localBatches();
    }

    try {
      const pool = getPostgresPool();
      const result = await pool.query(
        `
          SELECT ${SELECT_COLUMNS}
          FROM run_batches
          WHERE workspace_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [workspaceId, limit],
      );
      return result.rows.map(mapRow);
    } catch (err) {
      console.error(
        "[batchStore] Postgres list failed, falling back to in-memory:",
        (err as Error).message,
      );
      return localBatches();
    }
  },

  async clear(): Promise<void> {
    memoryStore.clear();

    if (!postgresPersistenceAvailable()) {
      return;
    }

    try {
      const pool = getPostgresPool();
      await pool.query("DELETE FROM run_batches");
    } catch (err) {
      console.error("[batchStore] Postgres clear failed:", (err as Error).message);
    }
  },
};
