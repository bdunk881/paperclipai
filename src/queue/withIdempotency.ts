import { createHash } from "crypto";
import { Pool } from "pg";
import { parseJsonValue } from "../db/json";

export function deriveIdempotencyKey(
  runId: string,
  stepIndex: number,
  workflowVersionId?: string
): string {
  const raw = workflowVersionId
    ? `${runId}:${stepIndex}:${workflowVersionId}`
    : `${runId}:${stepIndex}`;
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Wraps a step function with idempotency: if step_results already contains a
 * row for this key the cached output is returned without re-executing fn.
 */
export async function withIdempotency<T>(
  pool: Pool,
  idempotencyKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const hit = await pool.query<{ output: unknown }>(
    "SELECT output FROM step_results WHERE idempotency_key = $1 LIMIT 1",
    [idempotencyKey]
  );
  if (hit.rows[0] !== undefined) {
    return parseJsonValue<T>(hit.rows[0].output, {} as T);
  }
  return fn();
}
