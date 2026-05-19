/**
 * MCP server registry.
 *
 * DASH-50: every method is async and Postgres-backed via the `mcp_servers`
 * table (migration 042). Pre-DASH-50 the entire store lived in a single
 * in-process Map and was wiped on every Fly restart — the user's
 * registered MCP servers vanished after every deploy. The cache stays
 * as a hot-path read layer; cache miss falls back to the database.
 */

import { randomUUID } from "node:crypto";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

export interface McpServer {
  id: string;
  userId: string;
  name: string;
  /** Full base URL of the MCP server, e.g. https://mcp.example.com */
  url: string;
  /** Optional auth header name, e.g. "Authorization" */
  authHeaderKey?: string;
  /** Optional auth header value, e.g. "Bearer <token>" — stored in plaintext for MVP */
  authHeaderValue?: string;
  createdAt: string;
}

export type McpServerPublic = Omit<McpServer, "authHeaderValue"> & {
  hasAuth: boolean;
};

const cache = new Map<string, McpServer>();

function postgresAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("mcpStore requires DATABASE_URL outside development/test.");
}

interface McpServerRow {
  id: string;
  user_id: string;
  name: string;
  url: string;
  auth_header_key: string | null;
  auth_header_value: string | null;
  created_at: Date | string;
}

function mapRow(row: McpServerRow): McpServer {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    url: row.url,
    authHeaderKey: row.auth_header_key ?? undefined,
    authHeaderValue: row.auth_header_value ?? undefined,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function toPublic(s: McpServer): McpServerPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { authHeaderValue: _v, ...rest } = s;
  return { ...rest, hasAuth: Boolean(s.authHeaderKey && s.authHeaderValue) };
}

async function persistServer(server: McpServer): Promise<void> {
  if (!postgresAvailable()) return;
  await getPostgresPool().query(
    `INSERT INTO mcp_servers (id, user_id, name, url, auth_header_key, auth_header_value, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           url = EXCLUDED.url,
           auth_header_key = EXCLUDED.auth_header_key,
           auth_header_value = EXCLUDED.auth_header_value`,
    [
      server.id,
      server.userId,
      server.name,
      server.url,
      server.authHeaderKey ?? null,
      server.authHeaderValue ?? null,
      server.createdAt,
    ],
  );
}

async function loadByUser(userId: string): Promise<McpServer[]> {
  if (!postgresAvailable()) return [];
  const result = await getPostgresPool().query<McpServerRow>(
    `SELECT id, user_id, name, url, auth_header_key, auth_header_value, created_at
       FROM mcp_servers WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows.map(mapRow);
}

async function loadById(id: string): Promise<McpServer | undefined> {
  if (!postgresAvailable()) return undefined;
  const result = await getPostgresPool().query<McpServerRow>(
    `SELECT id, user_id, name, url, auth_header_key, auth_header_value, created_at
       FROM mcp_servers WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : undefined;
}

async function deletePersisted(id: string): Promise<void> {
  if (!postgresAvailable()) return;
  await getPostgresPool().query(`DELETE FROM mcp_servers WHERE id = $1`, [id]);
}

export const mcpStore = {
  async list(userId: string): Promise<McpServerPublic[]> {
    if (postgresAvailable()) {
      const persisted = await loadByUser(userId);
      for (const server of persisted) {
        cache.set(server.id, server);
      }
      return persisted.map(toPublic);
    }
    return [...cache.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toPublic);
  },

  async get(id: string): Promise<McpServer | undefined> {
    const cached = cache.get(id);
    if (cached) return cached;
    const persisted = await loadById(id);
    if (persisted) cache.set(persisted.id, persisted);
    return persisted;
  },

  async add(
    userId: string,
    fields: { name: string; url: string; authHeaderKey?: string; authHeaderValue?: string },
  ): Promise<McpServerPublic> {
    const server: McpServer = {
      id: randomUUID(),
      userId,
      name: fields.name.trim(),
      url: fields.url.trim().replace(/\/$/, ""),
      authHeaderKey: fields.authHeaderKey?.trim() || undefined,
      authHeaderValue: fields.authHeaderValue?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    cache.set(server.id, server);
    await persistServer(server);
    return toPublic(server);
  },

  async remove(id: string, userId: string): Promise<boolean> {
    const existing = cache.get(id) ?? (await loadById(id));
    if (!existing || existing.userId !== userId) return false;
    cache.delete(id);
    await deletePersisted(id);
    return true;
  },

  async _clear(): Promise<void> {
    cache.clear();
    if (!postgresAvailable()) return;
    await getPostgresPool().query(`DELETE FROM mcp_servers`);
  },
};
