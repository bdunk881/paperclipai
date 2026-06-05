/**
 * Apply the canonical retention lifecycle to the configured storage bucket
 * (HEL-358). Run MANUALLY once provider creds exist (it is NOT invoked by the
 * app at runtime):
 *
 *   infisical run --env=dev -- npm run storage:apply-lifecycle
 *   # or, with STORAGE_* already in the environment:
 *   npm run storage:apply-lifecycle
 *
 * Reads `STORAGE_*` via `getStorageAdapter()`, feature-detects lifecycle support
 * (S3/R2 only — never the in-memory adapter), and PUTs the config from
 * `buildLifecycleConfiguration()`. Idempotent: PutBucketLifecycleConfiguration
 * replaces the whole configuration each run. See
 * `infra/runbooks/storage-lifecycle.md`.
 */

import { getStorageAdapter, isLifecycleCapable } from "./index";
import type { LifecycleCapableAdapter, StorageAdapter } from "./storageAdapter";
import { buildLifecycleConfiguration } from "./retentionPolicy";

/** Resolve the configured adapter, asserting it supports lifecycle ops. */
export function requireLifecycleAdapter(): StorageAdapter & LifecycleCapableAdapter {
  const adapter = getStorageAdapter();
  if (!isLifecycleCapable(adapter)) {
    throw new Error(
      `Storage adapter (provider=${adapter.provider}) does not support lifecycle configuration. ` +
        "Set STORAGE_PROVIDER=r2 or s3 with credentials before applying lifecycle rules.",
    );
  }
  return adapter;
}

/** PUT the canonical lifecycle configuration onto the bucket. */
export async function applyLifecycleToBucket(
  adapter: StorageAdapter & LifecycleCapableAdapter = requireLifecycleAdapter(),
): Promise<void> {
  const config = buildLifecycleConfiguration();
  await adapter.putBucketLifecycle(config);
  console.log(
    `[storage:apply-lifecycle] applied ${config.rules.length} rule(s) to ${adapter.provider} bucket "${adapter.bucket}":`,
  );
  for (const rule of config.rules) {
    const parts = [
      rule.prefix ? `prefix=${rule.prefix}` : "bucket-wide",
      rule.expirationDays != null ? `expire=${rule.expirationDays}d` : null,
      rule.abortIncompleteMultipartUploadDays != null
        ? `abortMPU=${rule.abortIncompleteMultipartUploadDays}d`
        : null,
    ].filter(Boolean);
    console.log(`  - ${rule.id}: ${parts.join(" ")}`);
  }
}

// Manual entrypoint (CommonJS): `ts-node src/storage/applyBucketLifecycle.ts`.
if (require.main === module) {
  applyLifecycleToBucket()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(
        "[storage:apply-lifecycle] failed:",
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    });
}
