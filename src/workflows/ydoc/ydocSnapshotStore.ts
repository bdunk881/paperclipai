/**
 * HEL-286 — durable mirror of in-process Y.Docs.
 *
 * Single row per workflow keyed by workflow_id. `state` is the binary
 * Y.encodeStateAsUpdate output (full state, not deltas). All reads + writes
 * use withWorkspaceContext so RLS scopes the row by workspace_id.
 */

import type { Pool } from "pg";
import { withWorkspaceContext } from "../../middleware/workspaceContext";

export interface YDocSnapshot {
  state: Uint8Array;
  version: number;
}

export interface YDocSnapshotStore {
  load(
    workflowId: string,
    workspaceId: string,
    userId: string,
  ): Promise<YDocSnapshot | null>;
  save(
    workflowId: string,
    workspaceId: string,
    userId: string,
    state: Uint8Array,
  ): Promise<void>;
}

export function createYDocSnapshotStore(pool: Pool): YDocSnapshotStore {
  return {
    async load(workflowId, workspaceId, userId) {
      return withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        const result = await client.query<{ state: Buffer; version: number }>(
          `SELECT state, version
             FROM workflow_ydoc_snapshots
            WHERE workflow_id = $1
            LIMIT 1`,
          [workflowId],
        );
        const row = result.rows[0];
        if (!row) return null;
        return {
          state: new Uint8Array(row.state.buffer, row.state.byteOffset, row.state.byteLength),
          version: row.version,
        };
      });
    },

    async save(workflowId, workspaceId, userId, state) {
      const buffer = Buffer.from(state);
      await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
        await client.query(
          `INSERT INTO workflow_ydoc_snapshots (workflow_id, workspace_id, state, version, updated_at)
             VALUES ($1, $2, $3, 1, now())
           ON CONFLICT (workflow_id) DO UPDATE
             SET state      = EXCLUDED.state,
                 version    = workflow_ydoc_snapshots.version + 1,
                 updated_at = now()`,
          [workflowId, workspaceId, buffer],
        );
      });
    },
  };
}
