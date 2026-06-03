/**
 * Canonical storage-key derivation + segment validation (HEL-352).
 *
 * The key layout is `workspaces/{workspaceId}/{collection}/{objectId}` where
 * `objectId` is `{ulid}-{sanitizedFilename}`. This module is the SINGLE place
 * that turns `(workspaceId, collection, objectId)` into a bucket key. Every
 * adapter composes keys through here, so the workspace prefix is mandatory and
 * a caller can never reach another tenant's objects with a crafted segment.
 */

import { ulid } from "ulid";
import type { StorageObjectRef } from "./storageAdapter";

/** Top-level prefix under which every workspace's objects live. */
export const WORKSPACE_PREFIX = "workspaces";

/** Cap on the sanitized filename component (keeps keys well under S3's 1024-byte cap). */
const MAX_FILENAME_LENGTH = 200;

// Mirrors the UUID shape used by the workspace resolver (src/middleware/workspaceResolver.ts:49).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Collections are short lowercase kebab tokens (run-input, export, artifact, …).
const COLLECTION_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageKeyError";
  }
}

export function isUuid(value: string): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Reject any key segment that could escape its slot: empty, containing a path
 * separator / NUL, or being a bare traversal token. Segments never contain
 * `/`, so an embedded `..` (e.g. a filename like `a..b`) is harmless and
 * allowed — only a segment that *is* `.` or `..` is rejected.
 */
export function assertSafeSegment(label: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new StorageKeyError(`${label} must be a non-empty string`);
  }
  if (/[/\\\0]/.test(value)) {
    throw new StorageKeyError(`${label} must not contain path separators or NUL`);
  }
  if (value === "." || value === "..") {
    throw new StorageKeyError(`${label} must not be a path-traversal segment`);
  }
}

export function assertValidCollection(collection: string): void {
  assertSafeSegment("collection", collection);
  if (!COLLECTION_RE.test(collection)) {
    throw new StorageKeyError("collection must be lowercase alphanumeric/hyphen, 1-64 chars");
  }
}

/**
 * Reduce an arbitrary client-supplied filename to a safe key component: keep
 * the basename, allow only `[A-Za-z0-9._-]`, collapse the rest to `_`, strip
 * leading dots, and cap the length. Never throws — always returns a usable
 * token (falls back to `"file"`).
 */
export function sanitizeFilename(filename: string): string {
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  let cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "");
  if (cleaned.length > MAX_FILENAME_LENGTH) {
    cleaned = cleaned.slice(-MAX_FILENAME_LENGTH);
  }
  return cleaned.length > 0 ? cleaned : "file";
}

/** Generate a new objectId: a time-sortable ULID prefix + the sanitized filename. */
export function generateObjectId(filename: string): string {
  return `${ulid()}-${sanitizeFilename(filename)}`;
}

/**
 * Compose the canonical bucket key for a stored object, validating every
 * segment. Throws {@link StorageKeyError} if any segment is unsafe or the
 * workspaceId is not a UUID.
 */
export function deriveStorageKey(ref: StorageObjectRef): string {
  if (!isUuid(ref.workspaceId)) {
    throw new StorageKeyError("workspaceId must be a UUID");
  }
  assertValidCollection(ref.collection);
  assertSafeSegment("objectId", ref.objectId);
  return `${WORKSPACE_PREFIX}/${ref.workspaceId}/${ref.collection}/${ref.objectId}`;
}

/** Prefix for listing a workspace (optionally narrowed to one collection). */
export function deriveListPrefix(workspaceId: string, collection?: string): string {
  if (!isUuid(workspaceId)) {
    throw new StorageKeyError("workspaceId must be a UUID");
  }
  if (collection === undefined) {
    return `${WORKSPACE_PREFIX}/${workspaceId}/`;
  }
  assertValidCollection(collection);
  return `${WORKSPACE_PREFIX}/${workspaceId}/${collection}/`;
}

/**
 * Inverse of {@link deriveStorageKey} for list results: parse a full bucket
 * key back into a ref. Returns null for keys that don't match the canonical
 * workspace layout.
 */
export function parseStorageKey(storageKey: string): StorageObjectRef | null {
  const parts = storageKey.split("/");
  if (parts.length !== 4) return null;
  const [prefix, workspaceId, collection, objectId] = parts;
  if (prefix !== WORKSPACE_PREFIX || !isUuid(workspaceId) || !collection || !objectId) {
    return null;
  }
  return { workspaceId, collection, objectId };
}
