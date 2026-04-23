import { randomUUID } from "node:crypto";
import { parseJsonColumn } from "../db/json";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import { cosineSimilarity, embedText } from "../knowledge/embeddings";

export type AgentMemoryTier = "explore" | "flow" | "automate" | "scale";
export type AgentMemoryScope = "private" | "shared";

export interface AgentMemoryEntry {
  id: string;
  userId: string;
  agentId: string;
  runId?: string;
  scope: AgentMemoryScope;
  key: string;
  text: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface AgentMemorySearchResult {
  entry: AgentMemoryEntry;
  score: number;
  semanticScore: number;
  keywordScore: number;
}

export interface AgentKnowledgeFact {
  id: string;
  userId: string;
  agentId: string;
  runId?: string;
  scope: AgentMemoryScope;
  subject: string;
  predicate: string;
  object: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

export interface AgentHeartbeatLog {
  id: string;
  userId: string;
  agentId: string;
  runId: string;
  status?: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

interface StoredAgentMemoryEntry extends AgentMemoryEntry {
  embedding: number[];
}

interface StoredHeartbeatLog extends AgentHeartbeatLog {}
interface StoredKnowledgeFact extends AgentKnowledgeFact {}

interface PersistedEntryRow {
  id: string;
  user_id: string;
  agent_id: string;
  run_id: string | null;
  scope: AgentMemoryScope;
  key: string;
  text_value: string;
  metadata: unknown;
  embedding: unknown;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

interface PersistedFactRow {
  id: string;
  user_id: string;
  agent_id: string;
  run_id: string | null;
  scope: AgentMemoryScope;
  subject: string;
  predicate: string;
  object: string;
  metadata: unknown;
  created_at: string;
  expires_at: string | null;
}

interface PersistedHeartbeatRow {
  id: string;
  user_id: string;
  agent_id: string;
  run_id: string;
  status: string | null;
  summary: string;
  metadata: unknown;
  created_at: string;
  expires_at: string | null;
}

const memoryEntries = new Map<string, StoredAgentMemoryEntry>();
const knowledgeFacts = new Map<string, StoredKnowledgeFact>();
const heartbeatLogs = new Map<string, StoredHeartbeatLog>();

let schemaEnsured = false;

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtForHeartbeatTier(tier: AgentMemoryTier): string | undefined {
  const retentionDays =
    tier === "flow" ? 7 :
      tier === "automate" ? 30 :
        tier === "scale" ? 90 :
          undefined;
  if (!retentionDays) {
    return undefined;
  }
  return new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) {
    return false;
  }
  return new Date(expiresAt).getTime() <= Date.now();
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function keywordScore(haystackValue: string, query: string): number {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
  if (tokens.length === 0) {
    return 1;
  }

  const haystack = haystackValue.toLowerCase();
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length;
}

function combinedScore(keyword: number, semantic: number): number {
  return Number((keyword * 0.35 + semantic * 0.65).toFixed(6));
}

function toPublicEntry(entry: StoredAgentMemoryEntry): AgentMemoryEntry {
  return {
    id: entry.id,
    userId: entry.userId,
    agentId: entry.agentId,
    runId: entry.runId,
    scope: entry.scope,
    key: entry.key,
    text: entry.text,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt,
  };
}

function mapEntryRow(row: PersistedEntryRow): StoredAgentMemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    runId: row.run_id ?? undefined,
    scope: row.scope,
    key: row.key,
    text: row.text_value,
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    embedding: parseJsonColumn(row.embedding, [] as number[]),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function mapFactRow(row: PersistedFactRow): StoredKnowledgeFact {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    runId: row.run_id ?? undefined,
    scope: row.scope,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

function mapHeartbeatRow(row: PersistedHeartbeatRow): StoredHeartbeatLog {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    runId: row.run_id,
    status: row.status ?? undefined,
    summary: row.summary,
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

async function ensureSchema(): Promise<void> {
  if (!isPostgresConfigured() || schemaEnsured) {
    return;
  }

  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS agent_memory_entries (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      agent_id text NOT NULL,
      run_id text,
      scope text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'shared')),
      key text NOT NULL,
      text_value text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      embedding jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      expires_at timestamptz
    )
  `);
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS agent_memory_kg_facts (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      agent_id text NOT NULL,
      run_id text,
      scope text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'shared')),
      subject text NOT NULL,
      predicate text NOT NULL,
      object text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL,
      expires_at timestamptz
    )
  `);
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS agent_heartbeat_logs (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      agent_id text NOT NULL,
      run_id text NOT NULL,
      status text,
      summary text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL,
      expires_at timestamptz
    )
  `);

  schemaEnsured = true;
}

async function purgeExpiredForUser(userId: string): Promise<void> {
  for (const [id, entry] of memoryEntries.entries()) {
    if (entry.userId === userId && isExpired(entry.expiresAt)) {
      memoryEntries.delete(id);
    }
  }
  for (const [id, fact] of knowledgeFacts.entries()) {
    if (fact.userId === userId && isExpired(fact.expiresAt)) {
      knowledgeFacts.delete(id);
    }
  }
  for (const [id, log] of heartbeatLogs.entries()) {
    if (log.userId === userId && isExpired(log.expiresAt)) {
      heartbeatLogs.delete(id);
    }
  }

  if (!isPostgresConfigured()) {
    return;
  }

  await ensureSchema();
  await queryPostgres("DELETE FROM agent_memory_entries WHERE user_id = $1 AND expires_at IS NOT NULL AND expires_at <= NOW()", [userId]);
  await queryPostgres("DELETE FROM agent_memory_kg_facts WHERE user_id = $1 AND expires_at IS NOT NULL AND expires_at <= NOW()", [userId]);
  await queryPostgres("DELETE FROM agent_heartbeat_logs WHERE user_id = $1 AND expires_at IS NOT NULL AND expires_at <= NOW()", [userId]);
}

function isEntryVisible(
  entry: Pick<AgentMemoryEntry, "agentId" | "scope">,
  agentId: string,
  includeShared: boolean
): boolean {
  if (entry.agentId === agentId) {
    return true;
  }
  return includeShared && entry.scope === "shared";
}

export const agentMemoryStore = {
  async createEntry(input: {
    userId: string;
    agentId: string;
    runId?: string;
    scope?: AgentMemoryScope;
    key: string;
    text: string;
    metadata?: Record<string, unknown>;
    tier: AgentMemoryTier;
    openAiApiKey?: string;
  }): Promise<AgentMemoryEntry> {
    await purgeExpiredForUser(input.userId);

    const timestamp = nowIso();
    const entry: StoredAgentMemoryEntry = {
      id: randomUUID(),
      userId: input.userId,
      agentId: input.agentId,
      runId: input.runId,
      scope: input.scope ?? "private",
      key: input.key,
      text: input.text,
      metadata: sanitizeMetadata(input.metadata),
      embedding: await embedText(`${input.key}\n${input.text}`, input.openAiApiKey),
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: undefined,
    };

    memoryEntries.set(entry.id, entry);

    if (isPostgresConfigured()) {
      await ensureSchema();
      await queryPostgres(
        `INSERT INTO agent_memory_entries (
          id, user_id, agent_id, run_id, scope, key, text_value, metadata, embedding, created_at, updated_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)`,
        [
          entry.id,
          entry.userId,
          entry.agentId,
          entry.runId ?? null,
          entry.scope,
          entry.key,
          entry.text,
          JSON.stringify(entry.metadata),
          JSON.stringify(entry.embedding),
          entry.createdAt,
          entry.updatedAt,
          entry.expiresAt ?? null,
        ]
      );
    }

    return toPublicEntry(entry);
  },

  async searchEntries(input: {
    userId: string;
    agentId: string;
    query: string;
    includeShared?: boolean;
    limit?: number;
    openAiApiKey?: string;
  }): Promise<AgentMemorySearchResult[]> {
    await purgeExpiredForUser(input.userId);

    let candidates: StoredAgentMemoryEntry[];
    if (isPostgresConfigured()) {
      await ensureSchema();
      const rows = await queryPostgres<PersistedEntryRow>(
        `SELECT id, user_id, agent_id, run_id, scope, key, text_value, metadata, embedding, created_at, updated_at, expires_at
           FROM agent_memory_entries
          WHERE user_id = $1
            AND (
              agent_id = $2
              OR ($3 = true AND scope = 'shared')
            )
          ORDER BY updated_at DESC`,
        [input.userId, input.agentId, Boolean(input.includeShared)]
      );
      candidates = rows.rows.map(mapEntryRow);
    } else {
      candidates = Array.from(memoryEntries.values()).filter(
        (entry) =>
          entry.userId === input.userId &&
          isEntryVisible(entry, input.agentId, Boolean(input.includeShared)) &&
          !isExpired(entry.expiresAt)
      );
    }

    const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
    if (!input.query.trim()) {
      return candidates
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map((entry) => ({
          entry: toPublicEntry(entry),
          score: 1,
          semanticScore: 1,
          keywordScore: 1,
        }));
    }

    const queryEmbedding = await embedText(input.query, input.openAiApiKey);
    return candidates
      .map((entry) => {
        const keyword = keywordScore(
          `${entry.key}\n${entry.text}\n${JSON.stringify(entry.metadata)}`,
          input.query
        );
        const semantic = cosineSimilarity(queryEmbedding, entry.embedding);
        return {
          entry: toPublicEntry(entry),
          score: combinedScore(keyword, semantic),
          keywordScore: keyword,
          semanticScore: semantic,
        };
      })
      .filter((result) => result.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt)
      )
      .slice(0, limit);
  },

  async addKnowledgeFact(input: {
    userId: string;
    agentId: string;
    runId?: string;
    scope?: AgentMemoryScope;
    subject: string;
    predicate: string;
    object: string;
    metadata?: Record<string, unknown>;
    tier: AgentMemoryTier;
  }): Promise<AgentKnowledgeFact> {
    await purgeExpiredForUser(input.userId);

    const fact: StoredKnowledgeFact = {
      id: randomUUID(),
      userId: input.userId,
      agentId: input.agentId,
      runId: input.runId,
      scope: input.scope ?? "private",
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      metadata: sanitizeMetadata(input.metadata),
      createdAt: nowIso(),
      expiresAt: undefined,
    };

    knowledgeFacts.set(fact.id, fact);

    if (isPostgresConfigured()) {
      await ensureSchema();
      await queryPostgres(
        `INSERT INTO agent_memory_kg_facts (
          id, user_id, agent_id, run_id, scope, subject, predicate, object, metadata, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
        [
          fact.id,
          fact.userId,
          fact.agentId,
          fact.runId ?? null,
          fact.scope,
          fact.subject,
          fact.predicate,
          fact.object,
          JSON.stringify(fact.metadata),
          fact.createdAt,
          fact.expiresAt ?? null,
        ]
      );
    }

