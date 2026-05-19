import { createHash, randomBytes } from "crypto";
import type { Pool, PoolClient } from "pg";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { recordActionWithin } from "../auditing/auditService";

export interface ApiKeyContext {
  workspaceId: string;
  userId: string;
}

export interface ApiKeyRecord {
  id: string;
  workspaceId: string;
  name: string;
  maskedKey: string;
  createdByUserId: string;
  rotatedFromKeyId: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyCreationResult {
  key: ApiKeyRecord;
  secret: string;
}

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  key_last4: string;
  created_by_user_id: string;
  rotated_from_key_id: string | null;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MemoryApiKeyRecord extends ApiKeyRecord {
  keyHash: string;
  keyPrefix: string;
  keyLast4: string;
}

export class ApiKeyStoreError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

const KEY_PREFIX = "afk_";
const KEY_RANDOM_BYTES = 32;
const MASK_VISIBLE_PREFIX_LENGTH = 8;

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateApiKeyName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeName(value);
  if (!normalized || normalized.length > 80) {
    return null;
  }
  return normalized;
}

function generateSecret(): string {
  return `${KEY_PREFIX}${randomBytes(KEY_RANDOM_BYTES).toString("base64url")}`;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function secretParts(secret: string): { keyPrefix: string; keyLast4: string; maskedKey: string } {
  const keyPrefix = secret.slice(0, MASK_VISIBLE_PREFIX_LENGTH);
  const keyLast4 = secret.slice(-4);
  return {
    keyPrefix,
    keyLast4,
    maskedKey: `${keyPrefix}...${keyLast4}`,
  };
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    maskedKey: `${row.key_prefix}...${row.key_last4}`,
    createdByUserId: row.created_by_user_id,
    rotatedFromKeyId: row.rotated_from_key_id,
    lastUsedAt: iso(row.last_used_at),
    revokedAt: iso(row.revoked_at),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

function withoutSecret(record: MemoryApiKeyRecord): ApiKeyRecord {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    name: record.name,
    maskedKey: record.maskedKey,
    createdByUserId: record.createdByUserId,
    rotatedFromKeyId: record.rotatedFromKeyId,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function recordAudit(
  client: PoolClient,
  ctx: ApiKeyContext,
  action: "api_key.create" | "api_key.rotate" | "api_key.revoke",
  key: ApiKeyRecord,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await recordActionWithin(
    client,
    {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      actorUserId: ctx.userId,
    },
    {
      category: "auth",
      action,
      target: { type: "api_key", id: key.id },
      metadata: {
        name: key.name,
        masked_key: key.maskedKey,
        ...metadata,
      },
    },
  );
}

export class ApiKeyStore {
  private readonly memory = new Map<string, MemoryApiKeyRecord>();

  constructor(private readonly pool?: Pool) {}

  clearMemory(): void {
    this.memory.clear();
  }

  private getPool(): Pool | null {
    if (!isPostgresPersistenceEnabled()) {
      return null;
    }
    return this.pool ?? getPostgresPool();
  }

  async list(ctx: ApiKeyContext): Promise<ApiKeyRecord[]> {
    const pool = this.getPool();
    if (!pool) {
      return Array.from(this.memory.values())
        .filter((key) => key.workspaceId === ctx.workspaceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(withoutSecret);
    }

    return withWorkspaceContext(pool, ctx, async (client) => {
      const result = await client.query<ApiKeyRow>(
        `SELECT id, workspace_id, name, key_prefix, key_last4, created_by_user_id,
                rotated_from_key_id, last_used_at, revoked_at, created_at, updated_at
           FROM workspace_api_keys
          WHERE workspace_id = $1
          ORDER BY created_at DESC`,
        [ctx.workspaceId],
      );
      return result.rows.map(rowToRecord);
    });
  }

  async create(ctx: ApiKeyContext, name: string): Promise<ApiKeyCreationResult> {
    const secret = generateSecret();
    const keyHash = hashSecret(secret);
    const parts = secretParts(secret);
    const pool = this.getPool();

    if (!pool) {
      const now = new Date().toISOString();
      const key: MemoryApiKeyRecord = {
        id: randomBytes(16).toString("hex"),
        workspaceId: ctx.workspaceId,
        name,
        maskedKey: parts.maskedKey,
        keyHash,
        keyPrefix: parts.keyPrefix,
        keyLast4: parts.keyLast4,
        createdByUserId: ctx.userId,
        rotatedFromKeyId: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.memory.set(key.id, key);
      return { key: withoutSecret(key), secret };
    }

    const key = await withWorkspaceContext(pool, ctx, async (client) => {
      const result = await client.query<ApiKeyRow>(
        `INSERT INTO workspace_api_keys (
           workspace_id, name, key_hash, key_prefix, key_last4, created_by_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, workspace_id, name, key_prefix, key_last4, created_by_user_id,
                   rotated_from_key_id, last_used_at, revoked_at, created_at, updated_at`,
        [ctx.workspaceId, name, keyHash, parts.keyPrefix, parts.keyLast4, ctx.userId],
      );
      const created = rowToRecord(result.rows[0]);
      await recordAudit(client, ctx, "api_key.create", created);
      return created;
    });

    return { key, secret };
  }

  async revoke(ctx: ApiKeyContext, id: string): Promise<ApiKeyRecord | null> {
    const pool = this.getPool();
    if (!pool) {
      const existing = this.memory.get(id);
      if (!existing || existing.workspaceId !== ctx.workspaceId) {
        return null;
      }
      const now = new Date().toISOString();
      const updated: MemoryApiKeyRecord = { ...existing, revokedAt: existing.revokedAt ?? now, updatedAt: now };
      this.memory.set(id, updated);
      return withoutSecret(updated);
    }

    return withWorkspaceContext(pool, ctx, async (client) => {
      const result = await client.query<ApiKeyRow>(
        `UPDATE workspace_api_keys
            SET revoked_at = COALESCE(revoked_at, now()),
                updated_at = now()
          WHERE id = $1 AND workspace_id = $2
        RETURNING id, workspace_id, name, key_prefix, key_last4, created_by_user_id,
                  rotated_from_key_id, last_used_at, revoked_at, created_at, updated_at`,
        [id, ctx.workspaceId],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      const revoked = rowToRecord(row);
      await recordAudit(client, ctx, "api_key.revoke", revoked);
      return revoked;
    });
  }

  async rotate(ctx: ApiKeyContext, id: string): Promise<ApiKeyCreationResult | null> {
    const secret = generateSecret();
    const keyHash = hashSecret(secret);
    const parts = secretParts(secret);
    const pool = this.getPool();

    if (!pool) {
      const existing = this.memory.get(id);
      if (!existing || existing.workspaceId !== ctx.workspaceId) {
        return null;
      }
      if (existing.revokedAt) {
        throw new ApiKeyStoreError("Cannot rotate a revoked API key.", 409);
      }
      const now = new Date().toISOString();
      this.memory.set(id, { ...existing, revokedAt: now, updatedAt: now });
      const replacement: MemoryApiKeyRecord = {
        id: randomBytes(16).toString("hex"),
        workspaceId: ctx.workspaceId,
        name: existing.name,
        maskedKey: parts.maskedKey,
        keyHash,
        keyPrefix: parts.keyPrefix,
        keyLast4: parts.keyLast4,
        createdByUserId: ctx.userId,
        rotatedFromKeyId: existing.id,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.memory.set(replacement.id, replacement);
      return { key: withoutSecret(replacement), secret };
    }

    return withWorkspaceContext(pool, ctx, async (client) => {
      const existingResult = await client.query<ApiKeyRow>(
        `SELECT id, workspace_id, name, key_prefix, key_last4, created_by_user_id,
                rotated_from_key_id, last_used_at, revoked_at, created_at, updated_at
           FROM workspace_api_keys
          WHERE id = $1 AND workspace_id = $2
          FOR UPDATE`,
        [id, ctx.workspaceId],
      );
      const existingRow = existingResult.rows[0];
      if (!existingRow) {
        return null;
      }
      if (existingRow.revoked_at) {
        throw new ApiKeyStoreError("Cannot rotate a revoked API key.", 409);
      }

      await client.query(
        `UPDATE workspace_api_keys
            SET revoked_at = now(),
                updated_at = now()
          WHERE id = $1 AND workspace_id = $2`,
        [id, ctx.workspaceId],
      );

      const result = await client.query<ApiKeyRow>(
        `INSERT INTO workspace_api_keys (
           workspace_id, name, key_hash, key_prefix, key_last4,
           created_by_user_id, rotated_from_key_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, workspace_id, name, key_prefix, key_last4, created_by_user_id,
                   rotated_from_key_id, last_used_at, revoked_at, created_at, updated_at`,
        [
          ctx.workspaceId,
          existingRow.name,
          keyHash,
          parts.keyPrefix,
          parts.keyLast4,
          ctx.userId,
          existingRow.id,
        ],
      );
      const replacement = rowToRecord(result.rows[0]);
      await recordAudit(client, ctx, "api_key.rotate", replacement, {
        rotated_from_key_id: existingRow.id,
      });
      return { key: replacement, secret };
    });
  }
}

export const apiKeyStore = new ApiKeyStore();
