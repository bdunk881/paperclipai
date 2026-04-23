/**
 * Persistent context memory store for AutoFlow.
 *
 * Stores per-agent/per-workflow memory entries with optional TTL.
 * Implements basic keyword-scoring search as a lightweight alternative to a
 * vector DB. Production deployments should swap searchEntries() for a
 * Qdrant/Pinecone call without changing the rest of the API surface.
 *
 * Replace with a PostgreSQL-backed store for production (see ALT-121).
 */

import { randomUUID } from "node:crypto";

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

const store = new Map<string, MemoryEntry>();

function isExpired(entry: MemoryEntry): boolean {
  if (!entry.expiresAt) return false;
  return new Date(entry.expiresAt) < new Date();
}

function purgeExpired(): void {
  for (const [id, entry] of store.entries()) {
    if (isExpired(entry)) store.delete(id);
  }
}

/**
 * Lightweight keyword-relevance scorer.
 * Tokenises both the query and the entry text/key, then returns the
 * fraction of query tokens present in the document.  Good enough for
 * development; swap for an embedding-based cosine search in production.
 */
function scoreEntry(entry: MemoryEntry, query: string): number {
  const haystack = `${entry.key} ${entry.text}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return 1; // empty query matches everything
  const hits = tokens.filter((t) => haystack.includes(t)).length;
  return hits / tokens.length;
}

export const memoryStore = {
  /** Write (create or upsert by key + workflowId + agentId) */
  write(input: CreateMemoryInput): MemoryEntry {
    purgeExpired();

    // Upsert: find existing entry with same scope + key
    const existing = Array.from(store.values()).find(
      (e) =>
        e.userId === input.userId &&
        e.key === input.key &&
        (e.workflowId ?? null) === (input.workflowId ?? null) &&
        (e.agentId ?? null) === (input.agentId ?? null)
    );

    const now = new Date().toISOString();
    const expiresAt =
      input.ttlSeconds !== undefined
        ? new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
        : undefined;

    if (existing) {
      const updated: MemoryEntry = {
        ...existing,
        text: input.text,
        ttlSeconds: input.ttlSeconds,
        updatedAt: now,
        expiresAt,
        workflowName: input.workflowName ?? existing.workflowName,
      };
      store.set(existing.id, updated);
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
    store.set(entry.id, entry);
    return entry;
  },

  /** Semantic-ish search over entries visible to userId */
  search(query: string, userId: string, agentId?: string, limit = 10): SearchResult[] {
    purgeExpired();
    const candidates = Array.from(store.values()).filter(
      (e) => e.userId === userId && (!agentId || e.agentId === agentId)
    );

    if (!query.trim()) {
      // No query → return all, sorted by recency
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
  },

  /** List all entries for a user (or scoped to a workflow) */
  list(userId: string, workflowId?: string): MemoryEntry[] {
    purgeExpired();
    return Array.from(store.values()).filter(
      (e) =>
        e.userId === userId &&
        (!workflowId || e.workflowId === workflowId)
    );
  },

  /** Get a single entry by ID */
  get(id: string): MemoryEntry | undefined {
    purgeExpired();
    const entry = store.get(id);
    if (entry && isExpired(entry)) {
      store.delete(id);
      return undefined;
    }
    return entry;
  },

  /** Delete a single entry (returns true if it existed) */
  delete(id: string, userId: string): boolean {
    const entry = store.get(id);
    if (!entry || entry.userId !== userId) return false;
    store.delete(id);
    return true;
  },

  /** Usage stats for a user */
  stats(userId: string): { totalEntries: number; totalBytes: number; workflowCount: number } {
    purgeExpired();
    const entries = Array.from(store.values()).filter((e) => e.userId === userId);
    const totalBytes = entries.reduce((acc, e) => acc + e.text.length + e.key.length, 0);
    const workflowCount = new Set(entries.map((e) => e.workflowId).filter(Boolean)).size;
    return { totalEntries: entries.length, totalBytes, workflowCount };
  },

  /** Clear all entries (used in tests) */
  clear(): void {
    store.clear();
  },
};
