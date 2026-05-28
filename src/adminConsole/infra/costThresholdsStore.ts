/**
 * admin_cost_thresholds repository (HEL infra follow-up).
 *
 * Surfaces CRUD + breach evaluation for the Cost tab's threshold UI.
 * All callers expected to come through requirePlatformAdmin upstream;
 * the unique constraint on (metric, bucket) WHERE disabled_at IS NULL
 * prevents the UI from creating duplicate active thresholds.
 */

import type { Pool, PoolClient } from "pg";

export type CostMetric = "openrouter";
export type CostBucket =
  | "trailing_24h"
  | "trailing_7d"
  | "trailing_30d"
  | "projected_daily"
  | "projected_monthly"
  | "balance_runway_days";

export const COST_BUCKETS: CostBucket[] = [
  "trailing_24h",
  "trailing_7d",
  "trailing_30d",
  "projected_daily",
  "projected_monthly",
  "balance_runway_days",
];

export const COST_METRICS: CostMetric[] = ["openrouter"];

export interface CostThreshold {
  id: string;
  metric: CostMetric;
  bucket: CostBucket;
  ceiling_value: number;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

interface CostThresholdRow {
  id: string;
  metric: CostMetric;
  bucket: CostBucket;
  ceiling_value: string;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

function toRecord(row: CostThresholdRow): CostThreshold {
  return {
    id: row.id,
    metric: row.metric,
    bucket: row.bucket,
    ceiling_value: Number(row.ceiling_value),
    note: row.note,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    disabled_at: row.disabled_at,
  };
}

export async function listActiveThresholds(
  conn: Pool | PoolClient,
): Promise<CostThreshold[]> {
  const result = await conn.query<CostThresholdRow>(
    `SELECT * FROM admin_cost_thresholds
      WHERE disabled_at IS NULL
      ORDER BY metric, bucket`,
  );
  return result.rows.map(toRecord);
}

export interface CreateThresholdInput {
  metric: CostMetric;
  bucket: CostBucket;
  ceilingValue: number;
  note?: string | null;
  createdBy: string;
}

export async function createThreshold(
  conn: Pool | PoolClient,
  input: CreateThresholdInput,
): Promise<CostThreshold> {
  const result = await conn.query<CostThresholdRow>(
    `INSERT INTO admin_cost_thresholds (metric, bucket, ceiling_value, note, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
    [input.metric, input.bucket, input.ceilingValue, input.note ?? null, input.createdBy],
  );
  return toRecord(result.rows[0]);
}

export async function updateThreshold(
  conn: Pool | PoolClient,
  input: { id: string; ceilingValue?: number; note?: string | null },
): Promise<CostThreshold | null> {
  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  if (input.ceilingValue !== undefined) {
    sets.push(`ceiling_value = $${i++}`);
    args.push(input.ceilingValue);
  }
  if (input.note !== undefined) {
    sets.push(`note = $${i++}`);
    args.push(input.note);
  }
  if (sets.length === 0) {
    const cur = await conn.query<CostThresholdRow>(
      `SELECT * FROM admin_cost_thresholds WHERE id = $1`,
      [input.id],
    );
    return cur.rows[0] ? toRecord(cur.rows[0]) : null;
  }
  sets.push(`updated_at = NOW()`);
  args.push(input.id);
  const result = await conn.query<CostThresholdRow>(
    `UPDATE admin_cost_thresholds
        SET ${sets.join(", ")}
      WHERE id = $${i}
      RETURNING *`,
    args,
  );
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

export async function disableThreshold(
  conn: Pool | PoolClient,
  id: string,
): Promise<boolean> {
  const result = await conn.query(
    `UPDATE admin_cost_thresholds
        SET disabled_at = NOW()
      WHERE id = $1 AND disabled_at IS NULL`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---- Breach evaluation -----------------------------------------------------

/**
 * Reads a numeric value from a metric+bucket pair, given the payload the
 * cost reads endpoint already produces. Centralized so the route layer
 * doesn't replicate the shape lookup.
 */
export function readMetricValue(
  metric: CostMetric,
  bucket: CostBucket,
  payload: Record<string, unknown>,
): number | null {
  if (metric !== "openrouter") return null;
  const openrouter = payload.openrouter as Record<string, unknown> | undefined;
  if (!openrouter) return null;
  switch (bucket) {
    case "trailing_24h": {
      const w = openrouter.trailing_24h as { spend_usd?: number } | undefined;
      return w?.spend_usd ?? null;
    }
    case "trailing_7d": {
      const w = openrouter.trailing_7d as { spend_usd?: number } | undefined;
      return w?.spend_usd ?? null;
    }
    case "trailing_30d": {
      const w = openrouter.trailing_30d as { spend_usd?: number } | undefined;
      return w?.spend_usd ?? null;
    }
    case "projected_daily":
      return typeof openrouter.projected_daily_usd === "number"
        ? (openrouter.projected_daily_usd as number)
        : null;
    case "projected_monthly":
      return typeof openrouter.projected_monthly_usd === "number"
        ? (openrouter.projected_monthly_usd as number)
        : null;
    case "balance_runway_days": {
      const balance = openrouter.prepaid_balance_usd as number | null | undefined;
      const projected = openrouter.projected_daily_usd as number | undefined;
      if (balance === null || balance === undefined || !projected || projected <= 0) return null;
      return balance / projected;
    }
    default:
      return null;
  }
}

export interface BreachStatus {
  threshold_id: string;
  metric: CostMetric;
  bucket: CostBucket;
  ceiling_value: number;
  observed_value: number | null;
  breached: boolean;
  /**
   * Runway is "breached when below the ceiling" rather than above. The
   * routes layer uses this to render the right banner copy.
   */
  direction: "above_ceiling_breaches" | "below_ceiling_breaches";
  note: string | null;
}

function directionForBucket(bucket: CostBucket): BreachStatus["direction"] {
  return bucket === "balance_runway_days"
    ? "below_ceiling_breaches"
    : "above_ceiling_breaches";
}

export function evaluateBreaches(
  thresholds: CostThreshold[],
  costPayload: Record<string, unknown>,
): BreachStatus[] {
  return thresholds.map((t) => {
    const observed = readMetricValue(t.metric, t.bucket, costPayload);
    const direction = directionForBucket(t.bucket);
    let breached = false;
    if (observed !== null) {
      breached =
        direction === "above_ceiling_breaches"
          ? observed > t.ceiling_value
          : observed < t.ceiling_value;
    }
    return {
      threshold_id: t.id,
      metric: t.metric,
      bucket: t.bucket,
      ceiling_value: t.ceiling_value,
      observed_value: observed,
      breached,
      direction,
      note: t.note,
    };
  });
}
