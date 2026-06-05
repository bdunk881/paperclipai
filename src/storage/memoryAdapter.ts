/**
 * In-memory StorageAdapter for tests + `dev:no-secrets` (HEL-352).
 *
 * Selected by the factory ONLY under the repo's double-locked fallback
 * (`inMemoryAllowed()` — NODE_ENV in {development,test} AND
 * AUTOFLOW_ALLOW_INMEMORY=true). Never used in production.
 *
 * Signed URLs are non-network `memory://…` sentinels — enough for downstream
 * route tests (HEL-354) to assert a URL was issued without standing up S3.
 */

import { Readable } from "stream";
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  type StorageAdapter,
  type StorageProvider,
  type StorageBody,
  type StorageObjectRef,
  type PutObjectInput,
  type PutObjectResult,
  type GetObjectResult,
  type SignedUrlOptions,
  type SignedUploadInput,
  type SignedUploadResult,
  type ListObjectsInput,
  type ListObjectsResult,
  type StorageObjectSummary,
} from "./storageAdapter";
import {
  deriveStorageKey,
  deriveListPrefix,
  generateObjectId,
  parseStorageKey,
  RETENTION_CLASSES,
  DEFAULT_RETENTION_CLASS,
} from "./storageKey";

interface MemoryObject {
  body: Buffer;
  contentType?: string;
  lastModified: Date;
}

export class NoSuchKeyError extends Error {
  constructor(storageKey: string) {
    super(`NoSuchKey: ${storageKey}`);
    this.name = "NoSuchKeyError";
  }
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly provider: StorageProvider = "memory";
  readonly bucket: string;
  private readonly store = new Map<string, MemoryObject>();

  constructor(bucket = "memory") {
    this.bucket = bucket;
  }

  /** Test helper: number of stored objects. */
  get count(): number {
    return this.store.size;
  }

  /** Test helper: wipe all objects. */
  clear(): void {
    this.store.clear();
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const ref: StorageObjectRef = {
      workspaceId: input.workspaceId,
      collection: input.collection,
      objectId: generateObjectId(input.filename),
      retentionClass: input.retentionClass ?? DEFAULT_RETENTION_CLASS,
    };
    const storageKey = deriveStorageKey(ref);
    const body = await toBuffer(input.body);
    this.store.set(storageKey, { body, contentType: input.contentType, lastModified: new Date() });
    return { ref, storageKey, provider: this.provider, bucket: this.bucket, size: body.byteLength };
  }

  async getObject(ref: StorageObjectRef): Promise<GetObjectResult> {
    const storageKey = deriveStorageKey(ref);
    const obj = this.store.get(storageKey);
    if (!obj) throw new NoSuchKeyError(storageKey);
    return { body: Readable.from(obj.body), contentType: obj.contentType, size: obj.body.byteLength };
  }

  async getSignedDownloadUrl(ref: StorageObjectRef, options?: SignedUrlOptions): Promise<string> {
    const storageKey = deriveStorageKey(ref);
    const ttl = options?.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS;
    return `memory://${this.bucket}/${storageKey}?op=get&ttl=${ttl}`;
  }

  async getSignedUploadUrl(input: SignedUploadInput, options?: SignedUrlOptions): Promise<SignedUploadResult> {
    const ref: StorageObjectRef = {
      workspaceId: input.workspaceId,
      collection: input.collection,
      objectId: generateObjectId(input.filename),
      retentionClass: input.retentionClass ?? DEFAULT_RETENTION_CLASS,
    };
    const storageKey = deriveStorageKey(ref);
    const ttl = options?.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS;
    const headers: Record<string, string> = {};
    if (input.contentType) headers["Content-Type"] = input.contentType;
    return {
      ref,
      storageKey,
      url: `memory://${this.bucket}/${storageKey}?op=put&ttl=${ttl}`,
      method: "PUT",
      headers,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async deleteObject(ref: StorageObjectRef): Promise<void> {
    this.store.delete(deriveStorageKey(ref));
  }

  async listObjects(input: ListObjectsInput): Promise<ListObjectsResult> {
    // Retention is the top-level prefix; list each requested class and merge.
    const classes = input.retentionClass ? [input.retentionClass] : [...RETENTION_CLASSES];
    const prefixes = classes.map((rc) => deriveListPrefix(rc, input.workspaceId, input.collection));
    const objects: StorageObjectSummary[] = [...this.store.entries()]
      .filter(([key]) => prefixes.some((p) => key.startsWith(p)))
      .map(([key, obj]) => {
        const ref = parseStorageKey(key);
        return ref
          ? {
              ref,
              storageKey: key,
              size: obj.body.byteLength,
              lastModified: obj.lastModified.toISOString(),
            }
          : null;
      })
      .filter((x): x is StorageObjectSummary => x !== null)
      .sort((a, b) => a.storageKey.localeCompare(b.storageKey));
    const limit = input.limit ?? objects.length;
    return { objects: objects.slice(0, limit) };
  }
}

async function toBuffer(body: StorageBody): Promise<Buffer> {
  if (typeof body === "string") return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}
