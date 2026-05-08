import { Pool, QueryResultRow } from "pg";

let pool: Pool | null = null;
let lastConnectionStatus: boolean | null = null;

const IN_MEMORY_ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);

export function getRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NODE_ENV ?? "development").trim().toLowerCase();
}

export function inMemoryAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return IN_MEMORY_ALLOWED_ENVIRONMENTS.has(getRuntimeEnvironment(env));
}

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
  if (isPostgresPersistenceEnabled()) {
    if (!pool) {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30_000,
        statement_timeout: 30000,
      });
      pool.on("error", (err) => {
        console.error("[postgres] Unexpected pool error:", err.message);
      });
    }

    return pool;
  }

  if (inMemoryAllowed()) {
    throw new Error("DATABASE_URL is required for PostgreSQL persistence");
  }
  throw new Error("DATABASE_URL is required for PostgreSQL persistence outside development/test");
}

export async function checkPostgresConnection(): Promise<boolean> {
  if (isPostgresConfigured()) {
    try {
      await getPostgresPool().query("SELECT 1");
      lastConnectionStatus = true;
      return true;
    } catch (err) {
      console.error("[postgres] Connection check failed:", (err as Error).message);
      lastConnectionStatus = false;
      return false;
    }
  }

  lastConnectionStatus = false;
  return false;
}

export function getPostgresConnectionStatus(): boolean | null {
  return lastConnectionStatus;
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

export const closePostgresPoolForTests = closePostgresPool;