    return fact;
  },

  async queryKnowledgeFacts(input: {
    userId: string;
    agentId: string;
    query?: string;
    subject?: string;
    predicate?: string;
    object?: string;
    includeShared?: boolean;
    limit?: number;
  }): Promise<AgentKnowledgeFact[]> {
    await purgeExpiredForUser(input.userId);

    let facts: StoredKnowledgeFact[];
    if (isPostgresConfigured()) {
      await ensureSchema();
      const rows = await queryPostgres<PersistedFactRow>(
        `SELECT id, user_id, agent_id, run_id, scope, subject, predicate, object, metadata, created_at, expires_at
           FROM agent_memory_kg_facts
          WHERE user_id = $1
            AND (
              agent_id = $2
              OR ($3 = true AND scope = 'shared')
            )
          ORDER BY created_at DESC`,
        [input.userId, input.agentId, Boolean(input.includeShared)]
      );
      facts = rows.rows.map(mapFactRow);
    } else {
      facts = Array.from(knowledgeFacts.values()).filter(
        (fact) =>
          fact.userId === input.userId &&
          isEntryVisible(fact, input.agentId, Boolean(input.includeShared)) &&
          !isExpired(fact.expiresAt)
      );
    }

    const query = input.query?.trim().toLowerCase();
    return facts
      .filter((fact) => {
        if (input.subject && fact.subject !== input.subject) return false;
        if (input.predicate && fact.predicate !== input.predicate) return false;
        if (input.object && fact.object !== input.object) return false;
        if (!query) return true;
        const haystack = `${fact.subject} ${fact.predicate} ${fact.object} ${JSON.stringify(fact.metadata)}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.min(Math.max(input.limit ?? 25, 1), 100));
  },

  async appendHeartbeatLog(input: {
    userId: string;
    agentId: string;
    runId: string;
    summary: string;
    status?: string;
    metadata?: Record<string, unknown>;
    tier: AgentMemoryTier;
  }): Promise<AgentHeartbeatLog> {
    await purgeExpiredForUser(input.userId);

    const log: StoredHeartbeatLog = {
      id: randomUUID(),
      userId: input.userId,
      agentId: input.agentId,
      runId: input.runId,
      status: input.status,
      summary: input.summary,
      metadata: sanitizeMetadata(input.metadata),
      createdAt: nowIso(),
      expiresAt: expiresAtForHeartbeatTier(input.tier),
    };

    heartbeatLogs.set(log.id, log);

    if (isPostgresConfigured()) {
      await ensureSchema();
      await queryPostgres(
        `INSERT INTO agent_heartbeat_logs (
          id, user_id, agent_id, run_id, status, summary, metadata, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          log.id,
          log.userId,
          log.agentId,
          log.runId,
          log.status ?? null,
          log.summary,
          JSON.stringify(log.metadata),
          log.createdAt,
          log.expiresAt ?? null,
        ]
      );
    }

    return log;
  },

