/**
 * File routes (HEL-354): signed-URL upload / download / delete under /api/files.
 *
 * Clients never see raw bucket keys. Signed URLs are issued server-side after
 * re-resolving the requested fileId against `req.workspaceId` — a request for
 * another workspace's fileId returns 404 (no existence leak). Mounted with
 * `requireAuth` + `workspaceResolver` in src/app.ts.
 */

import { Router } from "express";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { asyncHandler } from "../middleware/asyncHandler";
import { getStorageAdapter, parseStorageKey } from "./index";
import { fileObjectStore } from "./fileObjectStore";
import { enqueueObjectDeletion } from "../queue/storageQueue";
import { auditService } from "../auditing/auditService";

const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB, matches the multer cap.
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes.
const DEFAULT_COLLECTION = "uploads";

/**
 * Server-side mime allowlist. Anything not listed is rejected — this denies
 * executables, archives / zip-bombs, and other unexpected payloads by default.
 */
const MIME_ALLOWLIST = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/json",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "video/mp4",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function maxUploadBytes(): number {
  const v = Number(process.env.STORAGE_MAX_UPLOAD_BYTES);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_UPLOAD_BYTES;
}

function signedUrlTtlSeconds(): number {
  const v = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_SIGNED_URL_TTL_SECONDS;
}

/**
 * HEL-359: append a `storage` audit row for a /api/files operation — success,
 * failure, or cross-workspace rejection. Records (user_id, workspace_id,
 * file_id, action, bytes, ip) in the canonical `audit_log` via auditService.
 *
 * Best-effort (fail-open): a write failure (e.g. no Postgres in dev) is logged
 * but never fails the storage op itself. Production always has Postgres, so the
 * row is reliably written there. Skips entirely when there's no resolvable
 * actor/workspace (401s are handled upstream).
 */
