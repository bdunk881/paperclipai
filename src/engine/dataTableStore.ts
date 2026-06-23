/**
 * HEL-812 (parent HEL-713): per-workspace data tables — workflow state store.
 *
 * User-defined tables + rows so a workflow can persist state across runs without
 * an external DB (the n8n "Data Tables" pattern): insert / upsert (by row_key) /
 * query. Postgres-backed when configured; an in-memory mirror serves
 * inMemoryAllowed() environments (tests / local dev without a DB). Every method
 * is workspace-scoped — that WHERE clause is the live tenancy filter (the backend
 * connects BYPASSRLS; migration 117's RLS is defense-in-depth).
 */

import { randomUUID } from "crypto";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

export interface DataTable {
  id: string;
  name: string;
}

export interface DataTableRow {
  id: string;
  rowKey: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QueryRowsOptions {
  /** jsonb-containment filter: a row matches when its `data` ⊇ `filter`. */
  filter?: Record<string, unknown>;
  limit?: number;
}

interface MemRow {
  id: string;
  rowKey: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
interface MemTable {
  id: string;
  workspaceId: string;
  name: string;
  rows: Map<string, MemRow>;
}

// allowlist: in-memory mirror of Postgres-backed data tables (dev/test without a DB)
const memTables = new Map<string, MemTable>();

function memKey(workspaceId: string, name: string): string {
  return `${workspaceId}:${name}`;
}

function postgresPersistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("dataTableStore requires DATABASE_URL outside development/test.");
}

interface RowDbShape {
  id: string;
  row_key: string | null;
  data: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRow(r: RowDbShape): DataTableRow {
  return {
    id: r.id,
    rowKey: r.row_key,
    data: r.data ?? {},
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function shallowContains(data: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => JSON.stringify(data[k]) === JSON.stringify(v));
}

async function createOrGetTable(workspaceId: string, name: string): Promise<DataTable> {
  if (!postgresPersistenceAvailable()) {
    const key = memKey(workspaceId, name);
    let table = memTables.get(key);
    if (!table) {
      table = { id: randomUUID(), workspaceId, name, rows: new Map() };
      memTables.set(key, table);
    }
    return { id: table.id, name: table.name };
  }
  const pool = getPostgresPool();
  const res = await pool.query<{ id: string; name: string }>(
    `INSERT INTO data_tables (id, workspace_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text, name`,
    [randomUUID(), workspaceId, name],
  );
  return { id: res.rows[0]!.id, name: res.rows[0]!.name };
}

export const dataTableStore = {
  createOrGetTable,

  async insertRow(
    workspaceId: string,
    name: string,
    data: Record<string, unknown>,
  ): Promise<DataTableRow> {
    const table = await createOrGetTable(workspaceId, name);
    if (!postgresPersistenceAvailable()) {
      const now = new Date().toISOString();
      const row: MemRow = { id: randomUUID(), rowKey: null, data, createdAt: now, updatedAt: now };
      memTables.get(memKey(workspaceId, name))!.rows.set(row.id, row);
      return { ...row };
    }
    const pool = getPostgresPool();
    const res = await pool.query<RowDbShape>(
      `INSERT INTO data_table_rows (id, table_id, workspace_id, data)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id::text, row_key, data, created_at, updated_at`,
      [randomUUID(), table.id, workspaceId, JSON.stringify(data)],
    );
    return mapRow(res.rows[0]!);
  },

  async upsertRow(
    workspaceId: string,
    name: string,
    rowKey: string,
    data: Record<string, unknown>,
  ): Promise<DataTableRow> {
    const table = await createOrGetTable(workspaceId, name);
    if (!postgresPersistenceAvailable()) {
      const tbl = memTables.get(memKey(workspaceId, name))!;
      const now = new Date().toISOString();
      const existing = [...tbl.rows.values()].find((r) => r.rowKey === rowKey);
      if (existing) {
        existing.data = data;
        existing.updatedAt = now;
        return { ...existing };
      }
      const row: MemRow = { id: randomUUID(), rowKey, data, createdAt: now, updatedAt: now };
      tbl.rows.set(row.id, row);
      return { ...row };
    }
    const pool = getPostgresPool();
    const res = await pool.query<RowDbShape>(
      `INSERT INTO data_table_rows (id, table_id, workspace_id, row_key, data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (table_id, row_key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       RETURNING id::text, row_key, data, created_at, updated_at`,
      [randomUUID(), table.id, workspaceId, rowKey, JSON.stringify(data)],
    );
    return mapRow(res.rows[0]!);
  },

  async queryRows(
    workspaceId: string,
    name: string,
    opts: QueryRowsOptions = {},
  ): Promise<DataTableRow[]> {
    if (!postgresPersistenceAvailable()) {
      const tbl = memTables.get(memKey(workspaceId, name));
      if (!tbl) return [];
      let rows = [...tbl.rows.values()];
      if (opts.filter) rows = rows.filter((r) => shallowContains(r.data, opts.filter!));
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit);
      return rows.map((r) => ({ ...r }));
    }
    const pool = getPostgresPool();
    const params: unknown[] = [workspaceId, name];
    let sql = `SELECT r.id::text, r.row_key, r.data, r.created_at, r.updated_at
               FROM data_table_rows r
               JOIN data_tables t ON t.id = r.table_id
               WHERE t.workspace_id = $1 AND t.name = $2`;
    if (opts.filter && Object.keys(opts.filter).length > 0) {
      params.push(JSON.stringify(opts.filter));
      sql += ` AND r.data @> $${params.length}::jsonb`;
    }
    sql += ` ORDER BY r.created_at ASC`;
    if (opts.limit && opts.limit > 0) {
      params.push(opts.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const res = await pool.query<RowDbShape>(sql, params);
    return res.rows.map(mapRow);
  },

  async listTables(workspaceId: string): Promise<DataTable[]> {
    if (!postgresPersistenceAvailable()) {
      return [...memTables.values()]
        .filter((t) => t.workspaceId === workspaceId)
        .map((t) => ({ id: t.id, name: t.name }));
    }
    const pool = getPostgresPool();
    const res = await pool.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM data_tables WHERE workspace_id = $1 ORDER BY name ASC`,
      [workspaceId],
    );
    return res.rows.map((r) => ({ id: r.id, name: r.name }));
  },

  async __resetForTests(): Promise<void> {
    memTables.clear();
    if (!postgresPersistenceAvailable()) return;
    const pool = getPostgresPool();
    await pool.query(`DELETE FROM data_table_rows`);
    await pool.query(`DELETE FROM data_tables`);
  },
};
