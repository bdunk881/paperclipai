/**
 * Storage adapter contract (HEL-352, Storage foundation Tier A).
 *
 * One interface, two production implementations (R2 + S3, both on the S3 API)
 * plus an in-memory adapter for tests / `dev:no-secrets`. Selected per
 * environment by the factory in `./index.ts`.
 *
 * TENANT-ISOLATION INVARIANT (the security core of this module):
 * callers NEVER pass raw bucket keys. They pass `{ workspaceId, collection,
 * objectId }` and the adapter is the *sole owner* of key derivation, always
 * composing `workspaces/{workspaceId}/{collection}/{objectId}` via
 * `deriveStorageKey()`. The route layer (HEL-354) re-derives `workspaceId`
 * from `req.workspaceId`, so a crafted `objectId` can never escape the
 * workspace prefix. See `./storageKey.ts`.
 */

import type { Readable } from "stream";

export type StorageProvider = "r2" | "s3" | "memory";

/**
 * Retention classes for stored objects. Defined here so the interface is
 * stable across the whole storage-foundation project; the lifecycle-rule
 * mapping + enforcement lands in HEL-358 and the `retention_class` column on
 * `file_objects` lands in HEL-353. Not consumed by the adapter itself yet.
 */
export type RetentionClass = "short" | "standard" | "legal_hold";

/** Default signed-URL TTL: 5 minutes. */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

/**
 * Server-side identity of a stored object. The `objectId` is the generated
 * `{ulid}-{sanitizedFilename}` key segment returned by `putObject` /
 * `getSignedUploadUrl`; persisted on `file_objects` in HEL-353.
 */
export interface StorageObjectRef {
  workspaceId: string;
  collection: string;
  objectId: string;
  /**
   * Retention class — the TOP-LEVEL key prefix (HEL-358) so bucket lifecycle
   * rules (prefix-based; R2 has no tag filters) can target a class across ALL
   * workspaces with a bounded set of rules. Optional; `deriveStorageKey()`
   * defaults it to `"standard"`. On a ref parsed from a stored key it reflects
   * that key's actual prefix.
   */
  retentionClass?: RetentionClass;
}

export type StorageBody = Buffer | Uint8Array | Readable | string;

export interface PutObjectInput {
  workspaceId: string;
  collection: string;
  /** Original filename; sanitized into the generated objectId. */
  filename: string;
  body: StorageBody;
  contentType?: string;
  /** Byte length hint; required by some S3-compatible stores for streaming bodies. */
  contentLength?: number;
  /** Retention class → key prefix + lifecycle (HEL-358). Defaults to "standard". */
  retentionClass?: RetentionClass;
}

export interface PutObjectResult {
  ref: StorageObjectRef;
  /** Full canonical key: `workspaces/{workspaceId}/{collection}/{ulid}-{filename}`. */
  storageKey: string;
  provider: StorageProvider;
  bucket: string;
  size?: number;
}

export interface GetObjectResult {
  body: Readable;
  contentType?: string;
  size?: number;
}

export interface SignedUrlOptions {
  /** TTL in seconds. Defaults to {@link DEFAULT_SIGNED_URL_TTL_SECONDS}. */
  expiresInSeconds?: number;
}

export interface SignedUploadInput {
  workspaceId: string;
  collection: string;
  filename: string;
  contentType?: string;
  /** Retention class → key prefix + lifecycle (HEL-358). Defaults to "standard". */
  retentionClass?: RetentionClass;
}

export interface SignedUploadResult {
  ref: StorageObjectRef;
  storageKey: string;
  url: string;
  method: "PUT";
  /** Headers the client MUST echo on the PUT for the signature to validate. */
  headers: Record<string, string>;
  /** ISO timestamp at which the signed URL expires. */
  expiresAt: string;
}

export interface ListObjectsInput {
  workspaceId: string;
  /** Restrict to a single collection; omit to list the whole workspace. */
  collection?: string;
  /**
   * Restrict to a single retention class. Omit to list across all classes
   * (the adapter fans out over each retention prefix). HEL-358.
   */
  retentionClass?: RetentionClass;
  limit?: number;
  cursor?: string;
}

export interface StorageObjectSummary {
  ref: StorageObjectRef;
  storageKey: string;
  size: number;
  /** ISO timestamp. */
  lastModified: string;
}

export interface ListObjectsResult {
  objects: StorageObjectSummary[];
  nextCursor?: string;
}

/**
 * The storage contract every adapter implements. Keep this provider-agnostic:
 * R2/S3 differ only in client construction, never in this surface.
 */
export interface StorageAdapter {
  readonly provider: StorageProvider;
  readonly bucket: string;

  /** Upload bytes server-side; generates and returns the objectId. */
  putObject(input: PutObjectInput): Promise<PutObjectResult>;

  /** Fetch bytes server-side (e.g. fileParser in HEL-355). */
  getObject(ref: StorageObjectRef): Promise<GetObjectResult>;

  /** Time-limited GET URL handed to clients (default 5-min TTL). */
  getSignedDownloadUrl(ref: StorageObjectRef, options?: SignedUrlOptions): Promise<string>;

  /** Time-limited PUT URL; generates and returns the objectId clients will write to. */
  getSignedUploadUrl(input: SignedUploadInput, options?: SignedUrlOptions): Promise<SignedUploadResult>;

  deleteObject(ref: StorageObjectRef): Promise<void>;

  /** List objects under `{retention}/workspaces/{workspaceId}/[{collection}/]`. */
  listObjects(input: ListObjectsInput): Promise<ListObjectsResult>;
}

// ---------------------------------------------------------------------------
// Lifecycle capability (HEL-358).
//
// Only the S3-API adapters (S3/R2) implement this — bucket lifecycle is a
// server-side bucket config, meaningless for the in-memory adapter. Kept OFF
// the base `StorageAdapter` so MemoryAdapter needn't implement it; callers
// feature-detect with `isLifecycleCapable()`.
//
// Provider-agnostic shapes (an S3-API subset) so `retentionPolicy.ts` stays
// SDK-free; the adapter converts to/from `@aws-sdk/client-s3` commands.
// ---------------------------------------------------------------------------
export interface LifecycleRule {
  id: string;
  status: "Enabled" | "Disabled";
  /** Key prefix this rule applies to; omit for a bucket-wide rule. */
  prefix?: string;
  /** Delete objects this many days after creation. */
  expirationDays?: number;
  /** Abort incomplete multipart uploads this many days after initiation. */
  abortIncompleteMultipartUploadDays?: number;
}

export interface LifecycleConfiguration {
  rules: LifecycleRule[];
}

export interface LifecycleCapableAdapter {
  /** Read the bucket's current lifecycle configuration (null if none set). */
  getBucketLifecycle(): Promise<LifecycleConfiguration | null>;
  /** Replace the bucket's lifecycle configuration. */
  putBucketLifecycle(config: LifecycleConfiguration): Promise<void>;
}

/** True when the adapter supports bucket-lifecycle operations (S3/R2, not memory). */
export function isLifecycleCapable(
  adapter: StorageAdapter,
): adapter is StorageAdapter & LifecycleCapableAdapter {
  const a = adapter as Partial<LifecycleCapableAdapter>;
  return typeof a.getBucketLifecycle === "function" && typeof a.putBucketLifecycle === "function";
}
