/**
 * Postgres inspector for the InfraData tab (HEL infra PR #5).
 *
 * Read-only queries against the runtime DB:
 *   - pg_stat_activity summary (states + per-state counts)
 *   - Top 10 longest-running queries (statement text + age)
 *   - Pool stats from node-postgres (.totalCount / .idleCount / .waitingCount)
 *   - DB size via pg_database_size
 *   - Hot-table row count estimates via pg_class.reltuples (cheap; exact
 *     counts on big tables are prohibitively expensive)
 *
 * Kill-query + flush-redis-pattern verbs land in PR #7 with requireAAL2.
 */

import { getPostgresPool, isPostgresConfigured } from "../../../db/postgres";

export interface PgPoolStats {
  total: number;
  idle: number;
  waiting: number;
  configured_max: number | null;
}

export interface PgActivitySummary {
  total: number;
  active: number;
  idle: number;
  idle_in_transaction: number;
  fastpath_function_call: number;
  disabled: number;
}

export interface PgLongQuery {
  pid: number;
  username: string | null;
  application_name: string | null;
  state: string | null;
  age_seconds: number;
  wait_event_type: string | null;
  wait_event: string | null;
  query_excerpt: string;
}

export interface PgHotTable {
  schema: string;
  name: string;
  approx_rows: number;
  size_bytes: number;
  total_size_bytes: number;
}

export interface PgInspectorView {
  available: boolean;
  pool: PgPoolStats | null;
  activity: PgActivitySummary | null;
  long_queries: PgLongQuery[];
  db_size_bytes: number | null;
  hot_tables: PgHotTable[];
  error?: string;
}

function poolStats(): PgPoolStats {
  const pool = getPostgresPool();
  // node-postgres exposes these as instance properties; widen the type to
  // expose them without depending on the private surface.
  const p = pool as unknown as {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
    options?: { max?: number };
  };
  return {
    total: p.totalCount,
    idle: p.idleCount,
    waiting: p.waitingCount,
    configured_max: p.options?.max ?? null,
  };
}

export async function inspectPostgres(): Promise<PgInspectorView> {
  if (!isPostgresConfigured()) {
    return {
      available: false,
      pool: null,
      activity: null,
      long_queries: [],
      db_size_bytes: null,
      hot_tables: [],
    };
  }

  const view: PgInspectorView = {
    available: true,
    pool: null,
    activity: null,
    long_queries: [],
    db_size_bytes: null,
    hot_tables: [],
  };

  try {
    view.pool = poolStats();
  } catch (err) {
    view.error = err instanceof Error ? err.message : String(err);
    return view;
  }

  const pool = getPostgresPool();

  const [activityRes, longRes, sizeRes, tablesRes] = await Promise.allSettled([
    pool.query<{
      total: string;
      active: string;
      idle: string;
      idle_in_transaction: string;
      fastpath_function_call: string;
      disabled: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE state = 'active')::text AS active,
         COUNT(*) FILTER (WHERE state = 'idle')::text AS idle,
         COUNT(*) FILTER (WHERE state = 'idle in transaction')::text AS idle_in_transaction,
         COUNT(*) FILTER (WHERE state = 'fastpath function call')::text AS fastpath_function_call,
         COUNT(*) FILTER (WHERE state = 'disabled')::text AS disabled
       FROM pg_stat_activity
       WHERE datname = current_database()`,
    ),
    pool.query<{
      pid: number;
      usename: string | null;
      application_name: string | null;
      state: string | null;
      age_seconds: string;
      wait_event_type: string | null;
      wait_event: string | null;
      query: string;
    }>(
      `SELECT
         pid,
         usename,
         application_name,
         state,
         EXTRACT(EPOCH FROM (NOW() - query_start))::text AS age_seconds,
         wait_event_type,
         wait_event,
         query
       FROM pg_stat_activity
       WHERE pid <> pg_backend_pid()
         AND state IS NOT NULL
         AND state != 'idle'
         AND query_start IS NOT NULL
       ORDER BY query_start ASC
       LIMIT 10`,
    ),
    pool.query<{ size_bytes: string }>(
      `SELECT pg_database_size(current_database())::text AS size_bytes`,
    ),
    pool.query<{
      schema: string;
      name: string;
      approx_rows: string;
      size_bytes: string;
      total_size_bytes: string;
    }>(
      `SELECT
         n.nspname AS schema,
         c.relname AS name,
         GREATEST(c.reltuples::bigint, 0)::text AS approx_rows,
         pg_relation_size(c.oid)::text AS size_bytes,
         pg_total_relation_size(c.oid)::text AS total_size_bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT 15`,
    ),
  ]);

  if (activityRes.status === "fulfilled") {
    const r = activityRes.value.rows[0];
    view.activity = {
      total: Number(r?.total ?? 0),
      active: Number(r?.active ?? 0),
      idle: Number(r?.idle ?? 0),
      idle_in_transaction: Number(r?.idle_in_transaction ?? 0),
      fastpath_function_call: Number(r?.fastpath_function_call ?? 0),
      disabled: Number(r?.disabled ?? 0),
    };
  }
  if (longRes.status === "fulfilled") {
    view.long_queries = longRes.value.rows.map((r) => ({
      pid: r.pid,
      username: r.usename,
      application_name: r.application_name,
      state: r.state,
      age_seconds: Math.round(Number(r.age_seconds ?? 0)),
      wait_event_type: r.wait_event_type,
      wait_event: r.wait_event,
      query_excerpt: (r.query ?? "").slice(0, 300),
    }));
  }
  if (sizeRes.status === "fulfilled") {
    view.db_size_bytes = Number(sizeRes.value.rows[0]?.size_bytes ?? 0);
  }
  if (tablesRes.status === "fulfilled") {
    view.hot_tables = tablesRes.value.rows.map((r) => ({
      schema: r.schema,
      name: r.name,
      approx_rows: Number(r.approx_rows ?? 0),
      size_bytes: Number(r.size_bytes ?? 0),
      total_size_bytes: Number(r.total_size_bytes ?? 0),
    }));
  }

  return view;
}