  async listHeartbeatLogs(input: {
    userId: string;
    agentId: string;
    tier: AgentMemoryTier;
    limit?: number;
  }): Promise<AgentHeartbeatLog[]> {
    await purgeExpiredForUser(input.userId);

    const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);

    if (isPostgresConfigured()) {
      await ensureSchema();
      const rows = await queryPostgres<PersistedHeartbeatRow>(
        `SELECT id, user_id, agent_id, run_id, status, summary, metadata, created_at, expires_at
           FROM agent_heartbeat_logs
          WHERE user_id = $1 AND agent_id = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [input.userId, input.agentId, limit]
      );
      return rows.rows.map(mapHeartbeatRow);
    }

    return Array.from(heartbeatLogs.values())
      .filter((log) => log.userId === input.userId && log.agentId === input.agentId && !isExpired(log.expiresAt))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  },

  async countKnowledgeFacts(userId: string): Promise<number> {
    await purgeExpiredForUser(userId);

    if (isPostgresConfigured()) {
      await ensureSchema();
      const result = await queryPostgres<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM agent_memory_kg_facts WHERE user_id = $1",
        [userId]
      );
      return Number(result.rows[0]?.count ?? "0");
    }

    return Array.from(knowledgeFacts.values()).filter((fact) => fact.userId === userId).length;
  },

  async getApproximateMemoryUsageBytes(userId: string): Promise<number> {
    await purgeExpiredForUser(userId);

    if (isPostgresConfigured()) {
      await ensureSchema();
      const result = await queryPostgres<{ total_bytes: string }>(
        `SELECT COALESCE(SUM(
          OCTET_LENGTH(key) +
          OCTET_LENGTH(text_value) +
          OCTET_LENGTH(metadata::text)
        ), 0)::text AS total_bytes
        FROM agent_memory_entries
        WHERE user_id = $1`,
        [userId]
      );
      return Number(result.rows[0]?.total_bytes ?? "0");
    }

    return Array.from(memoryEntries.values())
      .filter((entry) => entry.userId === userId)
      .reduce(
        (total, entry) =>
          total + entry.key.length + entry.text.length + JSON.stringify(entry.metadata).length,
        0
      );
  },

  clear(): void {
    memoryEntries.clear();
    knowledgeFacts.clear();
    heartbeatLogs.clear();
  },
};
