import { randomUUID } from "node:crypto";
import { parseJsonColumn } from "../db/json";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import { cosineSimilarity, embedText } from "../knowledge/embeddings";

export type AgentMemoryTier = "explore" | "flow" | "automate" | "scale";
export type AgentMemoryScope = "private" | "shared";
export type AgentMemoryEntryType = "generic" | "ticket_close";

export interface TicketCloseMemoryMetadata extends Record<string, unknown> {
  ticket_id: string;
  ticket_url: string;
  closed_at: string;
  task_summary: string;
  agent_contribution: string;
  key_learnings: string;
  artifact_refs: string[];
  tags: string[];
  extension_metadata?: Record<string, unknown>;
}

export interface AgentMemoryEntry {
  id: string;
  userId: string;
  agentId: string;
  runId?: string;
  scope: AgentMemoryScope;
  entryType: AgentMemoryEntryType;
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
  entry_type: AgentMemoryEntryType;
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

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function normalizeEntryType(value: unknown): AgentMemoryEntryType {
  return value === "ticket_close" ? "ticket_close" : "generic";
}

function getTicketCloseMetadata(metadata: Record<string, unknown>): TicketCloseMemoryMetadata | null {
  if (normalizeEntryType(metadata["entryType"]) !== "ticket_close") {
    return null;
  }

  const ticketId = typeof metadata["ticket_id"] === "string" ? metadata["ticket_id"].trim() : "";
  const ticketUrl = typeof metadata["ticket_url"] === "string" ? metadata["ticket_url"].trim() : "";
  const closedAt = typeof metadata["closed_at"] === "string" ? metadata["closed_at"].trim() : "";
  const taskSummary = typeof metadata["task_summary"] === "string" ? metadata["task_summary"].trim() : "";
  const contribution = typeof metadata["agent_contribution"] === "string" ? metadata["agent_contribution"].trim() : "";
  const keyLearnings = typeof metadata["key_learnings"] === "string" ? metadata["key_learnings"].trim() : "";
  const artifactRefs = sanitizeStringArray(metadata["artifact_refs"]);
  const tags = sanitizeStringArray(metadata["tags"]);

  if (
    !ticketId ||
    !ticketUrl ||
    !closedAt ||
    !taskSummary ||
    !contribution ||
    !keyLearnings
  ) {
    return null;
  }

  return {
    ticket_id: ticketId,
    ticket_url: ticketUrl,
    closed_at: closedAt,
    task_summary: taskSummary,
    agent_contribution: contribution,
    key_learnings: keyLearnings,
    artifact_refs: artifactRefs,
    tags,
    extension_metadata:
      metadata["extension_metadata"] && typeof metadata["extension_metadata"] === "object" && !Array.isArray(metadata["extension_metadata"])
        ? metadata["extension_metadata"] as Record<string, unknown>
        : undefined,
  };
}

function buildTicketCloseMetadata(input: {
  ticketId: string;
  ticketUrl: string;
  closedAt: string;
  taskSummary: string;
  agentContribution: string;
  keyLearnings: string;
  artifactRefs?: string[];
  tags?: string[];
  extensionMetadata?: Record<string, unknown>;
}): TicketCloseMemoryMetadata {
  return {
    ticket_id: input.ticketId.trim(),
    ticket_url: input.ticketUrl.trim(),
    closed_at: input.closedAt.trim(),
    task_summary: input.taskSummary.trim(),
    agent_contribution: input.agentContribution.trim(),
    key_learnings: input.keyLearnings.trim(),
    artifact_refs: sanitizeStringArray(input.artifactRefs),
    tags: sanitizeStringArray(input.tags),
    ...(input.extensionMetadata ? { extension_metadata: sanitizeMetadata(input.extensionMetadata) } : {}),
  };
}

function buildTicketCloseKey(metadata: TicketCloseMemoryMetadata): string {
  return `ticket-close:${metadata.ticket_id}`;
}

function buildTicketCloseText(metadata: TicketCloseMemoryMetadata): string {
  return [
    metadata.task_summary,
    metadata.agent_contribution,
    metadata.key_learnings,
    metadata.artifact_refs.join(" "),
    metadata.tags.join(" "),
  ]
    .filter(Boolean)
    .join("\n");
}

function metadataTags(metadata: Record<string, unknown>): string[] {
  const ticketClose = getTicketCloseMetadata(metadata);
  if (ticketClose) {
    return ticketClose.tags;
  }
  return sanitizeStringArray(metadata["tags"]);
}

function entryMatchesTags(entry: StoredAgentMemoryEntry, tags?: string[]): boolean {
  const filterTags = sanitizeStringArray(tags);
  if (filterTags.length === 0) {
    return true;
  }

  const entryTags = metadataTags(entry.metadata);
  if (entryTags.length === 0) {
    return false;
  }

  return filterTags.some((tag) => entryTags.includes(tag));
}

function entryMatchesTicketId(entry: StoredAgentMemoryEntry, ticketId?: string): boolean {
  if (!ticketId?.trim()) {
    return true;
  }

  const ticketClose = getTicketCloseMetadata(entry.metadata);
  if (!ticketClose) {
    return false;
  }

  return ticketClose.ticket_id === ticketId.trim();
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

function tagScoreBoost(entry: StoredAgentMemoryEntry, tags?: string[]): number {
  const filterTags = sanitizeStringArray(tags);
  if (filterTags.length === 0) {
    return 0;
  }

  const entryTags = metadataTags(entry.metadata);
  if (entryTags.length === 0) {
    return 0;
  }

  const matches = filterTags.filter((tag) => entryTags.includes(tag)).length;
  return matches > 0 ? Math.min(matches / filterTags.length, 1) * 0.2 : 0;
}

function toPublicEntry(entry: StoredAgentMemoryEntry): AgentMemoryEntry {
  return {
    id: entry.id,
    userId: entry.userId,
    agentId: entry.agentId,
    runId: entry.runId,
    scope: entry.scope,
    entryType: entry.entryType,
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
    entryType: row.entry_type,
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
      entry_type text NOT NULL DEFAULT 'generic' CHECK (entry_type IN ('generic', 'ticket_close')),
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
    ALTER TABLE agent_memory_entries
    ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'generic'
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
    entryType?: AgentMemoryEntryType;
    key: string;
    text: string;
    metadata?: Record<string, unknown>;
    tier: AgentMemoryTier;
    openAiApiKey?: string;
  }): Promise<AgentMemoryEntry> {
    await purgeExpiredForUser(input.userId);

    const timestamp = nowIso();
    const metadata = sanitizeMetadata(input.metadata);
    const entryType = input.entryType ?? normalizeEntryType(metadata["entryType"]);
    const entry: StoredAgentMemoryEntry = {
      id: randomUUID(),
      userId: input.userId,
      agentId: input.agentId,
      runId: input.runId,
      scope: input.scope ?? "private",
      entryType,
      key: input.key,
      text: input.text,
      metadata: {
        ...metadata,
        entryType,
      },
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
          id, user_id, agent_id, run_id, scope, entry_type, key, text_value, metadata, embedding, created_at, updated_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13)`,
        [
          entry.id,
          entry.userId,
          entry.agentId,
          entry.runId ?? null,
          entry.scope,
          entry.entryType,
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

  async createTicketCloseEntry(input: {
    userId: string;
    agentId: string;
    runId?: string;
    scope?: AgentMemoryScope;
    ticketId: string;
    ticketUrl: string;
    closedAt: string;
    taskSummary: string;
    agentContribution: string;
    keyLearnings: string;
    artifactRefs?: string[];
    tags?: string[];
    extensionMetadata?: Record<string, unknown>;
    tier: AgentMemoryTier;
    openAiApiKey?: string;
  }): Promise<AgentMemoryEntry> {
    const metadata = buildTicketCloseMetadata(input);
    return this.createEntry({
      userId: input.userId,
      agentId: input.agentId,
      runId: input.runId,
      scope: input.scope,
      entryType: "ticket_close",
      key: buildTicketCloseKey(metadata),
      text: buildTicketCloseText(metadata),
      metadata,
      tier: input.tier,
      openAiApiKey: input.openAiApiKey,
    });
  },

  async searchEntries(input: {
    userId: string;
    agentId: string;
    query: string;
    includeShared?: boolean;
    limit?: number;
    entryType?: AgentMemoryEntryType;
    ticketId?: string;
    tags?: string[];
    openAiApiKey?: string;
  }): Promise<AgentMemorySearchResult[]> {
    await purgeExpiredForUser(input.userId);

    let candidates: StoredAgentMemoryEntry[];
    if (isPostgresConfigured()) {
      await ensureSchema();
      const rows = await queryPostgres<PersistedEntryRow>(
        `SELECT id, user_id, agent_id, run_id, scope, entry_type, key, text_value, metadata, embedding, created_at, updated_at, expires_at
           FROM agent_memory_entries
          WHERE user_id = $1
            AND (
              agent_id = $2
              OR ($3 = true AND scope = 'shared')
            )
            AND ($4::text IS NULL OR entry_type = $4)
          ORDER BY updated_at DESC`,
        [input.userId, input.agentId, Boolean(input.includeShared), input.entryType ?? null]
      );
      candidates = rows.rows
        .map(mapEntryRow)
        .filter((entry) => entryMatchesTags(entry, input.tags))
        .filter((entry) => entryMatchesTicketId(entry, input.ticketId));
    } else {
      candidates = Array.from(memoryEntries.values()).filter(
        (entry) =>
          entry.userId === input.userId &&
          isEntryVisible(entry, input.agentId, Boolean(input.includeShared)) &&
          (input.entryType ? entry.entryType === input.entryType : true) &&
          entryMatchesTags(entry, input.tags) &&
          entryMatchesTicketId(entry, input.ticketId) &&
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
        const boosted = Math.min(combinedScore(keyword, semantic) + tagScoreBoost(entry, input.tags), 1);
        return {
          entry: toPublicEntry(entry),
          score: boosted,
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

  getPendingTicketCloseMetadataForTests(entryId: string): TicketCloseMemoryMetadata | null {
    const entry = memoryEntries.get(entryId);
    if (!entry) {
      return null;
    }
    return getTicketCloseMetadata(entry.metadata);
  },

  clear(): void {
    memoryEntries.clear();
    knowledgeFacts.clear();
    heartbeatLogs.clear();
  },
};
