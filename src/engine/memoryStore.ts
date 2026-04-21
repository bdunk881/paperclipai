/**
 * Persistent context memory store for AutoFlow.
 *
 * Uses PostgreSQL when available and falls back to the in-memory implementation
 * for tests or local runs without DATABASE_URL.
 */

import { v4 as uuidv4 } from "uuid";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";

export interface MemoryEntry {
  id: string;
  userId: string;
  workflowId?: string;
  workflowName?: string;
  agentId?: string;
  key: string;
  text: string;
  ttlSeconds?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface CreateMemoryInput {
  userId: string;
  workflowId?: string;
  workflowName?: string;
  agentId?: string;
  key: string;
  text: string;
  ttlSeconds?: number;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
}

const store = new Map<string, MemoryEntry>();

function isExpired(entry: MemoryEntry): boolean {
  if (!entry.expiresAt) return false;
  return new Date(entry.expiresAt) < new Date();
}

function purgeExpiredInMemory(): void {
  for (const [id, entry] of store.entries()) {
    if (isExpired(entry)) store.delete(id);
  }
}

function scoreEntry(entry: MemoryEntry, query: string): number {
  const haystack = `${entry.key} ${entry.text}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1);
  if (tokens.length === 0) return 1;
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length;
}

function mapRowToEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    workflowId: typeof row["workflow_id"] === "string" ? row["workflow_id"] : undefined,
    workflowName: typeof row["workflow_name"] === "string" ? row["workflow_name"] : undefined,
    agentId: typeof row["agent_id"] === "string" ? row["agent_id"] : undefined,
    key: String(row["key"]),
    text: String(row["text_value"]),
    ttlSeconds: typeof row["ttl_seconds"] === "number" ? row["ttl_seconds"] : undefined,
    createdAt: new Date(String(row["created_at"])).toISOString(),
    updatedAt: new Date(String(row["updated_at"])).toISOString(),
    expiresAt: row["expires_at"] ? new Date(String(row["expires_at"])).toISOString() : undefined,
  };
}

async function purgeExpiredInPostgres(): Promise<void> {
  const pool = getPostgresPool();
  await pool.query("DELETE FROM memory_entries WHERE expires_at IS NOT NULL AND expires_at < now()");
}

export const memoryStore = {
  async write(input: CreateMemoryInput): Promise<MemoryEntry> {
    const now = new Date().toISOString();
    const expiresAt =
      input.ttlSeconds !== undefined
        ? new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
        : undefined;

    if (!isPostgresPersistenceEnabled()) {
      purgeExpiredInMemory();

      const existing = Array.from(store.values()).find(
        (entry) =>
          entry.userId === input.userId &&
          entry.key === input.key &&
          (entry.workflowId ?? null) === (input.workflowId ?? null) &&
          (entry.agentId ?? null) === (input.agentId ?? null)
      );

      if (existing) {
        const updated: MemoryEntry = {
          ...existing,
          text: input.text,
          ttlSeconds: input.ttlSeconds,
          workflowName: input.workflowName ?? existing.workflowName,
          updatedAt: now,
          expiresAt,
        };
        store.set(existing.id, updated);
        return updated;
      }

      const entry: MemoryEntry = {
        id: uuidv4(),
        userId: input.userId,
        workflowId: input.workflowId,
        workflowName: input.workflowName,
        agentId: input.agentId,
        key: input.key,
        text: input.text,
        ttlSeconds: input.ttlSeconds,
        createdAt: now,
        updatedAt: now,
        expiresAt,
      };
      store.set(entry.id, entry);
      return entry;
    }

    await purgeExpiredInPostgres();
    const pool = getPostgresPool();
    const existing = await pool.query(
      `
        SELECT *
        FROM memory_entries
        WHERE user_id = $1
          AND key = $2
          AND workflow_id IS NOT DISTINCT FROM $3
          AND agent_id IS NOT DISTINCT FROM $4
        LIMIT 1
      `,
      [input.userId, input.key, input.workflowId ?? null, input.agentId ?? null]
    );

    if (existing.rows[0]) {
      const id = String(existing.rows[0].id);
      const result = await pool.query(
        `
          UPDATE memory_entries
          SET workflow_name = COALESCE($2, workflow_name),
              text_value = $3,
              ttl_seconds = $4,
              updated_at = $5,
              expires_at = $6
          WHERE id = $1
          RETURNING *
        `,
        [id, input.workflowName ?? null, input.text, input.ttlSeconds ?? null, now, expiresAt ?? null]
      );
      return mapRowToEntry(result.rows[0]);
    }

    const entryId = uuidv4();
    const result = await pool.query(
      `
        INSERT INTO memory_entries (
          id, user_id, workflow_id, workflow_name, agent_id, key, text_value,
          ttl_seconds, created_at, updated_at, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        entryId,
        input.userId,
        input.workflowId ?? null,
        input.workflowName ?? null,
        input.agentId ?? null,
        input.key,
        input.text,
        input.ttlSeconds ?? null,
        now,
        now,
        expiresAt ?? null,
      ]
    );
    return mapRowToEntry(result.rows[0]);
  },

  async search(query: string, userId: string, agentId?: string, limit = 10): Promise<SearchResult[]> {
    if (!isPostgresPersistenceEnabled()) {
      purgeExpiredInMemory();
      const candidates = Array.from(store.values()).filter(
        (entry) => entry.userId === userId && (!agentId || entry.agentId === agentId)
      );

      if (!query.trim()) {
        return candidates
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, limit)
          .map((entry) => ({ entry, score: 1 }));
      }

      return candidates
        .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
        .slice(0, limit);
    }

    await purgeExpiredInPostgres();
    const pool = getPostgresPool();
    const result = await pool.query(
      `
        SELECT *
        FROM memory_entries
        WHERE user_id = $1
          AND ($2::text IS NULL OR agent_id = $2)
        ORDER BY updated_at DESC
      `,
      [userId, agentId ?? null]
    );

    const entries = result.rows.map(mapRowToEntry);
    if (!query.trim()) {
      return entries.slice(0, limit).map((entry) => ({ entry, score: 1 }));
    }

    return entries
      .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
      .slice(0, limit);
  },

  async list(userId: string, workflowId?: string): Promise<MemoryEntry[]> {
    if (!isPostgresPersistenceEnabled()) {
      purgeExpiredInMemory();
      return Array.from(store.values()).filter(
        (entry) => entry.userId === userId && (!workflowId || entry.workflowId === workflowId)
      );
    }

    await purgeExpiredInPostgres();
    const pool = getPostgresPool();
    const result = await pool.query(
      `
        SELECT *
        FROM memory_entries
        WHERE user_id = $1
          AND ($2::text IS NULL OR workflow_id = $2)
        ORDER BY updated_at DESC
      `,
      [userId, workflowId ?? null]
    );
    return result.rows.map(mapRowToEntry);
  },

  async get(id: string): Promise<MemoryEntry | undefined> {
    if (!isPostgresPersistenceEnabled()) {
      purgeExpiredInMemory();
      const entry = store.get(id);
      if (entry && isExpired(entry)) {
        store.delete(id);
        return undefined;
      }
      return entry;
    }

    await purgeExpiredInPostgres();
    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM memory_entries WHERE id = $1", [id]);
    return result.rows[0] ? mapRowToEntry(result.rows[0]) : undefined;
  },

  async delete(id: string, userId: string): Promise<boolean> {
    if (!isPostgresPersistenceEnabled()) {
      const entry = store.get(id);
      if (!entry || entry.userId !== userId) return false;
      store.delete(id);
      return true;
    }

    const pool = getPostgresPool();
    const result = await pool.query("DELETE FROM memory_entries WHERE id = $1 AND user_id = $2", [id, userId]);
    return (result.rowCount ?? 0) > 0;
  },

  async stats(userId: string): Promise<{ totalEntries: number; totalBytes: number; workflowCount: number }> {
    if (!isPostgresPersistenceEnabled()) {
      purgeExpiredInMemory();
      const entries = Array.from(store.values()).filter((entry) => entry.userId === userId);
      const totalBytes = entries.reduce((acc, entry) => acc + entry.text.length + entry.key.length, 0);
      const workflowCount = new Set(entries.map((entry) => entry.workflowId).filter(Boolean)).size;
      return { totalEntries: entries.length, totalBytes, workflowCount };
    }

    await purgeExpiredInPostgres();
    const entries = await this.list(userId);
    const totalBytes = entries.reduce((acc, entry) => acc + entry.text.length + entry.key.length, 0);
    const workflowCount = new Set(entries.map((entry) => entry.workflowId).filter(Boolean)).size;
    return { totalEntries: entries.length, totalBytes, workflowCount };
  },

  async clear(): Promise<void> {
    store.clear();

    if (!isPostgresPersistenceEnabled()) {
      return;
    }

    const pool = getPostgresPool();
    await pool.query("DELETE FROM memory_entries");
  },
};
