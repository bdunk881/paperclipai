import { Pool, QueryResultRow } from "pg";

let pool: Pool | null = null;

export function isPostgresPersistenceEnabled(): boolean {
  if (process.env.AUTOFLOW_DISABLE_PG_PERSISTENCE === "1") {
    return false;
  }

  if (typeof process.env.JEST_WORKER_ID === "string") {
    return false;
  }

  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0;
}

export const isPostgresConfigured = isPostgresPersistenceEnabled;

export function getPostgresPool(): Pool {
  if (!isPostgresPersistenceEnabled()) {
    throw new Error("DATABASE_URL is required for PostgreSQL persistence");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }

  return pool;
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPostgresPool().query<T>(text, params);
}

export async function closePostgresPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
