/**
 * Eval-run store (HEL-776).
 *
 * An eval is a thin layer over a dry-run batch (HEL-702/786): this store owns the
 * `eval_runs` table, which references the batch by id and holds the per-row
 * EXPECTED outputs (a JSON array parallel to the batch's `run_ids`). Scoring is
 * computed on read by the API route from {@link buildEvalRows} — not stored — so
 * the row is immutable after creation.
 *
 * Mirrors `batchStore` / `runStore`'s Postgres-or-in-memory posture: writes set
 * the workspace session inside their transaction; reads use a plain pooled query
 * with an explicit `workspace_id` filter.
 */

import { PoolClient } from "pg";
import { parseJsonValue, serializeJson } from "../db/json";
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
} from "../db/postgres";

export interface EvalRun {
  id: string;
  workspaceId: string;
  /** The dry-run batch (run_batches.id) that fanned the dataset out. */
  batchId: string;
  externalTemplateId?: string;
  name: string;
  /** Per-row expected outputs, parallel to the batch's run_ids. */
  expected: unknown[];
  createdByUserId?: string;
  createdAt: string;
}

// allowlist: in-process registry / runtime state (not customer data)
const memoryStore = new Map<string, EvalRun>();

function postgresPersistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("evalStore requires DATABASE_URL outside development/test.");
}

function cloneEval(run: EvalRun): EvalRun {
  return { ...run, expected: [...run.expected] };
}

function mapRow(row: Record<string, unknown>): EvalRun {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    batchId: String(row["batch_id"]),
    externalTemplateId:
      typeof row["external_template_id"] === "string" ? row["external_template_id"] : undefined,
    name: String(row["name"]),
    expected: parseJsonValue<unknown[]>(row["expected"], []),
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
  batch_id::text,
  external_template_id,
  name,
  expected,
  created_by_user_id::text,
  created_at
`;

export const evalStore = {
  async create(run: EvalRun): Promise<EvalRun> {
    const cloned = cloneEval(run);
    memoryStore.set(cloned.id, cloned);

    if (!postgresPersistenceAvailable()) {
      return cloneEval(cloned);
    }

    try {
      const pool = getPostgresPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
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
            INSERT INTO eval_runs (
              id, workspace_id, batch_id, external_template_id,
              name, expected, created_by_user_id, created_at
            )
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7::uuid, $8)
          `,
          [
            cloned.id,
            cloned.workspaceId,
            cloned.batchId,
            cloned.externalTemplateId ?? null,
            cloned.name,
            serializeJson(cloned.expected),
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
      console.error("[evalStore] Postgres persist failed, using in-memory:", (err as Error).message);
    }
    return cloneEval(cloned);
  },

  async get(id: string, workspaceId?: string): Promise<EvalRun | undefined> {
    const local = memoryStore.get(id);
    if (local) {
      if (workspaceId && local.workspaceId !== workspaceId) {
        return undefined;
      }
      return cloneEval(local);
    }

    if (!postgresPersistenceAvailable()) {
      return undefined;
    }

    try {
      const pool = getPostgresPool();
      const result = await pool.query(
        `
          SELECT ${SELECT_COLUMNS}
          FROM eval_runs
          WHERE id = $1::uuid
            AND ($2::text IS NULL OR workspace_id::text = $2)
          LIMIT 1
        `,
        [id, workspaceId ?? null],
      );
      const row = result.rows[0];
      return row ? mapRow(row) : undefined;
    } catch (err) {
      console.error("[evalStore] Postgres read failed:", (err as Error).message);
      return undefined;
    }
  },

  async list(workspaceId: string, limit = 50): Promise<EvalRun[]> {
    const localRuns = () =>
      Array.from(memoryStore.values())
        .filter((run) => run.workspaceId === workspaceId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, limit)
        .map(cloneEval);

    if (!postgresPersistenceAvailable()) {
      return localRuns();
    }

    try {
      const pool = getPostgresPool();
      const result = await pool.query(
        `
          SELECT ${SELECT_COLUMNS}
          FROM eval_runs
          WHERE workspace_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [workspaceId, limit],
      );
      return result.rows.map(mapRow);
    } catch (err) {
      console.error(
        "[evalStore] Postgres list failed, falling back to in-memory:",
        (err as Error).message,
      );
      return localRuns();
    }
  },

  async clear(): Promise<void> {
    memoryStore.clear();

    if (!postgresPersistenceAvailable()) {
      return;
    }

    try {
      const pool = getPostgresPool();
      await pool.query("DELETE FROM eval_runs");
    } catch (err) {
      console.error("[evalStore] Postgres clear failed:", (err as Error).message);
    }
  },
};
