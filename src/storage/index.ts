/**
 * Storage module entrypoint + adapter factory (HEL-352).
 *
 * `getStorageAdapter()` is a lazy memoized singleton mirroring `getStripe()`
 * (src/billing/stripeClient.ts): it reads `STORAGE_PROVIDER` + the matching
 * `STORAGE_R2_*` / `STORAGE_S3_*` env on first use and throws a clean error if
 * misconfigured. With no provider set it falls back to the in-memory adapter
 * only under the double-locked `inMemoryAllowed()` gate; otherwise it throws.
 */

import { inMemoryAllowed } from "../db/postgres";
import type { StorageAdapter } from "./storageAdapter";
import { createR2Adapter } from "./r2Adapter";
import { createS3Adapter } from "./s3Adapter";
import { MemoryStorageAdapter } from "./memoryAdapter";

export * from "./storageAdapter";
export { S3CompatibleAdapter } from "./s3CompatibleAdapter";
export { createR2Adapter, r2Endpoint, type R2AdapterConfig } from "./r2Adapter";
export { createS3Adapter, type S3AdapterConfig } from "./s3Adapter";
export { MemoryStorageAdapter, NoSuchKeyError } from "./memoryAdapter";
export {
  deriveStorageKey,
  deriveListPrefix,
  parseStorageKey,
  generateObjectId,
  sanitizeFilename,
  isUuid,
  StorageKeyError,
  WORKSPACE_PREFIX,
  RETENTION_CLASSES,
  DEFAULT_RETENTION_CLASS,
  isRetentionClass,
  assertValidRetention,
} from "./storageKey";

let cachedAdapter: StorageAdapter | undefined;

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

/**
 * Build a fresh adapter from an env snapshot. Pure (no caching) — used directly
 * by tests; `getStorageAdapter()` wraps it with memoization.
 */
export function buildStorageAdapter(env: NodeJS.ProcessEnv = process.env): StorageAdapter {
  const provider = firstNonEmpty(env.STORAGE_PROVIDER).toLowerCase();

  const required = (name: string): string => {
    const value = firstNonEmpty(env[name]);
    if (!value) {
      throw new Error(`Storage misconfigured: ${name} is required when STORAGE_PROVIDER=${provider}`);
    }
    return value;
  };

  if (provider === "r2") {
    return createR2Adapter({
      accountId: required("STORAGE_R2_ACCOUNT_ID"),
      bucket: required("STORAGE_R2_BUCKET"),
      accessKeyId: required("STORAGE_R2_ACCESS_KEY_ID"),
      secretAccessKey: required("STORAGE_R2_SECRET_ACCESS_KEY"),
      endpoint: firstNonEmpty(env.STORAGE_R2_ENDPOINT) || undefined,
    });
  }

  if (provider === "s3") {
    return createS3Adapter({
      region: required("STORAGE_S3_REGION"),
      bucket: required("STORAGE_S3_BUCKET"),
      accessKeyId: required("STORAGE_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("STORAGE_S3_SECRET_ACCESS_KEY"),
      endpoint: firstNonEmpty(env.STORAGE_S3_ENDPOINT) || undefined,
    });
  }

  if (provider === "") {
    if (inMemoryAllowed(env)) {
      return new MemoryStorageAdapter();
    }
    throw new Error(
      "STORAGE_PROVIDER is not set. Set STORAGE_PROVIDER=r2 or s3 (the in-memory fallback is only available in development/test with AUTOFLOW_ALLOW_INMEMORY=true).",
    );
  }

  throw new Error(`STORAGE_PROVIDER must be 'r2' or 's3' (got '${provider}').`);
}

/** Lazy memoized singleton storage adapter. */
export function getStorageAdapter(): StorageAdapter {
  if (!cachedAdapter) {
    cachedAdapter = buildStorageAdapter();
  }
  return cachedAdapter;
}

/** Test-only: drop the memoized adapter so the next call rebuilds from env. */
export function __resetStorageAdapterForTests(): void {
  cachedAdapter = undefined;
}
