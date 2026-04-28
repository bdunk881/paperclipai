import { randomUUID } from "node:crypto";
import { parseJsonColumn } from "../db/json";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import { cosineSimilarity, embedText } from "../knowledge/embeddings";

export type AgentMemoryTier = "explore" | "flow" | "automate" | "scale";
export type AgentMemoryScope = "private" | "shared";
export type AgentMemoryEntryType = "generic" | "ticket_close";
export type AgentMemoryLayer = "agent" | "team" | "company";
export type AgentMemoryEventEntityType = "entry" | "knowledge_fact" | "heartbeat_log";
export type AgentMemoryEventType = "created" | "archived";

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
  workspaceId: string;
  agentId: string;
  runId?: string;
  scope: AgentMemoryScope;
  entryType: AgentMemoryEntryType;
  memoryLayer: AgentMemoryLayer;
  teamId?: string;
  key: string;
  text: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  archivedAt?: string;
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
  workspaceId: string;
  agentId: string;
  runId?: string;
  scope: AgentMemoryScope;
  memoryLayer: AgentMemoryLayer;
  teamId?: string;
  subject: string;
  predicate: string;
  object: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
  archivedAt?: string;
}

export interface AgentHeartbeatLog {
  id: string;
  userId: string;
  workspaceId: string;
  agentId: string;
  runId: string;
  memoryLayer: AgentMemoryLayer;
  teamId?: string;
  status?: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
  archivedAt?: string;
}

export interface AgentMemoryEvent {
  id: string;
  userId: string;
  workspaceId: string;
  agentId: string;
  runId?: string;
  memoryLayer: AgentMemoryLayer;
  teamId?: string;
  entityType: AgentMemoryEventEntityType;
  eventType: AgentMemoryEventType;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentMemoryStateSnapshot {
  workspaceId: string;
  agentId: string;
  teamId?: string;
  entries: AgentMemoryEntry[];
  facts: AgentKnowledgeFact[];
  heartbeatLogs: AgentHeartbeatLog[];
  events: AgentMemoryEvent[];
}

interface StoredAgentMemoryEntry extends AgentMemoryEntry {
  embedding: number[];
}

interface StoredHeartbeatLog extends AgentHeartbeatLog {}
interface StoredKnowledgeFact extends AgentKnowledgeFact {}

interface PersistedEntryRow {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  run_id: string | null;
  scope: AgentMemoryScope;
  entry_type: AgentMemoryEntryType;
  memory_layer: AgentMemoryLayer;
  team_id: string | null;
  key: string;
  text_value: string;
  metadata: unknown;
  embedding: unknown;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  archived_at: string | null;
}

interface PersistedFactRow {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  run_id: string | null;
  scope: AgentMemoryScope;
  memory_layer: AgentMemoryLayer;
  team_id: string | null;
  subject: string;
  predicate: string;
  object: string;
  metadata: unknown;
  created_at: string;
  expires_at: string | null;
  archived_at: string | null;
}

interface PersistedHeartbeatRow {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  run_id: string;
  memory_layer: AgentMemoryLayer;
  team_id: string | null;
  status: string | null;
  summary: string;
  metadata: unknown;
  created_at: string;
  expires_at: string | null;
  archived_at: string | null;
}

interface PersistedEventRow {
  id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  run_id: string | null;
  memory_layer: AgentMemoryLayer;
  team_id: string | null;
  entity_type: AgentMemoryEventEntityType;
  event_type: AgentMemoryEventType;
  entity_id: string;
  payload: unknown;
  created_at: string;
}

const memoryEntries = new Map<string, StoredAgentMemoryEntry>();
const knowledgeFacts = new Map<string, StoredKnowledgeFact>();
const heartbeatLogs = new Map<string, StoredHeartbeatLog>();
const memoryEvents = new Map<string, AgentMemoryEvent>();

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

function normalizeMemoryLayer(value: unknown): AgentMemoryLayer {
  return value === "company" || value === "team" ? value : "agent";
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
    workspaceId: entry.workspaceId,
    agentId: entry.agentId,
    runId: entry.runId,
    scope: entry.scope,
    entryType: entry.entryType,
    memoryLayer: entry.memoryLayer,
    teamId: entry.teamId,
    key: entry.key,
    text: entry.text,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt,
    archivedAt: entry.archivedAt,
  };
}

