/**
 * fileObjectStore — persistence for the `file_objects` metadata table (HEL-354).
 *
 * Dual-path per the double-locked fallback (autoflow-backend skill):
 *  - Postgres (canonical): reads/writes run inside `withWorkspaceContext` so the
 *    migration-096 RLS policy applies. Belt-and-suspenders, EVERY query also
 *    carries an explicit `workspace_id = $` predicate so cross-tenant access is
 *    refused even if the app's DB role were ever RLS-bypassing (Sally asking for
 *    George's fileId gets 0 rows → the route returns 404).
 *  - In-memory (dev/test): a process-local Map keyed by workspace, gated by
 *    `inMemoryAllowed()`.
 */

import { randomUUID } from "crypto";
import { isPostgresConfigured, inMemoryAllowed, getPostgresPool } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { parseStorageKey } from "./storageKey";

export interface FileObjectRow {
  id: string;
  workspaceId: string;
  uploadedBy: string;
  collection: string;
  storageKey: string;
  provider: string;
  bucket: string | null;
  filename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
  retentionClass: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  deletedAt: string | null;
}

export interface FileObjectContext {
  workspaceId: string;
  userId: string;
}

export interface InsertFileObjectInput {
  uploadedBy: string;
  collection: string;
  storageKey: string;
  provider: string;
  bucket?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  retentionClass?: string;
}

// In-memory backend: Map<workspaceId, Map<fileId, row>>. Production uses the
// "pg" backend (see backend() below); this in-memory path is reachable only
// when Postgres is unconfigured AND inMemoryAllowed() (development/test).
// allowlist: dev/test-only fallback when Postgres is unconfigured — never holds prod data of record (HEL-606).
const memStore = new Map<string, Map<string, FileObjectRow>>();

function memWorkspace(workspaceId: string): Map<string, FileObjectRow> {
  let bucket = memStore.get(workspaceId);
  if (!bucket) {
    bucket = new Map();
    memStore.set(workspaceId, bucket);
  }
  return bucket;
}

function backend(): "pg" | "memory" {
  if (isPostgresConfigured()) return "pg";
  if (inMemoryAllowed()) return "memory";
  throw new Error("DATABASE_URL is required for file_objects outside development/test");
}

interface FileObjectDbRow {
  id: string;
  workspace_id: string;
  uploaded_by: string;
  collection: string;
  storage_key: string;
  provider: string;
  bucket: string | null;
  filename: string | null;
  mime_type: string | null;
  byte_size: string | number | null;
  sha256: string | null;
  retention_class: string;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowFromDb(r: FileObjectDbRow): FileObjectRow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    uploadedBy: r.uploaded_by,
    collection: r.collection,
    storageKey: r.storage_key,
    provider: r.provider,
    bucket: r.bucket,
    filename: r.filename,
    mimeType: r.mime_type,
    byteSize: r.byte_size == null ? null : Number(r.byte_size),
    sha256: r.sha256,
    retentionClass: r.retention_class,
    metadata: r.metadata ?? {},
    createdAt: toIso(r.created_at),
    deletedAt: r.deleted_at == null ? null : toIso(r.deleted_at),
  };
}

export const fileObjectStore = {
  async insert(ctx: FileObjectContext, input: InsertFileObjectInput): Promise<FileObjectRow> {
    // HEL-358 invariant: the stored key's retention prefix MUST match the
    // retention_class column — otherwise the bucket lifecycle rule (keyed on the
    // prefix) and the DB row would disagree about when the object expires.
    const declaredRetention = input.retentionClass ?? "standard";
    const parsedRef = parseStorageKey(input.storageKey);
    if (parsedRef?.retentionClass && parsedRef.retentionClass !== declaredRetention) {
      throw new Error(
        `fileObjectStore.insert: retention_class '${declaredRetention}' != storage key prefix ` +
          `'${parsedRef.retentionClass}' (${input.storageKey})`,
      );
    }
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query<FileObjectDbRow>(
          `INSERT INTO file_objects
             (workspace_id, uploaded_by, collection, storage_key, provider, bucket,
              filename, mime_type, byte_size, retention_class)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'standard'))
           RETURNING *`,
          [
            ctx.workspaceId,
            input.uploadedBy,
            input.collection,
            input.storageKey,
            input.provider,
            input.bucket ?? null,
            input.filename ?? null,
            input.mimeType ?? null,
            input.byteSize ?? null,
            input.retentionClass ?? null,
          ],
        );
        return rowFromDb(res.rows[0]);
      });
    }

    const row: FileObjectRow = {
      id: randomUUID(),
      workspaceId: ctx.workspaceId,
      uploadedBy: input.uploadedBy,
      collection: input.collection,
      storageKey: input.storageKey,
      provider: input.provider,
      bucket: input.bucket ?? null,
      filename: input.filename ?? null,
      mimeType: input.mimeType ?? null,
      byteSize: input.byteSize ?? null,
      sha256: null,
      retentionClass: input.retentionClass ?? "standard",
      metadata: {},
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    memWorkspace(ctx.workspaceId).set(row.id, row);
    return row;
  },

  /** Returns the row only if it belongs to ctx.workspaceId (else null → route 404). */
  async getById(ctx: FileObjectContext, fileId: string): Promise<FileObjectRow | null> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query<FileObjectDbRow>(
          `SELECT * FROM file_objects WHERE id = $1 AND workspace_id = $2`,
          [fileId, ctx.workspaceId],
        );
        return res.rows[0] ? rowFromDb(res.rows[0]) : null;
      });
    }
    return memWorkspace(ctx.workspaceId).get(fileId) ?? null;
  },

  /** Soft-delete (sets deleted_at). Returns false if missing/foreign/already-deleted. */
  async softDelete(ctx: FileObjectContext, fileId: string): Promise<boolean> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = await client.query(
          `UPDATE file_objects SET deleted_at = now()
           WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
          [fileId, ctx.workspaceId],
        );
        return (res.rowCount ?? 0) > 0;
      });
    }
    const row = memWorkspace(ctx.workspaceId).get(fileId);
    if (!row || row.deletedAt) return false;
    row.deletedAt = new Date().toISOString();
    return true;
  },

  async listByWorkspace(ctx: FileObjectContext, collection?: string): Promise<FileObjectRow[]> {
    if (backend() === "pg") {
      const pool = getPostgresPool();
      return withWorkspaceContext(pool, ctx, async (client) => {
        const res = collection
          ? await client.query<FileObjectDbRow>(
              `SELECT * FROM file_objects
               WHERE workspace_id = $1 AND collection = $2 AND deleted_at IS NULL
               ORDER BY created_at DESC`,
              [ctx.workspaceId, collection],
            )
          : await client.query<FileObjectDbRow>(
              `SELECT * FROM file_objects
               WHERE workspace_id = $1 AND deleted_at IS NULL
               ORDER BY created_at DESC`,
              [ctx.workspaceId],
            );
        return res.rows.map(rowFromDb);
      });
    }
    return [...memWorkspace(ctx.workspaceId).values()]
      .filter((r) => !r.deletedAt && (!collection || r.collection === collection))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /** Test-only: clear the in-memory backend. */
  __resetForTests(): void {
    memStore.clear();
  },
};

export type FileObjectStore = typeof fileObjectStore;
