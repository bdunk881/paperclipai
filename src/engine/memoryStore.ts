/**
 * Persistent context memory store for AutoFlow.
 *
 * Stores per-user/per-workflow/per-agent memory entries with optional TTL.
 * Implements lightweight keyword-relevance search as a development-friendly
 * substitute for a vector DB.
 *
 * DASH-44: previously this store was a single in-process `Map<>` with a
 * comment saying "Replace with a PostgreSQL-backed store for production".
 * That replacement is now this file. The `memory_entries` table was added
 * by migration 002 long ago; only the retention sweep ever touched it.
 * Every CRUD path delegated to memory, so every Fly restart wiped the
 * workspace Memory page clean.
 *
 * Methods are async + Postgres-aware. The in-memory fallback only fires
 * in `inMemoryAllowed()` environments (tests, local dev without DB) —
 * HEL-80 guarantees production fails fast without DATABASE_URL.
 */

import { randomUUID } from "node:crypto";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  /** Scoping key: user or service that owns this entry */
  userId: string;
  /** Optional: scoped to a specific workflow */
  workflowId?: string;
  workflowName?: string;
  /** Optional: scoped to a specific agent within a workflow */
  agentId?: string;
  /** Logical name for this piece of memory */
  key: string;
  /** Free-text value (stringified JSON is fine) */
  text: string;
  /** Seconds until this entry expires; undefined = no expiry */
  ttlSeconds?: number;
  /** ISO timestamp when entry was created */
  createdAt: string;
  /** ISO timestamp when entry was last written */
  updatedAt: string;
  /** Absolute expiry timestamp (derived from ttlSeconds + createdAt) */
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
  /** Relevance score 0-1 */
  score: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const memory = new Map<string, MemoryEntry>();

function postgresAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("memoryStore requires DATABASE_URL outside development/test.");
}

function isExpired(entry: MemoryEntry): boolean {
  if (!entry.expiresAt) return false;
  return new Date(entry.expiresAt) < new Date();
}

function purgeExpired(): void {
  for (const [id, entry] of memory.entries()) {
    if (isExpired(entry)) memory.delete(id);
  }
}

/**
 * Lightweight keyword-relevance scorer.
 * Tokenises both the query and the entry text/key, then returns the
 * fraction of query tokens present in the document. Identical scoring
 * is applied to either path — the Postgres branch loads candidate rows
 * with ILIKE for a fast prefilter, then runs the same JS-side scorer
 * so behavior matches the in-memory branch exactly.
 */
