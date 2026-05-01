import { randomUUID } from "node:crypto";
import { parseJsonColumn } from "../db/json";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import { chunkDocument, ChunkingConfig, DEFAULT_CHUNKING_CONFIG } from "./chunking";
import {
  cosineSimilarity,
  embedText,
  embeddingToVectorLiteral,
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
} from "./embeddings";

export interface KnowledgeBase {
  id: string;
  userId: string;
  name: string;
  description?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  chunkingConfig: ChunkingConfig;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sourceType: "upload" | "inline";
  status: "processing" | "ready" | "failed";
  tags: string[];
  metadata: Record<string, unknown>;
  content: string;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  userId: string;
  index: number;
  text: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  document: KnowledgeDocument;
  knowledgeBase: KnowledgeBase;
  score: number;
  semanticScore: number;
  keywordScore: number;
}

export interface CreateKnowledgeBaseInput {
  userId: string;
  name: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  chunkingConfig?: Partial<ChunkingConfig>;
}

export interface IngestKnowledgeDocumentInput {
  userId: string;
  knowledgeBaseId: string;
  filename: string;
  mimeType: string;
  content: string;
  sourceType: "upload" | "inline";
  tags?: string[];
  metadata?: Record<string, unknown>;
  openaiApiKey?: string;
}

export interface KnowledgeSearchInput {
  userId: string;
  query: string;
  knowledgeBaseIds?: string[];
  limit?: number;
  minScore?: number;
  openaiApiKey?: string;
}

interface PersistedKnowledgeBaseRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  tags: unknown;
  metadata: unknown;
  chunking_config: unknown;
  created_at: string;
  updated_at: string;
}