function mapEntryRow(row: PersistedEntryRow): StoredAgentMemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    runId: row.run_id ?? undefined,
    scope: row.scope,
    entryType: row.entry_type,
    memoryLayer: normalizeMemoryLayer(row.memory_layer),
    teamId: row.team_id ?? undefined,
    key: row.key,
    text: row.text_value,
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    embedding: parseJsonColumn(row.embedding, [] as number[]),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

function mapFactRow(row: PersistedFactRow): StoredKnowledgeFact {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    runId: row.run_id ?? undefined,
    scope: row.scope,
    memoryLayer: normalizeMemoryLayer(row.memory_layer),
    teamId: row.team_id ?? undefined,
    subject: row.subject,
    predicate: row.predicate,
    object: row.object,
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

function mapHeartbeatRow(row: PersistedHeartbeatRow): StoredHeartbeatLog {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    runId: row.run_id,
    memoryLayer: normalizeMemoryLayer(row.memory_layer),
    teamId: row.team_id ?? undefined,
    status: row.status ?? undefined,
    summary: row.summary,
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
  };
}

function mapEventRow(row: PersistedEventRow): AgentMemoryEvent {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    runId: row.run_id ?? undefined,
    memoryLayer: normalizeMemoryLayer(row.memory_layer),
    teamId: row.team_id ?? undefined,
    entityType: row.entity_type,
    eventType: row.event_type,
    entityId: row.entity_id,
    payload: parseJsonColumn(row.payload, {} as Record<string, unknown>),
    createdAt: row.created_at,
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
      workspace_id text NOT NULL,
      agent_id text NOT NULL,
      run_id text,
      scope text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'shared')),
      entry_type text NOT NULL DEFAULT 'generic' CHECK (entry_type IN ('generic', 'ticket_close')),
      memory_layer text NOT NULL DEFAULT 'agent' CHECK (memory_layer IN ('agent', 'team', 'company')),
      team_id text,
      key text NOT NULL,
      text_value text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      embedding jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      expires_at timestamptz,
      archived_at timestamptz
    )
  `);
  await queryPostgres(`
    ALTER TABLE agent_memory_entries
    ADD COLUMN IF NOT EXISTS workspace_id text
  `);
  await queryPostgres(`UPDATE agent_memory_entries SET workspace_id = user_id WHERE workspace_id IS NULL`);
  await queryPostgres(`ALTER TABLE agent_memory_entries ALTER COLUMN workspace_id SET NOT NULL`);
  await queryPostgres(`ALTER TABLE agent_memory_entries ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'generic'`);
  await queryPostgres(`ALTER TABLE agent_memory_entries ADD COLUMN IF NOT EXISTS memory_layer text NOT NULL DEFAULT 'agent'`);
  await queryPostgres(`ALTER TABLE agent_memory_entries ADD COLUMN IF NOT EXISTS team_id text`);
  await queryPostgres(`ALTER TABLE agent_memory_entries ADD COLUMN IF NOT EXISTS archived_at timestamptz`);
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS agent_memory_kg_facts (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      workspace_id text NOT NULL,
      agent_id text NOT NULL,
      run_id text,
      scope text NOT NULL DEFAULT 'private' CHECK (scope IN ('private', 'shared')),
      memory_layer text NOT NULL DEFAULT 'agent' CHECK (memory_layer IN ('agent', 'team', 'company')),
      team_id text,
      subject text NOT NULL,
      predicate text NOT NULL,
      object text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL,
      expires_at timestamptz,
      archived_at timestamptz
    )
  `);
  await queryPostgres(`ALTER TABLE agent_memory_kg_facts ADD COLUMN IF NOT EXISTS workspace_id text`);
  await queryPostgres(`UPDATE agent_memory_kg_facts SET workspace_id = user_id WHERE workspace_id IS NULL`);
  await queryPostgres(`ALTER TABLE agent_memory_kg_facts ALTER COLUMN workspace_id SET NOT NULL`);
  await queryPostgres(`ALTER TABLE agent_memory_kg_facts ADD COLUMN IF NOT EXISTS memory_layer text NOT NULL DEFAULT 'agent'`);
  await queryPostgres(`ALTER TABLE agent_memory_kg_facts ADD COLUMN IF NOT EXISTS team_id text`);
  await queryPostgres(`ALTER TABLE agent_memory_kg_facts ADD COLUMN IF NOT EXISTS archived_at timestamptz`);
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS agent_heartbeat_logs (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      workspace_id text NOT NULL,
      agent_id text NOT NULL,
      run_id text NOT NULL,
      memory_layer text NOT NULL DEFAULT 'agent' CHECK (memory_layer IN ('agent', 'team', 'company')),
      team_id text,
      status text,
      summary text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL,
      expires_at timestamptz,
      archived_at timestamptz
    )
  `);
  await queryPostgres(`ALTER TABLE agent_heartbeat_logs ADD COLUMN IF NOT EXISTS workspace_id text`);
  await queryPostgres(`UPDATE agent_heartbeat_logs SET workspace_id = user_id WHERE workspace_id IS NULL`);
  await queryPostgres(`ALTER TABLE agent_heartbeat_logs ALTER COLUMN workspace_id SET NOT NULL`);
  await queryPostgres(`ALTER TABLE agent_heartbeat_logs ADD COLUMN IF NOT EXISTS memory_layer text NOT NULL DEFAULT 'agent'`);
  await queryPostgres(`ALTER TABLE agent_heartbeat_logs ADD COLUMN IF NOT EXISTS team_id text`);
  await queryPostgres(`ALTER TABLE agent_heartbeat_logs ADD COLUMN IF NOT EXISTS archived_at timestamptz`);
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS agent_memory_events (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      workspace_id text NOT NULL,
      agent_id text NOT NULL,
      run_id text,
      memory_layer text NOT NULL CHECK (memory_layer IN ('agent', 'team', 'company')),
      team_id text,
      entity_type text NOT NULL CHECK (entity_type IN ('entry', 'knowledge_fact', 'heartbeat_log')),
      event_type text NOT NULL CHECK (event_type IN ('created', 'archived')),
      entity_id text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL
    )
  `);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_workspace_layer ON agent_memory_entries (user_id, workspace_id, memory_layer, updated_at DESC)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_memory_kg_facts_workspace_layer ON agent_memory_kg_facts (user_id, workspace_id, memory_layer, created_at DESC)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_logs_workspace_layer ON agent_heartbeat_logs (user_id, workspace_id, memory_layer, created_at DESC)`);
  await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_memory_events_workspace_created ON agent_memory_events (user_id, workspace_id, created_at DESC)`);

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
  entry: {
    agentId: string;
    workspaceId: string;
    memoryLayer: AgentMemoryLayer;
    teamId?: string;
    archivedAt?: string;
    scope?: AgentMemoryScope;
  },
  input: {
    agentId: string;
    workspaceId: string;
    teamId?: string;
    includeShared: boolean;
  }
): boolean {
  if (entry.archivedAt || entry.workspaceId !== input.workspaceId) {
    return false;
  }
  if (entry.memoryLayer === "company") {
    return true;
  }
  if (entry.memoryLayer === "team") {
    return Boolean(entry.teamId && input.teamId && entry.teamId === input.teamId);
  }
  if (entry.agentId === input.agentId) {
    return true;
  }
  return input.includeShared && entry.scope === "shared";
}