async function auditStorage(
  req: WorkspaceAwareRequest,
  entry: {
    action: string;
    fileId?: string | null;
    bytes?: number | null;
    reason?: string;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  const workspaceId = req.workspaceId;
  const userId = req.auth?.sub;
  if (!workspaceId || !userId) return;
  try {
    await auditService.recordAction(
      { workspaceId, userId, actorUserId: userId },
      {
        category: "storage",
        action: entry.action,
        target: entry.fileId ? { type: "file_object", id: entry.fileId } : null,
        metadata: {
          fileId: entry.fileId ?? null,
          bytes: entry.bytes ?? null,
          ip: req.ip ?? null,
          ...(entry.reason ? { reason: entry.reason } : {}),
          ...(entry.extra ?? {}),
        },
      },
    );
  } catch (err) {
    console.error(
      `[storage] audit failed (${entry.action}${entry.fileId ? `, file ${entry.fileId}` : ""}):`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function createFileRoutes(): Router {
  const router = Router();

  // POST /api/files/upload-url — issue a presigned PUT + create the file_objects row.
  router.post(
    "/upload-url",
    asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
      const workspaceId = req.workspaceId;
      const userId = req.auth?.sub;
      if (!workspaceId || !userId) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      const { filename, contentType, collection, sizeBytes } = (req.body ?? {}) as {
        filename?: unknown;
        contentType?: unknown;
        collection?: unknown;
        sizeBytes?: unknown;
      };

      if (typeof filename !== "string" || filename.trim().length === 0) {
        await auditStorage(req, { action: "file_upload_url_denied", reason: "filename_required" });
        res.status(400).json({ error: "filename is required" });
        return;
      }
      if (typeof contentType !== "string" || contentType.trim().length === 0) {
        await auditStorage(req, { action: "file_upload_url_denied", reason: "content_type_required", extra: { filename } });
        res.status(400).json({ error: "contentType is required" });
        return;
      }
      if (!MIME_ALLOWLIST.has(contentType)) {
        await auditStorage(req, { action: "file_upload_url_denied", reason: "mime_not_allowed", extra: { filename, contentType } });
        res.status(400).json({ error: `contentType not allowed: ${contentType}`, code: "mime_not_allowed" });
        return;
      }
      if (sizeBytes !== undefined) {
        if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
          await auditStorage(req, { action: "file_upload_url_denied", reason: "invalid_size", extra: { filename } });
          res.status(400).json({ error: "sizeBytes must be a non-negative number" });
          return;
        }
        if (sizeBytes > maxUploadBytes()) {
          await auditStorage(req, { action: "file_upload_url_denied", reason: "size_exceeded", bytes: sizeBytes, extra: { filename } });
          res.status(400).json({ error: `file exceeds the ${maxUploadBytes()}-byte limit`, code: "size_exceeded" });
          return;
        }
      }

      const adapter = getStorageAdapter();
      const coll = typeof collection === "string" && collection.length > 0 ? collection : DEFAULT_COLLECTION;

      let signed;
      try {
        signed = await adapter.getSignedUploadUrl({ workspaceId, collection: coll, filename, contentType });
      } catch (err) {
        // e.g. StorageKeyError for an invalid collection token.
        await auditStorage(req, { action: "file_upload_url_denied", reason: "adapter_error", extra: { filename, collection: coll } });
        res.status(400).json({ error: (err as Error).message });
        return;
      }

      const row = await fileObjectStore.insert(
        { workspaceId, userId },
        {
          uploadedBy: userId,
          collection: coll,
          storageKey: signed.storageKey,
          provider: adapter.provider,
          bucket: adapter.bucket,
          filename,
          mimeType: contentType,
          byteSize: typeof sizeBytes === "number" ? sizeBytes : null,
        },
      );

      await auditStorage(req, {
        action: "file_upload_url_issued",
        fileId: row.id,
        bytes: typeof sizeBytes === "number" ? sizeBytes : null,
        extra: { collection: coll, mimeType: contentType },
      });

      res.status(201).json({
        fileId: row.id,
        uploadUrl: signed.url,
        method: signed.method,
        headers: signed.headers,
        expiresAt: signed.expiresAt,
      });
    }),
  );

  // GET /api/files/:fileId — 302 to a short-lived signed download URL.
  router.get(
    "/:fileId",
    asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
      const workspaceId = req.workspaceId;
      const userId = req.auth?.sub;
      if (!workspaceId || !userId) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      const row = await fileObjectStore.getById({ workspaceId, userId }, req.params.fileId);
      if (!row || row.deletedAt) {
        // 404 (not 403) so we never leak that another workspace's fileId exists.
        await auditStorage(req, {
          action: "file_download_denied",
          fileId: req.params.fileId,
          reason: "not_found_or_cross_workspace",
        });
        res.status(404).json({ error: "File not found" });
        return;
      }

      const ref = parseStorageKey(row.storageKey);
      if (!ref) {
        await auditStorage(req, { action: "file_download_denied", fileId: row.id, reason: "malformed_key" });
        res.status(500).json({ error: "Stored object key is malformed" });
        return;
      }

      const url = await getStorageAdapter().getSignedDownloadUrl(ref, {
        expiresInSeconds: signedUrlTtlSeconds(),
      });
      await auditStorage(req, { action: "file_download_url_issued", fileId: row.id, bytes: row.byteSize });
      res.redirect(302, url);
    }),
  );

  // DELETE /api/files/:fileId — soft-delete the row + queue object removal.
  router.delete(
    "/:fileId",
    asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
      const workspaceId = req.workspaceId;
      const userId = req.auth?.sub;
      if (!workspaceId || !userId) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }

      const row = await fileObjectStore.getById({ workspaceId, userId }, req.params.fileId);
      if (!row || row.deletedAt) {
        await auditStorage(req, {
          action: "file_delete_denied",
          fileId: req.params.fileId,
          reason: "not_found_or_cross_workspace",
        });
        res.status(404).json({ error: "File not found" });
        return;
      }

      await fileObjectStore.softDelete({ workspaceId, userId }, row.id);
      await enqueueObjectDeletion({
        workspaceId,
        fileId: row.id,
        storageKey: row.storageKey,
        provider: row.provider,
        bucket: row.bucket,
      });

      await auditStorage(req, { action: "file_deleted", fileId: row.id, bytes: row.byteSize });
      res.status(204).end();
    }),
  );

  return router;
}
