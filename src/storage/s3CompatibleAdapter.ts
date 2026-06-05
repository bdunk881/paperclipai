/**
 * Shared StorageAdapter implementation for any S3-API-compatible backend
 * (AWS S3, Cloudflare R2, LocalStack, MinIO). R2 and S3 differ ONLY in how the
 * `S3Client` is constructed (endpoint / region / path-style) — see
 * `./r2Adapter.ts` and `./s3Adapter.ts`. This class owns all behavior.
 *
 * The client is injected, so unit tests pass a real `S3Client` with its
 * `send` spied (presigning is pure/offline and needs a real client) — no
 * network, no `aws-sdk-client-mock` dependency. See `./adapterContract.test.ts`.
 */

import type { Readable } from "stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule as S3LifecycleRule,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  type StorageAdapter,
  type StorageProvider,
  type StorageBody,
  type StorageObjectRef,
  type StorageObjectSummary,
  type PutObjectInput,
  type PutObjectResult,
  type GetObjectResult,
  type SignedUrlOptions,
  type SignedUploadInput,
  type SignedUploadResult,
  type ListObjectsInput,
  type ListObjectsResult,
  type LifecycleCapableAdapter,
  type LifecycleConfiguration,
  type LifecycleRule,
} from "./storageAdapter";
import {
  deriveStorageKey,
  deriveListPrefix,
  generateObjectId,
  parseStorageKey,
  RETENTION_CLASSES,
  DEFAULT_RETENTION_CLASS,
} from "./storageKey";

export interface S3CompatibleAdapterParams {
  client: S3Client;
  bucket: string;
  provider: StorageProvider;
}

export class S3CompatibleAdapter implements StorageAdapter, LifecycleCapableAdapter {
  readonly provider: StorageProvider;
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(params: S3CompatibleAdapterParams) {
    this.client = params.client;
    this.bucket = params.bucket;
    this.provider = params.provider;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const ref: StorageObjectRef = {
      workspaceId: input.workspaceId,
      collection: input.collection,
      objectId: generateObjectId(input.filename),
      retentionClass: input.retentionClass ?? DEFAULT_RETENTION_CLASS,
    };
    const storageKey = deriveStorageKey(ref);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
    );
    return {
      ref,
      storageKey,
      provider: this.provider,
      bucket: this.bucket,
      size: byteLength(input.body, input.contentLength),
    };
  }

  async getObject(ref: StorageObjectRef): Promise<GetObjectResult> {
    const storageKey = deriveStorageKey(ref);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    return {
      body: out.Body as unknown as Readable,
      contentType: out.ContentType,
      size: out.ContentLength,
    };
  }

  async getSignedDownloadUrl(ref: StorageObjectRef, options?: SignedUrlOptions): Promise<string> {
    const storageKey = deriveStorageKey(ref);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }), {
      expiresIn: options?.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS,
    });
  }

  async getSignedUploadUrl(input: SignedUploadInput, options?: SignedUrlOptions): Promise<SignedUploadResult> {
    const ref: StorageObjectRef = {
      workspaceId: input.workspaceId,
      collection: input.collection,
      objectId: generateObjectId(input.filename),
      retentionClass: input.retentionClass ?? DEFAULT_RETENTION_CLASS,
    };
    const storageKey = deriveStorageKey(ref);
    const expiresIn = options?.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS;
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, ContentType: input.contentType }),
      { expiresIn },
    );
    const headers: Record<string, string> = {};
    if (input.contentType) headers["Content-Type"] = input.contentType;
    return {
      ref,
      storageKey,
      url,
      method: "PUT",
      headers,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async deleteObject(ref: StorageObjectRef): Promise<void> {
    const storageKey = deriveStorageKey(ref);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }

  async listObjects(input: ListObjectsInput): Promise<ListObjectsResult> {
    // Retention is the top-level prefix, so list each requested class and merge.
    const classes = input.retentionClass ? [input.retentionClass] : [...RETENTION_CLASSES];
    const objects: StorageObjectSummary[] = [];
    let nextCursor: string | undefined;
    for (const rc of classes) {
      const prefix = deriveListPrefix(rc, input.workspaceId, input.collection);
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: input.limit,
          // Cursor pagination only applies when scoped to a single class.
          ContinuationToken: classes.length === 1 ? input.cursor : undefined,
        }),
      );
      for (const o of out.Contents ?? []) {
        const ref = o.Key ? parseStorageKey(o.Key) : null;
        if (!ref || !o.Key) continue;
        objects.push({
          ref,
          storageKey: o.Key,
          size: o.Size ?? 0,
          lastModified: (o.LastModified ?? new Date(0)).toISOString(),
        });
      }
      if (out.IsTruncated && classes.length === 1) {
        nextCursor = out.NextContinuationToken;
      }
    }
    return { objects, nextCursor };
  }

  // ----- LifecycleCapableAdapter (HEL-358) -----

  async getBucketLifecycle(): Promise<LifecycleConfiguration | null> {
    try {
      const out = await this.client.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucket }),
      );
      return { rules: (out.Rules ?? []).map(fromS3LifecycleRule) };
    } catch (err) {
      // S3 + R2 return NoSuchLifecycleConfiguration when no config is set.
      if ((err as { name?: string }).name === "NoSuchLifecycleConfiguration") {
        return null;
      }
      throw err;
    }
  }

  async putBucketLifecycle(config: LifecycleConfiguration): Promise<void> {
    await this.client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: this.bucket,
        LifecycleConfiguration: { Rules: config.rules.map(toS3LifecycleRule) },
      }),
    );
  }
}

/** Best-effort byte length for the result `size`; undefined for un-measured streams. */
function byteLength(body: StorageBody, hint?: number): number | undefined {
  if (typeof hint === "number") return hint;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.byteLength;
  return undefined;
}

// ----- Lifecycle rule <-> S3 API conversion (HEL-358) -----

function toS3LifecycleRule(rule: LifecycleRule): S3LifecycleRule {
  const s3: S3LifecycleRule = {
    ID: rule.id,
    Status: rule.status,
    // A Filter is required by the modern API; an empty Prefix means bucket-wide.
    Filter: { Prefix: rule.prefix ?? "" },
  };
  if (typeof rule.expirationDays === "number") {
    s3.Expiration = { Days: rule.expirationDays };
  }
  if (typeof rule.abortIncompleteMultipartUploadDays === "number") {
    s3.AbortIncompleteMultipartUpload = {
      DaysAfterInitiation: rule.abortIncompleteMultipartUploadDays,
    };
  }
  return s3;
}

function fromS3LifecycleRule(r: S3LifecycleRule): LifecycleRule {
  const filterPrefix = (r.Filter as { Prefix?: string } | undefined)?.Prefix;
  const prefix = filterPrefix ?? r.Prefix;
  return {
    id: String(r.ID ?? ""),
    status: r.Status === "Enabled" ? "Enabled" : "Disabled",
    prefix: prefix && prefix.length > 0 ? prefix : undefined,
    expirationDays: typeof r.Expiration?.Days === "number" ? r.Expiration.Days : undefined,
    abortIncompleteMultipartUploadDays:
      typeof r.AbortIncompleteMultipartUpload?.DaysAfterInitiation === "number"
        ? r.AbortIncompleteMultipartUpload.DaysAfterInitiation
        : undefined,
  };
}