function scoreEntry(entry: MemoryEntry, query: string): number {
  const haystack = `${entry.key} ${entry.text}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return 1;
  const hits = tokens.filter((t) => haystack.includes(t)).length;
  return hits / tokens.length;
}

interface MemoryRow {
  id: string;
  user_id: string;
  workflow_id: string | null;
  workflow_name: string | null;
  agent_id: string | null;
  key: string;
  text_value: string;
  ttl_seconds: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string | null;
}

function isoOrUndefined(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function mapRowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    workflowId: row.workflow_id ?? undefined,
    workflowName: row.workflow_name ?? undefined,
    agentId: row.agent_id ?? undefined,
    key: row.key,
    text: row.text_value,
    ttlSeconds: row.ttl_seconds ?? undefined,
    createdAt: isoOrUndefined(row.created_at) ?? new Date().toISOString(),
    updatedAt: isoOrUndefined(row.updated_at) ?? new Date().toISOString(),
    expiresAt: isoOrUndefined(row.expires_at),
  };
}

export const memoryStore = {
  /** Write (create or upsert by userId + key + workflowId + agentId) */
  async write(input: CreateMemoryInput): Promise<MemoryEntry> {
    const now = new Date().toISOString();
    const expiresAt =
      input.ttlSeconds !== undefined
        ? new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
        : undefined;

    if (!postgresAvailable()) {
      purgeExpired();
      const existing = Array.from(memory.values()).find(
        (e) =>
          e.userId === input.userId &&
          e.key === input.key &&
          (e.workflowId ?? null) === (input.workflowId ?? null) &&
          (e.agentId ?? null) === (input.agentId ?? null),
      );

      if (existing) {
        const updated: MemoryEntry = {
          ...existing,
          text: input.text,
          ttlSeconds: input.ttlSeconds,
          updatedAt: now,
          expiresAt,
          workflowName: input.workflowName ?? existing.workflowName,
        };
        memory.set(existing.id, updated);
        return updated;
      }

      const entry: MemoryEntry = {
        id: randomUUID(),
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
      memory.set(entry.id, entry);
      return entry;
    }

    const pool = getPostgresPool();
    // Look up an existing scope-keyed row so we can update instead of
    // duplicating. The unique scope is (user_id, key, workflow_id, agent_id).
    const existing = await pool.query<MemoryRow>(
      `SELECT * FROM memory_entries
        WHERE user_id = $1 AND key = $2
          AND ($3::text IS NULL AND workflow_id IS NULL OR workflow_id = $3)
          AND ($4::text IS NULL AND agent_id IS NULL OR agent_id = $4)
        LIMIT 1`,
      [input.userId, input.key, input.workflowId ?? null, input.agentId ?? null],
    );

    if (existing.rowCount && existing.rowCount > 0) {
      const row = existing.rows[0];
      const updated = await pool.query<MemoryRow>(
        `UPDATE memory_entries
            SET text_value = $1,
                ttl_seconds = $2,
                workflow_name = COALESCE($3, workflow_name),
                updated_at = $4,
                expires_at = $5
          WHERE id = $6
          RETURNING *`,
        [
          input.text,
          input.ttlSeconds ?? null,
          input.workflowName ?? null,
          now,
          expiresAt ?? null,
          row.id,
        ],
      );
      return mapRowToEntry(updated.rows[0]);
    }

    const inserted = await pool.query<MemoryRow>(
      `INSERT INTO memory_entries (
         id, user_id, workflow_id, workflow_name, agent_id, key,
         text_value, ttl_seconds, created_at, updated_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        randomUUID(),
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
      ],
    );
    return mapRowToEntry(inserted.rows[0]);
  },

  /** Semantic-ish search over entries visible to userId */
  async search(
    query: string,
    userId: string,
    agentId?: string,
    limit = 10,
  ): Promise<SearchResult[]> {
    if (!postgresAvailable()) {
      purgeExpired();
      const candidates = Array.from(memory.values()).filter(
        (e) => e.userId === userId && (!agentId || e.agentId === agentId),
      );

      if (!query.trim()) {
        return candidates
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, limit)
          .map((entry) => ({ entry, score: 1 }));
      }

      return candidates
        .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
        .slice(0, limit);
    }

    const pool = getPostgresPool();
    const params: unknown[] = [userId];
    let where = `user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`;
    if (agentId !== undefined) {
      params.push(agentId);
      where += ` AND agent_id = $${params.length}`;
    }
    const rows = await pool.query<MemoryRow>(
      `SELECT * FROM memory_entries WHERE ${where} ORDER BY updated_at DESC`,
      params,
    );
    const entries = rows.rows.map(mapRowToEntry);

    if (!query.trim()) {
      return entries.slice(0, limit).map((entry) => ({ entry, score: 1 }));
    }

    return entries
      .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
      .slice(0, limit);
  },

  /** List all entries for a user (or scoped to a workflow) */
  async list(userId: string, workflowId?: string): Promise<MemoryEntry[]> {
    if (!postgresAvailable()) {
      purgeExpired();
      return Array.from(memory.values()).filter(
        (e) => e.userId === userId && (!workflowId || e.workflowId === workflowId),
      );
    }

    const pool = getPostgresPool();
    const params: unknown[] = [userId];
    let where = `user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`;
    if (workflowId !== undefined) {
      params.push(workflowId);
      where += ` AND workflow_id = $${params.length}`;
    }
    const rows = await pool.query<MemoryRow>(
      `SELECT * FROM memory_entries WHERE ${where} ORDER BY updated_at DESC`,
      params,
    );
    return rows.rows.map(mapRowToEntry);
  },

  /** Get a single entry by ID */
  async get(id: string): Promise<MemoryEntry | undefined> {
    if (!postgresAvailable()) {
      purgeExpired();
      const entry = memory.get(id);
      if (entry && isExpired(entry)) {
        memory.delete(id);
        return undefined;
      }
      return entry;
    }

    const pool = getPostgresPool();
    const result = await pool.query<MemoryRow>(
      `SELECT * FROM memory_entries
        WHERE id = $1
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [id],
    );
    return result.rows[0] ? mapRowToEntry(result.rows[0]) : undefined;
  },

  /** Delete a single entry (returns true if it existed AND was owned by userId) */
  async delete(id: string, userId: string): Promise<boolean> {
    if (!postgresAvailable()) {
      const entry = memory.get(id);
      if (!entry || entry.userId !== userId) return false;
      memory.delete(id);
      return true;
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `DELETE FROM memory_entries WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  },

  /** Usage stats for a user */
  async stats(
    userId: string,
  ): Promise<{ totalEntries: number; totalBytes: number; workflowCount: number }> {
    if (!postgresAvailable()) {
      purgeExpired();
      const entries = Array.from(memory.values()).filter((e) => e.userId === userId);
      const totalBytes = entries.reduce((acc, e) => acc + e.text.length + e.key.length, 0);
      const workflowCount = new Set(entries.map((e) => e.workflowId).filter(Boolean)).size;
      return { totalEntries: entries.length, totalBytes, workflowCount };
    }

    const pool = getPostgresPool();
    const result = await pool.query<{
      total_entries: string;
      total_bytes: string;
      workflow_count: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_entries,
         COALESCE(SUM(LENGTH(text_value) + LENGTH(key)), 0)::text AS total_bytes,
         COUNT(DISTINCT workflow_id) FILTER (WHERE workflow_id IS NOT NULL)::text AS workflow_count
       FROM memory_entries
       WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId],
    );
    const row = result.rows[0];
    return {
      totalEntries: Number(row?.total_entries ?? 0),
      totalBytes: Number(row?.total_bytes ?? 0),
      workflowCount: Number(row?.workflow_count ?? 0),
    };
  },

  /** Clear all entries (used in tests) */
  async clear(): Promise<void> {
    memory.clear();
    if (!postgresAvailable()) return;
    const pool = getPostgresPool();
    await pool.query(`DELETE FROM memory_entries`);
  },
};
