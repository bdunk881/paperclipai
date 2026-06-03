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
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
} from "./storageAdapter";
import { deriveStorageKey, deriveListPrefix, generateObjectId, parseStorageKey } from "./storageKey";

export interface S3CompatibleAdapterParams {
  client: S3Client;
  bucket: string;
  provider: StorageProvider;
}

export class S3CompatibleAdapter implements StorageAdapter {
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
    const prefix = deriveListPrefix(input.workspaceId, input.collection);
    const out = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: input.limit,
        ContinuationToken: input.cursor,
      }),
    );
    const objects = (out.Contents ?? [])
      .map((o) => {
        const ref = o.Key ? parseStorageKey(o.Key) : null;
        if (!ref || !o.Key) return null;
        return {
          ref,
          storageKey: o.Key,
          size: o.Size ?? 0,
          lastModified: (o.LastModified ?? new Date(0)).toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return {
      objects,
      nextCursor: out.IsTruncated ? out.NextContinuationToken : undefined,
    };
  }
}

/** Best-effort byte length for the result `size`; undefined for un-measured streams. */
function byteLength(body: StorageBody, hint?: number): number | undefined {
  if (typeof hint === "number") return hint;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.byteLength;
  return undefined;
}