async function appendEvent(input: {
  userId: string;
  workspaceId: string;
  agentId: string;
  runId?: string;
  memoryLayer: AgentMemoryLayer;
  teamId?: string;
  entityType: AgentMemoryEventEntityType;
  eventType: AgentMemoryEventType;
  entityId: string;
  payload: unknown;
  createdAt: string;
}): Promise<AgentMemoryEvent> {
  const event: AgentMemoryEvent = {
    id: randomUUID(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    runId: input.runId,
    memoryLayer: input.memoryLayer,
    teamId: input.teamId,
    entityType: input.entityType,
    eventType: input.eventType,
    entityId: input.entityId,
    payload: sanitizeMetadata(input.payload),
    createdAt: input.createdAt,
  };

  memoryEvents.set(event.id, event);

  if (isPostgresConfigured()) {
    await ensureSchema();
    await queryPostgres(
      `INSERT INTO agent_memory_events (
        id, user_id, workspace_id, agent_id, run_id, memory_layer, team_id, entity_type, event_type, entity_id, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
      [
        event.id,
        event.userId,
        event.workspaceId,
        event.agentId,
        event.runId ?? null,
        event.memoryLayer,
        event.teamId ?? null,
        event.entityType,
        event.eventType,
        event.entityId,
        JSON.stringify(event.payload),
        event.createdAt,
      ]
    );
  }

  return event;
}

export const agentMemoryStore = {
  async createEntry(input: {
    userId: string;
    workspaceId?: string;
    agentId: string;
    runId?: string;
    scope?: AgentMemoryScope;
    entryType?: AgentMemoryEntryType;
    memoryLayer?: AgentMemoryLayer;
    teamId?: string;
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
    const memoryLayer = input.memoryLayer ?? normalizeMemoryLayer(metadata["memoryLayer"]);
    const workspaceId = input.workspaceId?.trim() || input.userId;
    const entry: StoredAgentMemoryEntry = {
      id: randomUUID(),
      userId: input.userId,
      workspaceId,
      agentId: input.agentId,
      runId: input.runId,
      scope: input.scope ?? "private",
      entryType,
      memoryLayer,
      teamId: input.teamId?.trim() || undefined,
      key: input.key,
      text: input.text,
      metadata: {
        ...metadata,
        entryType,
        memoryLayer,
      },
      embedding: await embedText(`${input.key}\n${input.text}`, input.openAiApiKey),
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: undefined,
      archivedAt: undefined,
    };

    memoryEntries.set(entry.id, entry);
    await appendEvent({
      userId: entry.userId,
      workspaceId: entry.workspaceId,
      agentId: entry.agentId,
      runId: entry.runId,
      memoryLayer: entry.memoryLayer,
      teamId: entry.teamId,
      entityType: "entry",
      eventType: "created",
      entityId: entry.id,
      payload: toPublicEntry(entry),
      createdAt: entry.createdAt,
    });

    if (isPostgresConfigured()) {
      await ensureSchema();
      await queryPostgres(
        `INSERT INTO agent_memory_entries (
          id, user_id, workspace_id, agent_id, run_id, scope, entry_type, memory_layer, team_id, key, text_value, metadata, embedding, created_at, updated_at, expires_at, archived_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17)`,
        [
          entry.id,
          entry.userId,
          entry.workspaceId,
          entry.agentId,
          entry.runId ?? null,
          entry.scope,
          entry.entryType,
          entry.memoryLayer,
          entry.teamId ?? null,
          entry.key,
          entry.text,
          JSON.stringify(entry.metadata),
          JSON.stringify(entry.embedding),
          entry.createdAt,
          entry.updatedAt,
          entry.expiresAt ?? null,
          entry.archivedAt ?? null,
        ]
      );
    }

    return toPublicEntry(entry);
  },

  async createTicketCloseEntry(input: {
    userId: string;
    workspaceId?: string;
    agentId: string;
    runId?: string;
    scope?: AgentMemoryScope;
    memoryLayer?: AgentMemoryLayer;
    teamId?: string;
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
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      runId: input.runId,
      scope: input.scope,
      entryType: "ticket_close",
      memoryLayer: input.memoryLayer ?? "agent",
      teamId: input.teamId,
      key: buildTicketCloseKey(metadata),
      text: buildTicketCloseText(metadata),
      metadata,
      tier: input.tier,
      openAiApiKey: input.openAiApiKey,
    });
  },

  async searchEntries(input: {
    userId: string;
    workspaceId?: string;
    agentId: string;
    teamId?: string;
    query: string;
    includeShared?: boolean;
    limit?: number;
    entryType?: AgentMemoryEntryType;
    memoryLayer?: AgentMemoryLayer;
    ticketId?: string;
    tags?: string[];
    openAiApiKey?: string;
  }): Promise<AgentMemorySearchResult[]> {
    await purgeExpiredForUser(input.userId);

    const workspaceId = input.workspaceId?.trim() || input.userId;
    let candidates: StoredAgentMemoryEntry[];
    if (isPostgresConfigured()) {
      await ensureSchema();
      const rows = await queryPostgres<PersistedEntryRow>(
        `SELECT id, user_id, workspace_id, agent_id, run_id, scope, entry_type, memory_layer, team_id, key, text_value, metadata, embedding, created_at, updated_at, expires_at, archived_at
           FROM agent_memory_entries
          WHERE user_id = $1
            AND workspace_id = $2
            AND ($3::text IS NULL OR entry_type = $3)
            AND ($4::text IS NULL OR memory_layer = $4)
            AND archived_at IS NULL
          ORDER BY updated_at DESC`,
        [input.userId, workspaceId, input.entryType ?? null, input.memoryLayer ?? null]
      );
      candidates = rows.rows
        .map(mapEntryRow)
        .filter((entry) =>
          isEntryVisible(entry, {
            agentId: input.agentId,
            workspaceId,
            teamId: input.teamId?.trim(),
            includeShared: Boolean(input.includeShared),
          })
        )
        .filter((entry) => entryMatchesTags(entry, input.tags))
        .filter((entry) => entryMatchesTicketId(entry, input.ticketId));
    } else {
      candidates = Array.from(memoryEntries.values()).filter(
        (entry) =>
          entry.userId === input.userId &&
          isEntryVisible(entry, {
            agentId: input.agentId,
            workspaceId,
            teamId: input.teamId?.trim(),
            includeShared: Boolean(input.includeShared),
          }) &&
          (input.entryType ? entry.entryType === input.entryType : true) &&
          (input.memoryLayer ? entry.memoryLayer === input.memoryLayer : true) &&
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
    workspaceId?: string;
    agentId: string;
    runId?: string;
    scope?: AgentMemoryScope;
    memoryLayer?: AgentMemoryLayer;
    teamId?: string;
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
      workspaceId: input.workspaceId?.trim() || input.userId,
      agentId: input.agentId,
      runId: input.runId,
      scope: input.scope ?? "private",
      memoryLayer: input.memoryLayer ?? "agent",
      teamId: input.teamId?.trim() || undefined,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      metadata: sanitizeMetadata(input.metadata),
      createdAt: nowIso(),
      expiresAt: undefined,
      archivedAt: undefined,
    };

    knowledgeFacts.set(fact.id, fact);
    await appendEvent({
      userId: fact.userId,
      workspaceId: fact.workspaceId,
      agentId: fact.agentId,
      runId: fact.runId,
      memoryLayer: fact.memoryLayer,
      teamId: fact.teamId,
      entityType: "knowledge_fact",
      eventType: "created",
      entityId: fact.id,
      payload: fact,
      createdAt: fact.createdAt,
    });

    if (isPostgresConfigured()) {
      await ensureSchema();
      await queryPostgres(
        `INSERT INTO agent_memory_kg_facts (
          id, user_id, workspace_id, agent_id, run_id, scope, memory_layer, team_id, subject, predicate, object, metadata, created_at, expires_at, archived_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)`,
        [
          fact.id,
          fact.userId,
          fact.workspaceId,
          fact.agentId,
          fact.runId ?? null,
          fact.scope,
          fact.memoryLayer,
          fact.teamId ?? null,
          fact.subject,
          fact.predicate,
          fact.object,
          JSON.stringify(fact.metadata),
          fact.createdAt,
          fact.expiresAt ?? null,
          fact.archivedAt ?? null,
        ]
      );
    }

    return fact;
  },

  async queryKnowledgeFacts(input: {
    userId: string;
    workspaceId?: string;
    agentId: string;
    teamId?: string;
    query?: string;
    subject?: string;
    predicate?: string;
    object?: string;
    includeShared?: boolean;
    limit?: number;
    memoryLayer?: AgentMemoryLayer;
  }): Promise<AgentKnowledgeFact[]> {
    await purgeExpiredForUser(input.userId);

    const workspaceId = input.workspaceId?.trim() || input.userId;
    let facts: StoredKnowledgeFact[];
    if (isPostgresConfigured()) {
      await ensureSchema();
      const rows = await queryPostgres<PersistedFactRow>(
        `SELECT id, user_id, workspace_id, agent_id, run_id, scope, memory_layer, team_id, subject, predicate, object, metadata, created_at, expires_at, archived_at
           FROM agent_memory_kg_facts
          WHERE user_id = $1
            AND workspace_id = $2
            AND ($3::text IS NULL OR memory_layer = $3)
            AND archived_at IS NULL
          ORDER BY created_at DESC`,
        [input.userId, workspaceId, input.memoryLayer ?? null]
      );
      facts = rows.rows
        .map(mapFactRow)
        .filter((fact) =>
          isEntryVisible(fact, {
            agentId: input.agentId,
            workspaceId,
            teamId: input.teamId?.trim(),
            includeShared: Boolean(input.includeShared),
          })
        );
    } else {
      facts = Array.from(knowledgeFacts.values()).filter(
        (fact) =>
          fact.userId === input.userId &&
          isEntryVisible(fact, {
            agentId: input.agentId,
            workspaceId,
            teamId: input.teamId?.trim(),
            includeShared: Boolean(input.includeShared),
          }) &&
          (input.memoryLayer ? fact.memoryLayer === input.memoryLayer : true) &&
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
    workspaceId?: string;
    agentId: string;
    runId: string;
    memoryLayer?: AgentMemoryLayer;
    teamId?: string;
    summary: string;
    status?: string;
    metadata?: Record<string, unknown>;
    tier: AgentMemoryTier;
  }): Promise<AgentHeartbeatLog> {
    await purgeExpiredForUser(input.userId);

    const log: StoredHeartbeatLog = {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId?.trim() || input.userId,
      agentId: input.agentId,
      runId: input.runId,
      memoryLayer: input.memoryLayer ?? "agent",
      teamId: input.teamId?.trim() || undefined,
      status: input.status,
      summary: input.summary,
      metadata: sanitizeMetadata(input.metadata),
      createdAt: nowIso(),
      expiresAt: expiresAtForHeartbeatTier(input.tier),
      archivedAt: undefined,
    };

    heartbeatLogs.set(log.id, log);
    await appendEvent({
      userId: log.userId,
      workspaceId: log.workspaceId,
      agentId: log.agentId,
      runId: log.runId,
      memoryLayer: log.memoryLayer,
      teamId: log.teamId,
      entityType: "heartbeat_log",
      eventType: "created",
      entityId: log.id,
      payload: log,
      createdAt: log.createdAt,
    });

    if (isPostgresConfigured()) {
      await ensureSchema();
      await queryPostgres(
        `INSERT INTO agent_heartbeat_logs (
          id, user_id, workspace_id, agent_id, run_id, memory_layer, team_id, status, summary, metadata, created_at, expires_at, archived_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
        [
          log.id,
          log.userId,
          log.workspaceId,
          log.agentId,
          log.runId,
          log.memoryLayer,
          log.teamId ?? null,
          log.status ?? null,
          log.summary,
          JSON.stringify(log.metadata),
          log.createdAt,
          log.expiresAt ?? null,
          log.archivedAt ?? null,
        ]
      );
    }

    return log;
  },

  async listHeartbeatLogs(input: {
    userId: string;
    workspaceId?: string;
    agentId: string;
    teamId?: string;
    tier: AgentMemoryTier;
    limit?: number;
    memoryLayer?: AgentMemoryLayer;
  }): Promise<AgentHeartbeatLog[]> {
    await purgeExpiredForUser(input.userId);

    const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
    const workspaceId = input.workspaceId?.trim() || input.userId;

    if (isPostgresConfigured()) {
      await ensureSchema();
      const rows = await queryPostgres<PersistedHeartbeatRow>(
        `SELECT id, user_id, workspace_id, agent_id, run_id, memory_layer, team_id, status, summary, metadata, created_at, expires_at, archived_at
           FROM agent_heartbeat_logs
          WHERE user_id = $1
            AND workspace_id = $2
            AND ($3::text IS NULL OR memory_layer = $3)
            AND archived_at IS NULL
          ORDER BY created_at DESC
          LIMIT $4`,
        [input.userId, workspaceId, input.memoryLayer ?? null, limit]
      );
      return rows.rows
        .map(mapHeartbeatRow)
        .filter((log) =>
          isEntryVisible(log, {
            agentId: input.agentId,
            workspaceId,
            teamId: input.teamId?.trim(),
            includeShared: true,
          })
        );
    }

    return Array.from(heartbeatLogs.values())
      .filter(
        (log) =>
          log.userId === input.userId &&
          isEntryVisible(log, {
            agentId: input.agentId,
            workspaceId,
            teamId: input.teamId?.trim(),
            includeShared: true,
          }) &&
          (input.memoryLayer ? log.memoryLayer === input.memoryLayer : true) &&
          !isExpired(log.expiresAt)
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  },

  async countKnowledgeFacts(userId: string, workspaceId?: string): Promise<number> {
    await purgeExpiredForUser(userId);

    const tenantWorkspaceId = workspaceId?.trim();
    if (isPostgresConfigured()) {
      await ensureSchema();
      const result = await queryPostgres<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM agent_memory_kg_facts
          WHERE user_id = $1
            AND ($2::text IS NULL OR workspace_id = $2)
            AND archived_at IS NULL`,
        [userId, tenantWorkspaceId ?? null]
      );
      return Number(result.rows[0]?.count ?? "0");
    }

    return Array.from(knowledgeFacts.values()).filter(
      (fact) => fact.userId === userId && !fact.archivedAt && (!tenantWorkspaceId || fact.workspaceId === tenantWorkspaceId)
    ).length;
  },

  async getApproximateMemoryUsageBytes(userId: string, workspaceId?: string): Promise<number> {
    await purgeExpiredForUser(userId);

    const tenantWorkspaceId = workspaceId?.trim();
    if (isPostgresConfigured()) {
      await ensureSchema();
      const result = await queryPostgres<{ total_bytes: string }>(
        `SELECT COALESCE(SUM(
          OCTET_LENGTH(key) +
          OCTET_LENGTH(text_value) +
          OCTET_LENGTH(metadata::text)
        ), 0)::text AS total_bytes
        FROM agent_memory_entries
        WHERE user_id = $1
          AND ($2::text IS NULL OR workspace_id = $2)
          AND archived_at IS NULL`,
        [userId, tenantWorkspaceId ?? null]
      );
      return Number(result.rows[0]?.total_bytes ?? "0");
    }

    return Array.from(memoryEntries.values())
      .filter(
        (entry) =>
          entry.userId === userId &&
          !entry.archivedAt &&
          (!tenantWorkspaceId || entry.workspaceId === tenantWorkspaceId)
      )
      .reduce(
        (total, entry) =>
          total + entry.key.length + entry.text.length + JSON.stringify(entry.metadata).length,
        0
      );
  },

  async listEvents(input: {
    userId: string;
    workspaceId: string;
    limit?: number;
  }): Promise<AgentMemoryEvent[]> {
    await purgeExpiredForUser(input.userId);

    const limit = Math.min(Math.max(input.limit ?? 500, 1), 2000);
    if (isPostgresConfigured()) {
      await ensureSchema();
      const rows = await queryPostgres<PersistedEventRow>(
        `SELECT id, user_id, workspace_id, agent_id, run_id, memory_layer, team_id, entity_type, event_type, entity_id, payload, created_at
           FROM agent_memory_events
          WHERE user_id = $1 AND workspace_id = $2
          ORDER BY created_at ASC
          LIMIT $3`,
        [input.userId, input.workspaceId, limit]
      );
      return rows.rows.map(mapEventRow);
    }

    return Array.from(memoryEvents.values())
      .filter((event) => event.userId === input.userId && event.workspaceId === input.workspaceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  },

  async reconstructWorkspaceState(input: {
    userId: string;
    workspaceId: string;
    agentId: string;
    teamId?: string;
  }): Promise<AgentMemoryStateSnapshot> {
    const events = await this.listEvents({ userId: input.userId, workspaceId: input.workspaceId, limit: 2000 });
    const entries = new Map<string, StoredAgentMemoryEntry>();
    const facts = new Map<string, StoredKnowledgeFact>();
    const logs = new Map<string, StoredHeartbeatLog>();

    for (const event of events) {
      if (event.entityType === "entry") {
        const payload = sanitizeMetadata(event.payload) as unknown as AgentMemoryEntry;
        if (event.eventType === "archived") {
          const existing = entries.get(event.entityId);
          if (existing) {
            existing.archivedAt = event.createdAt;
          }
          continue;
        }
        entries.set(event.entityId, {
          ...(payload as StoredAgentMemoryEntry),
          embedding: Array.isArray(((payload as unknown as Record<string, unknown>).embedding))
            ? (((payload as unknown as Record<string, unknown>).embedding) as number[])
            : [],
        });
      }
      if (event.entityType === "knowledge_fact") {
        const payload = sanitizeMetadata(event.payload) as unknown as StoredKnowledgeFact;
        if (event.eventType === "archived") {
          const existing = facts.get(event.entityId);
          if (existing) {
            existing.archivedAt = event.createdAt;
          }
          continue;
        }
        facts.set(event.entityId, payload);
      }
      if (event.entityType === "heartbeat_log") {
        const payload = sanitizeMetadata(event.payload) as unknown as StoredHeartbeatLog;
        if (event.eventType === "archived") {
          const existing = logs.get(event.entityId);
          if (existing) {
            existing.archivedAt = event.createdAt;
          }
          continue;
        }
        logs.set(event.entityId, payload);
      }
    }

    return {
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      teamId: input.teamId,
      entries: Array.from(entries.values())
        .filter((entry) =>
          isEntryVisible(entry, {
            agentId: input.agentId,
            workspaceId: input.workspaceId,
            teamId: input.teamId,
            includeShared: true,
          })
        )
        .map((entry) => toPublicEntry(entry)),
      facts: Array.from(facts.values()).filter((fact) =>
        isEntryVisible(fact, {
          agentId: input.agentId,
          workspaceId: input.workspaceId,
          teamId: input.teamId,
          includeShared: true,
        })
      ),
      heartbeatLogs: Array.from(logs.values()).filter((log) =>
        isEntryVisible(log, {
          agentId: input.agentId,
          workspaceId: input.workspaceId,
          teamId: input.teamId,
          includeShared: true,
        })
      ),
      events,
    };
  },

  async archiveWorkspaceMemory(input: {
    userId: string;
    workspaceId: string;
    olderThan: string;
    runId?: string;
  }): Promise<{ archivedEntries: number; archivedFacts: number; archivedHeartbeatLogs: number }> {
    await purgeExpiredForUser(input.userId);

    const cutoff = new Date(input.olderThan).toISOString();
    const markArchived = async <T extends AgentMemoryEntry | AgentKnowledgeFact | AgentHeartbeatLog>(
      records: T[],
      entityType: AgentMemoryEventEntityType
    ): Promise<number> => {
      let count = 0;
      for (const record of records) {
        if (record.archivedAt || record.workspaceId !== input.workspaceId || record.createdAt >= cutoff) {
          continue;
        }
        record.archivedAt = nowIso();
        await appendEvent({
          userId: record.userId,
          workspaceId: record.workspaceId,
          agentId: record.agentId,
          runId: input.runId,
          memoryLayer: record.memoryLayer,
          teamId: record.teamId,
          entityType,
          eventType: "archived",
          entityId: record.id,
          payload: { archivedAt: record.archivedAt },
          createdAt: record.archivedAt,
        });
        count += 1;
      }
      return count;
    };

    const archivedEntries = await markArchived(Array.from(memoryEntries.values()), "entry");
    const archivedFacts = await markArchived(Array.from(knowledgeFacts.values()), "knowledge_fact");
    const archivedHeartbeatLogs = await markArchived(Array.from(heartbeatLogs.values()), "heartbeat_log");

    if (isPostgresConfigured()) {
      await ensureSchema();
      await queryPostgres(
        `UPDATE agent_memory_entries
            SET archived_at = COALESCE(archived_at, NOW())
          WHERE user_id = $1 AND workspace_id = $2 AND created_at < $3::timestamptz`,
        [input.userId, input.workspaceId, cutoff]
      );
      await queryPostgres(
        `UPDATE agent_memory_kg_facts
            SET archived_at = COALESCE(archived_at, NOW())
          WHERE user_id = $1 AND workspace_id = $2 AND created_at < $3::timestamptz`,
        [input.userId, input.workspaceId, cutoff]
      );
      await queryPostgres(
        `UPDATE agent_heartbeat_logs
            SET archived_at = COALESCE(archived_at, NOW())
          WHERE user_id = $1 AND workspace_id = $2 AND created_at < $3::timestamptz`,
        [input.userId, input.workspaceId, cutoff]
      );
    }

    return { archivedEntries, archivedFacts, archivedHeartbeatLogs };
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
    memoryEvents.clear();
  },
};
