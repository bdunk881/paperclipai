import { Pool, QueryResult, QueryResultRow } from "pg";

let pool: Pool | null = null;

export function isPostgresConfigured(): boolean {
  return (
    process.env.WORKFLOW_RUNTIME_PERSISTENCE_ENABLED === "1" &&
    typeof process.env.DATABASE_URL === "string" &&
    process.env.DATABASE_URL.trim().length > 0
  );
}

function getPool(): Pool {
  if (!isPostgresConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  return pool;
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function closePostgresPoolForTests(): Promise<void> {
  if (!pool) {
    return;
  }

  const currentPool = pool;
  pool = null;
  await currentPool.end();
}
