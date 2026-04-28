/**
 * Workspace context setter for PostgreSQL Row-Level Security.
 *
 * Sets `app.current_workspace_id` and `app.current_user_id` as PostgreSQL
 * session variables using SET LOCAL inside a transaction, so the values are
 * scoped to the transaction and cannot leak to other requests via connection
 * pool reuse.
 *
 * ALT-1915 Phase 1.1
 */

import { Pool, PoolClient } from "pg";

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
}

/**
 * Acquires a connection from the pool and sets workspace context variables
 * inside a transaction using SET LOCAL. The caller receives a PoolClient
 * that already has BEGIN executed and context variables set.
 *
 * The caller MUST call `commitWorkspaceTransaction` or
 * `rollbackWorkspaceTransaction` when done to release the connection.
 *
 * Using SET LOCAL ensures the session variables are automatically cleared
 * when the transaction ends, preventing state leakage with pg.Pool.
 */
export async function beginWorkspaceTransaction(
  pool: Pool,
  context: WorkspaceContext,
): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [
      context.workspaceId,
    ]);
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [
      context.userId,
    ]);
    return client;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Swallow rollback error; original error is more important
    }
    client.release();
    throw err;
  }
}

/**
 * Commits the workspace-scoped transaction and releases the connection
 * back to the pool. SET LOCAL variables are automatically cleared.
 */
export async function commitWorkspaceTransaction(client: PoolClient): Promise<void> {
  try {
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

/**
 * Rolls back the workspace-scoped transaction and releases the connection.
 */
export async function rollbackWorkspaceTransaction(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

/**
 * Convenience wrapper: executes a callback within a workspace-scoped
 * transaction. Automatically commits on success, rolls back on error.
 *
 * Example:
 *   const leads = await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
 *     const result = await client.query("SELECT * FROM leads");
 *     return result.rows;
 *   });
 */
export async function withWorkspaceContext<T>(
  pool: Pool,
  context: WorkspaceContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await beginWorkspaceTransaction(pool, context);
  try {
    const result = await fn(client);
    await commitWorkspaceTransaction(client);
    return result;
  } catch (err) {
    await rollbackWorkspaceTransaction(client);
    throw err;
  }
}