interface PersistedKnowledgeDocumentRow {
  id: string;
  knowledge_base_id: string;
  user_id: string;
  filename: string;
  mime_type: string;
  source_type: "upload" | "inline";
  status: "processing" | "ready" | "failed";
  tags: unknown;
  metadata: unknown;
  content: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

interface PersistedKnowledgeChunkRow {
  id: string;
  document_id: string;
  knowledge_base_id: string;
  user_id: string;
  chunk_index: number;
  text_content: string;
  token_count: number;
  start_offset: number;
  end_offset: number;
  tags: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

const knowledgeBases = new Map<string, KnowledgeBase>();
const knowledgeDocuments = new Map<string, KnowledgeDocument>();
const knowledgeChunks = new Map<string, KnowledgeChunk>();
const chunkEmbeddings = new Map<string, number[]>();

let schemaEnsured = false;

function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveChunkingConfig(config?: Partial<ChunkingConfig>): ChunkingConfig {
  return {
    maxChunkSizeTokens:
      typeof config?.maxChunkSizeTokens === "number"
        ? Math.min(Math.max(Math.round(config.maxChunkSizeTokens), 100), 4000)
        : DEFAULT_CHUNKING_CONFIG.maxChunkSizeTokens,
    minChunkSizeChars:
      typeof config?.minChunkSizeChars === "number"
        ? Math.min(Math.max(Math.round(config.minChunkSizeChars), 100), 2000)
        : DEFAULT_CHUNKING_CONFIG.minChunkSizeChars,
    overlapTokens:
      typeof config?.overlapTokens === "number"
        ? Math.min(Math.max(Math.round(config.overlapTokens), 0), 500)
        : DEFAULT_CHUNKING_CONFIG.overlapTokens,
  };
}

function keywordScore(text: string, query: string): number {
  const queryTokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
  if (queryTokens.length === 0) {
    return 0;
  }
  const haystack = text.toLowerCase();
  const hits = queryTokens.filter((token) => haystack.includes(token)).length;
  return hits / queryTokens.length;
}

function mapKnowledgeBase(row: PersistedKnowledgeBaseRow): KnowledgeBase {
  const base: KnowledgeBase = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    tags: sanitizeTags(parseJsonColumn(row.tags, [] as string[])),
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    chunkingConfig: resolveChunkingConfig(
      parseJsonColumn(row.chunking_config, DEFAULT_CHUNKING_CONFIG)
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  knowledgeBases.set(base.id, base);
  return base;
}

function mapKnowledgeDocument(row: PersistedKnowledgeDocumentRow): KnowledgeDocument {
  const document: KnowledgeDocument = {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    userId: row.user_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sourceType: row.source_type,
    status: row.status,
    tags: sanitizeTags(parseJsonColumn(row.tags, [] as string[])),
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    content: row.content,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    processedAt: row.processed_at ?? undefined,
  };
  knowledgeDocuments.set(document.id, document);
  return document;
}

function mapKnowledgeChunk(row: PersistedKnowledgeChunkRow): KnowledgeChunk {
  const chunk: KnowledgeChunk = {
    id: row.id,
    documentId: row.document_id,
    knowledgeBaseId: row.knowledge_base_id,
    userId: row.user_id,
    index: row.chunk_index,
    text: row.text_content,
    tokenCount: row.token_count,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    tags: sanitizeTags(parseJsonColumn(row.tags, [] as string[])),
    metadata: parseJsonColumn(row.metadata, {} as Record<string, unknown>),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  knowledgeChunks.set(chunk.id, chunk);
  return chunk;
}

export async function ensureKnowledgeSchema(): Promise<void> {
  if (!isPostgresConfigured() || schemaEnsured) {
    return;
  }

  await queryPostgres("CREATE EXTENSION IF NOT EXISTS vector");
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      name text NOT NULL,
      description text,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      chunking_config jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id text PRIMARY KEY,
      knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      filename text NOT NULL,
      mime_type text NOT NULL,
      source_type text NOT NULL,
      status text NOT NULL,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      content text NOT NULL,
      chunk_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      processed_at timestamptz
    )
  `);
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id text PRIMARY KEY,
      document_id text NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      chunk_index integer NOT NULL,
      text_content text NOT NULL,
      token_count integer NOT NULL,
      start_offset integer NOT NULL,
      end_offset integer NOT NULL,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS knowledge_embeddings (
      chunk_id text PRIMARY KEY REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
      knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      embedding vector(${KNOWLEDGE_EMBEDDING_DIMENSIONS}) NOT NULL,
      embedding_json jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
  await queryPostgres(`
    CREATE INDEX IF NOT EXISTS knowledge_embeddings_hnsw_idx
    ON knowledge_embeddings
    USING hnsw (embedding vector_cosine_ops)
  `);

  schemaEnsured = true;
}

async function persistKnowledgeBase(base: KnowledgeBase): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }
  try {
    await ensureKnowledgeSchema();
    await queryPostgres(
      `INSERT INTO knowledge_bases (
        id, user_id, name, description, tags, metadata, chunking_config, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::timestamptz, $9::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        chunking_config = EXCLUDED.chunking_config,
        updated_at = EXCLUDED.updated_at`,
      [
        base.id,
        base.userId,
        base.name,
        base.description ?? null,
        JSON.stringify(base.tags),
        JSON.stringify(base.metadata),
        JSON.stringify(base.chunkingConfig),
        base.createdAt,
        base.updatedAt,
      ]
    );
  } catch (err) {
    console.error("[knowledge] Postgres persist failed, falling back to in-memory:", (err as Error).message);
  }
}

async function persistKnowledgeDocument(document: KnowledgeDocument): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }
  try {
    await ensureKnowledgeSchema();
    await queryPostgres(
      `INSERT INTO knowledge_documents (
        id, knowledge_base_id, user_id, filename, mime_type, source_type, status, tags, metadata,
        content, chunk_count, created_at, updated_at, processed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12::timestamptz, $13::timestamptz, $14::timestamptz
      )
      ON CONFLICT (id) DO UPDATE SET
        filename = EXCLUDED.filename,
        mime_type = EXCLUDED.mime_type,
        status = EXCLUDED.status,
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        content = EXCLUDED.content,
        chunk_count = EXCLUDED.chunk_count,
        updated_at = EXCLUDED.updated_at,
        processed_at = EXCLUDED.processed_at`,
      [
        document.id,
        document.knowledgeBaseId,
        document.userId,
        document.filename,
        document.mimeType,
        document.sourceType,
        document.status,
        JSON.stringify(document.tags),
        JSON.stringify(document.metadata),
        document.content,
        document.chunkCount,
        document.createdAt,
        document.updatedAt,
        document.processedAt ?? null,
      ]
    );
  } catch (err) {
    console.error("[knowledge] Postgres persist failed, falling back to in-memory:", (err as Error).message);
  }
}

async function persistKnowledgeChunk(chunk: KnowledgeChunk, embedding: number[]): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }
  try {
    await ensureKnowledgeSchema();
    await queryPostgres(
      `INSERT INTO knowledge_chunks (
        id, document_id, knowledge_base_id, user_id, chunk_index, text_content, token_count,
        start_offset, end_offset, tags, metadata, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::timestamptz, $13::timestamptz
      )
      ON CONFLICT (id) DO UPDATE SET
        text_content = EXCLUDED.text_content,
        token_count = EXCLUDED.token_count,
        start_offset = EXCLUDED.start_offset,
        end_offset = EXCLUDED.end_offset,
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        chunk.id,
        chunk.documentId,
        chunk.knowledgeBaseId,
        chunk.userId,
        chunk.index,
        chunk.text,
        chunk.tokenCount,
        chunk.startOffset,
        chunk.endOffset,
        JSON.stringify(chunk.tags),
        JSON.stringify(chunk.metadata),
        chunk.createdAt,
        chunk.updatedAt,
      ]
    );
    await queryPostgres(
      `INSERT INTO knowledge_embeddings (
        chunk_id, knowledge_base_id, user_id, embedding, embedding_json, created_at, updated_at
      ) VALUES ($1, $2, $3, $4::vector, $5::jsonb, $6::timestamptz, $7::timestamptz)
      ON CONFLICT (chunk_id) DO UPDATE SET
        embedding = EXCLUDED.embedding,
        embedding_json = EXCLUDED.embedding_json,
        updated_at = EXCLUDED.updated_at`,
      [
        chunk.id,
        chunk.knowledgeBaseId,
        chunk.userId,
        embeddingToVectorLiteral(embedding),
        JSON.stringify(embedding),
        chunk.createdAt,
        chunk.updatedAt,
      ]
    );
  } catch (err) {
    console.error("[knowledge] Postgres persist failed, falling back to in-memory:", (err as Error).message);
  }
}

async function hydrateKnowledgeBasesFromPostgres(userId: string): Promise<KnowledgeBase[]> {
  await ensureKnowledgeSchema();
  const result = await queryPostgres<PersistedKnowledgeBaseRow>(
    `SELECT * FROM knowledge_bases WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows.map(mapKnowledgeBase);
}

async function hydrateKnowledgeBaseFromPostgres(
  userId: string,
  id: string
): Promise<KnowledgeBase | undefined> {
  await ensureKnowledgeSchema();
  const result = await queryPostgres<PersistedKnowledgeBaseRow>(
    `SELECT * FROM knowledge_bases WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const row = result.rows[0];
  return row ? mapKnowledgeBase(row) : undefined;
}

async function hydrateDocumentsFromPostgres(
  userId: string,
  knowledgeBaseId: string
): Promise<KnowledgeDocument[]> {
  await ensureKnowledgeSchema();
  const result = await queryPostgres<PersistedKnowledgeDocumentRow>(
    `SELECT * FROM knowledge_documents
     WHERE user_id = $1 AND knowledge_base_id = $2
     ORDER BY created_at DESC`,
    [userId, knowledgeBaseId]
  );
  return result.rows.map(mapKnowledgeDocument);
}

async function hydrateChunksFromPostgres(
  userId: string,
  documentId: string
): Promise<KnowledgeChunk[]> {
  await ensureKnowledgeSchema();
  const result = await queryPostgres<PersistedKnowledgeChunkRow>(
    `SELECT * FROM knowledge_chunks
     WHERE user_id = $1 AND document_id = $2
     ORDER BY chunk_index ASC`,
    [userId, documentId]
  );
  return result.rows.map(mapKnowledgeChunk);
}

async function searchPostgres(
  input: KnowledgeSearchInput
): Promise<KnowledgeSearchResult[]> {
  await ensureKnowledgeSchema();
  const queryEmbedding = await embedText(input.query, input.openaiApiKey);
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
  const minScore = Math.max(input.minScore ?? 0, 0);
  const baseIds = input.knowledgeBaseIds?.filter(Boolean) ?? [];

  const filterSql = baseIds.length > 0 ? "AND kc.knowledge_base_id = ANY($4::text[])" : "";
  const params: unknown[] = [
    input.userId,
    input.query,
    embeddingToVectorLiteral(queryEmbedding),
  ];
  if (baseIds.length > 0) {
    params.push(baseIds);
  }

  const sql = `
    SELECT
      kb.id AS base_id,
      kb.name AS base_name,
      kb.description AS base_description,
      kb.tags AS base_tags,
      kb.metadata AS base_metadata,
      kb.chunking_config AS base_chunking_config,
      kb.created_at AS base_created_at,
      kb.updated_at AS base_updated_at,
      kd.id AS document_id,
      kd.filename,
      kd.mime_type,
      kd.source_type,
      kd.status AS document_status,
      kd.tags AS document_tags,
      kd.metadata AS document_metadata,
      kd.content,
      kd.chunk_count,
      kd.created_at AS document_created_at,
      kd.updated_at AS document_updated_at,
      kd.processed_at,
      kc.id AS chunk_id,
      kc.chunk_index,
      kc.text_content,
      kc.token_count,
      kc.start_offset,
      kc.end_offset,
      kc.tags AS chunk_tags,
      kc.metadata AS chunk_metadata,
      kc.created_at AS chunk_created_at,
      kc.updated_at AS chunk_updated_at,
      GREATEST(0, 1 - (ke.embedding <=> $3::vector)) AS semantic_score,
      CASE
        WHEN length(trim($2)) = 0 THEN 0
        ELSE ts_rank_cd(
          to_tsvector('simple', coalesce(kc.text_content, '')),
          websearch_to_tsquery('simple', $2)
        )
      END AS keyword_score
    FROM knowledge_chunks kc
    JOIN knowledge_embeddings ke ON ke.chunk_id = kc.id
    JOIN knowledge_documents kd ON kd.id = kc.document_id
    JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
    WHERE kc.user_id = $1
      ${filterSql}
    ORDER BY semantic_score DESC, keyword_score DESC, kc.updated_at DESC
    LIMIT ${limit * 3}
  `;

  const result = await queryPostgres<Record<string, unknown>>(sql, params);
  return result.rows
    .map((row) => {
      const semanticScore = Number(row["semantic_score"] ?? 0);
      const keyword = Number(row["keyword_score"] ?? 0);
      const keywordNormalized = keyword > 0 ? Math.min(keyword, 1) : 0;
      const score = semanticScore * 0.8 + keywordNormalized * 0.2;
      const base: KnowledgeBase = {
        id: String(row["base_id"]),
        userId: input.userId,
        name: String(row["base_name"]),
        description: (row["base_description"] as string | null) ?? undefined,
        tags: sanitizeTags(parseJsonColumn(row["base_tags"], [] as string[])),
        metadata: parseJsonColumn(row["base_metadata"], {} as Record<string, unknown>),
        chunkingConfig: resolveChunkingConfig(
          parseJsonColumn(row["base_chunking_config"], DEFAULT_CHUNKING_CONFIG)
        ),
        createdAt: String(row["base_created_at"]),
        updatedAt: String(row["base_updated_at"]),
      };
      const document: KnowledgeDocument = {
        id: String(row["document_id"]),
        knowledgeBaseId: base.id,
        userId: input.userId,
        filename: String(row["filename"]),
        mimeType: String(row["mime_type"]),
        sourceType: row["source_type"] === "upload" ? "upload" : "inline",
        status:
          row["document_status"] === "failed"
            ? "failed"
            : row["document_status"] === "processing"
              ? "processing"
              : "ready",
        tags: sanitizeTags(parseJsonColumn(row["document_tags"], [] as string[])),
        metadata: parseJsonColumn(row["document_metadata"], {} as Record<string, unknown>),
        content: String(row["content"]),
        chunkCount: Number(row["chunk_count"] ?? 0),
        createdAt: String(row["document_created_at"]),
        updatedAt: String(row["document_updated_at"]),
        processedAt: (row["processed_at"] as string | null) ?? undefined,
      };
      const chunk: KnowledgeChunk = {
        id: String(row["chunk_id"]),
        documentId: document.id,
        knowledgeBaseId: base.id,
        userId: input.userId,
        index: Number(row["chunk_index"] ?? 0),
        text: String(row["text_content"]),
        tokenCount: Number(row["token_count"] ?? 0),
        startOffset: Number(row["start_offset"] ?? 0),
        endOffset: Number(row["end_offset"] ?? 0),
        tags: sanitizeTags(parseJsonColumn(row["chunk_tags"], [] as string[])),
        metadata: parseJsonColumn(row["chunk_metadata"], {} as Record<string, unknown>),
        createdAt: String(row["chunk_created_at"]),
        updatedAt: String(row["chunk_updated_at"]),
      };
      return {
        chunk,
        document,
        knowledgeBase: base,
        score,
        semanticScore,
        keywordScore: keywordNormalized,
      };
    })
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export const knowledgeStore = {
  async createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBase> {
    const timestamp = nowIso();
    const base: KnowledgeBase = {
      id: randomUUID(),
      userId: input.userId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      tags: sanitizeTags(input.tags ?? []),
      metadata: input.metadata ?? {},
      chunkingConfig: resolveChunkingConfig(input.chunkingConfig),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    knowledgeBases.set(base.id, base);
    await persistKnowledgeBase(base);
    return base;
  },

  async listKnowledgeBases(userId: string): Promise<KnowledgeBase[]> {
    const local = Array.from(knowledgeBases.values()).filter((base) => base.userId === userId);
    if (local.length > 0 || !isPostgresConfigured()) {
      return local.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    try {
      return await hydrateKnowledgeBasesFromPostgres(userId);
    } catch (err) {
      console.error("[knowledge] Postgres hydrate failed, falling back to in-memory:", (err as Error).message);
      return local;
    }
  },

  async getKnowledgeBase(id: string, userId: string): Promise<KnowledgeBase | undefined> {
    const local = knowledgeBases.get(id);
    if (local?.userId === userId) {
      return local;
    }
    if (!isPostgresConfigured()) {
      return undefined;
    }
    try {
      return await hydrateKnowledgeBaseFromPostgres(userId, id);
    } catch (err) {
      console.error("[knowledge] Postgres hydrate failed, falling back to in-memory:", (err as Error).message);
      return undefined;
    }
  },

  async updateKnowledgeBase(
    id: string,
    userId: string,
    patch: Partial<Pick<KnowledgeBase, "name" | "description" | "tags" | "metadata">> & {
      chunkingConfig?: Partial<ChunkingConfig>;
    }
  ): Promise<KnowledgeBase | undefined> {
    const existing = await this.getKnowledgeBase(id, userId);
    if (!existing) {
      return undefined;
    }
    const updated: KnowledgeBase = {
      ...existing,
      name: typeof patch.name === "string" && patch.name.trim() ? patch.name.trim() : existing.name,
      description:
        patch.description !== undefined ? patch.description?.trim() || undefined : existing.description,
      tags: patch.tags ? sanitizeTags(patch.tags) : existing.tags,
      metadata: patch.metadata ?? existing.metadata,
      chunkingConfig: patch.chunkingConfig
        ? resolveChunkingConfig({ ...existing.chunkingConfig, ...patch.chunkingConfig })
        : existing.chunkingConfig,
      updatedAt: nowIso(),
    };
    knowledgeBases.set(updated.id, updated);
    await persistKnowledgeBase(updated);
    return updated;
  },

  async ingestDocument(input: IngestKnowledgeDocumentInput): Promise<{
    document: KnowledgeDocument;
    chunks: KnowledgeChunk[];
  }> {
    const base = await this.getKnowledgeBase(input.knowledgeBaseId, input.userId);
    if (!base) {
      throw new Error(`Knowledge base not found: ${input.knowledgeBaseId}`);
    }

    const createdAt = nowIso();
    const document: KnowledgeDocument = {
      id: randomUUID(),
      knowledgeBaseId: base.id,
      userId: input.userId,
      filename: input.filename,
      mimeType: input.mimeType,
      sourceType: input.sourceType,
      status: "processing",
      tags: sanitizeTags(input.tags ?? []),
      metadata: input.metadata ?? {},
      content: input.content,
      chunkCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    knowledgeDocuments.set(document.id, document);
    await persistKnowledgeDocument(document);

    const chunkDrafts = chunkDocument(input.content, base.chunkingConfig);
    const chunks: KnowledgeChunk[] = [];
    for (const draft of chunkDrafts) {
      const timestamp = nowIso();
      const chunk: KnowledgeChunk = {
        id: randomUUID(),
        documentId: document.id,
        knowledgeBaseId: base.id,
        userId: input.userId,
        index: draft.index,
        text: draft.text,
        tokenCount: draft.tokenCount,
        startOffset: draft.startOffset,
        endOffset: draft.endOffset,
        tags: document.tags,
        metadata: {
          filename: document.filename,
          mimeType: document.mimeType,
          ...document.metadata,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      knowledgeChunks.set(chunk.id, chunk);
      const embedding = await embedText(chunk.text, input.openaiApiKey);
      chunkEmbeddings.set(chunk.id, embedding);
      await persistKnowledgeChunk(chunk, embedding);
      chunks.push(chunk);
    }

    const readyDocument: KnowledgeDocument = {
      ...document,
      status: "ready",
      chunkCount: chunks.length,
      processedAt: nowIso(),
      updatedAt: nowIso(),
    };
    knowledgeDocuments.set(readyDocument.id, readyDocument);
    await persistKnowledgeDocument(readyDocument);

    return { document: readyDocument, chunks };
  },

  async listDocuments(knowledgeBaseId: string, userId: string): Promise<KnowledgeDocument[]> {
    const local = Array.from(knowledgeDocuments.values()).filter(
      (document) => document.userId === userId && document.knowledgeBaseId === knowledgeBaseId
    );
    if (local.length > 0 || !isPostgresConfigured()) {
      return local.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    try {
      return await hydrateDocumentsFromPostgres(userId, knowledgeBaseId);
    } catch (err) {
      console.error("[knowledge] Postgres hydrate failed, falling back to in-memory:", (err as Error).message);
      return local;
    }
  },

  async getDocument(documentId: string, userId: string): Promise<KnowledgeDocument | undefined> {
    const local = knowledgeDocuments.get(documentId);
    if (local?.userId === userId) {
      return local;
    }
    if (!isPostgresConfigured()) {
      return undefined;
    }
    try {
      await ensureKnowledgeSchema();
      const result = await queryPostgres<PersistedKnowledgeDocumentRow>(
        `SELECT * FROM knowledge_documents WHERE id = $1 AND user_id = $2`,
        [documentId, userId]
      );
      const row = result.rows[0];
      return row ? mapKnowledgeDocument(row) : undefined;
    } catch (err) {
      console.error("[knowledge] Postgres hydrate failed, falling back to in-memory:", (err as Error).message);
      return undefined;
    }
  },

  async listChunks(documentId: string, userId: string): Promise<KnowledgeChunk[]> {
    const local = Array.from(knowledgeChunks.values()).filter(
      (chunk) => chunk.userId === userId && chunk.documentId === documentId
    );
    if (local.length > 0 || !isPostgresConfigured()) {
      return local.sort((a, b) => a.index - b.index);
    }
    try {
      return await hydrateChunksFromPostgres(userId, documentId);
    } catch (err) {
      console.error("[knowledge] Postgres hydrate failed, falling back to in-memory:", (err as Error).message);
      return local;
    }
  },

  async updateChunk(
    chunkId: string,
    userId: string,
    patch: Partial<Pick<KnowledgeChunk, "text" | "tags" | "metadata">>,
    openaiApiKey?: string
  ): Promise<KnowledgeChunk | undefined> {
    const existing = knowledgeChunks.get(chunkId);
    if (!existing || existing.userId !== userId) {
      return undefined;
    }
    const updated: KnowledgeChunk = {
      ...existing,
      text: typeof patch.text === "string" && patch.text.trim() ? patch.text.trim() : existing.text,
      tokenCount:
        typeof patch.text === "string" && patch.text.trim()
          ? patch.text.trim().split(/\s+/).filter(Boolean).length
          : existing.tokenCount,
      tags: patch.tags ? sanitizeTags(patch.tags) : existing.tags,
      metadata: patch.metadata ?? existing.metadata,
      updatedAt: nowIso(),
    };
    knowledgeChunks.set(updated.id, updated);
    const embedding = await embedText(updated.text, openaiApiKey);
    chunkEmbeddings.set(updated.id, embedding);
    await persistKnowledgeChunk(updated, embedding);
    return updated;
  },

  async splitChunk(
    chunkId: string,
    userId: string,
    parts: string[],
    openaiApiKey?: string
  ): Promise<KnowledgeChunk[] | undefined> {
    const existing = knowledgeChunks.get(chunkId);
    if (!existing || existing.userId !== userId) {
      return undefined;
    }

    const sanitizedParts = parts.map((part) => part.trim()).filter(Boolean);
    if (sanitizedParts.length < 2) {
      throw new Error("split requires at least two non-empty parts");
    }

    knowledgeChunks.delete(chunkId);
    chunkEmbeddings.delete(chunkId);

    const siblings = Array.from(knowledgeChunks.values())
      .filter((chunk) => chunk.documentId === existing.documentId)
      .sort((a, b) => a.index - b.index);

    const insertIndex = existing.index;
    const nextChunks: KnowledgeChunk[] = [];
    let offsetCursor = existing.startOffset;
    for (let i = 0; i < sanitizedParts.length; i += 1) {
      const text = sanitizedParts[i];
      const timestamp = nowIso();
      const chunk: KnowledgeChunk = {
        ...existing,
        id: randomUUID(),
        index: insertIndex + i,
        text,
        tokenCount: text.split(/\s+/).filter(Boolean).length,
        startOffset: offsetCursor,
        endOffset: offsetCursor + text.length,
        updatedAt: timestamp,
        createdAt: timestamp,
      };
      offsetCursor = chunk.endOffset;
      knowledgeChunks.set(chunk.id, chunk);
      const embedding = await embedText(chunk.text, openaiApiKey);
      chunkEmbeddings.set(chunk.id, embedding);
      await persistKnowledgeChunk(chunk, embedding);
      nextChunks.push(chunk);
    }

    const reordered = [...siblings.filter((chunk) => chunk.id !== chunkId), ...nextChunks].sort(
      (a, b) => a.index - b.index
    );
    reordered.forEach((chunk, index) => {
      chunk.index = index;
      knowledgeChunks.set(chunk.id, chunk);
    });

    return nextChunks.sort((a, b) => a.index - b.index);
  },

  async mergeChunks(
    chunkIds: string[],
    userId: string,
    openaiApiKey?: string
  ): Promise<KnowledgeChunk | undefined> {
    const selected = chunkIds
      .map((chunkId) => knowledgeChunks.get(chunkId))
      .filter((chunk): chunk is KnowledgeChunk => Boolean(chunk) && chunk!.userId === userId)
      .sort((a, b) => a.index - b.index);

    if (selected.length < 2) {
      return undefined;
    }

    const mergedText = selected.map((chunk) => chunk.text.trim()).filter(Boolean).join("\n\n");
    const first = selected[0];
    const merged = await this.updateChunk(
      first.id,
      userId,
      {
        text: mergedText,
        tags: Array.from(new Set(selected.flatMap((chunk) => chunk.tags))),
      },
      openaiApiKey
    );

    for (const chunk of selected.slice(1)) {
      knowledgeChunks.delete(chunk.id);
      chunkEmbeddings.delete(chunk.id);
    }

    return merged;
  },

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    const query = input.query.trim();
    if (!query) {
      return [];
    }

    const localChunks = Array.from(knowledgeChunks.values()).filter((chunk) => {
      if (chunk.userId !== input.userId) {
        return false;
      }
      if (
        input.knowledgeBaseIds &&
        input.knowledgeBaseIds.length > 0 &&
        !input.knowledgeBaseIds.includes(chunk.knowledgeBaseId)
      ) {
        return false;
      }
      return true;
    });

    if (localChunks.length === 0 && isPostgresConfigured()) {
      try {
        return await searchPostgres(input);
      } catch (err) {
        console.error("[knowledge] Postgres search failed, falling back to in-memory:", (err as Error).message);
      }
    }

    const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
    const minScore = Math.max(input.minScore ?? 0, 0);
    const queryEmbedding = await embedText(query, input.openaiApiKey);

    return localChunks
      .map((chunk) => {
        const embedding = chunkEmbeddings.get(chunk.id) ?? [];
        const semanticScore = cosineSimilarity(queryEmbedding, embedding);
        const lexicalScore = keywordScore(chunk.text, query);
        const score = semanticScore * 0.8 + lexicalScore * 0.2;
        const document = knowledgeDocuments.get(chunk.documentId);
        const knowledgeBase = knowledgeBases.get(chunk.knowledgeBaseId);
        if (!document || !knowledgeBase) {
          return null;
        }
        return {
          chunk,
          document,
          knowledgeBase,
          score,
          semanticScore,
          keywordScore: lexicalScore,
        };
      })
      .filter((candidate): candidate is KnowledgeSearchResult => Boolean(candidate))
      .filter((candidate) => candidate.score >= minScore)
      .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
      .slice(0, limit);
  },

  clear(): void {
    knowledgeBases.clear();
    knowledgeDocuments.clear();
    knowledgeChunks.clear();
    chunkEmbeddings.clear();
    schemaEnsured = false;
  },
};
