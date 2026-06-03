/**
 * Cloudflare R2 StorageAdapter (HEL-352). R2 is S3-API-compatible, so this is
 * an `S3Client` with the R2 endpoint + `region: "auto"` + path-style, delegating
 * all behavior to `S3CompatibleAdapter`. Uses `STORAGE_R2_*` env (kept distinct
 * from the public `CLOUDFLARE_R2_*` CDN-bucket creds — see
 * infra/runbooks/brand-assets-cdn-operations.md).
 */

import { S3Client } from "@aws-sdk/client-s3";
import { S3CompatibleAdapter } from "./s3CompatibleAdapter";

export interface R2AdapterConfig {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Override the derived endpoint (default `https://{accountId}.r2.cloudflarestorage.com`). */
  endpoint?: string;
  /** Inject a pre-built client (tests). */
  client?: S3Client;
}

export function r2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function createR2Adapter(config: R2AdapterConfig): S3CompatibleAdapter {
  const client =
    config.client ??
    new S3Client({
      region: "auto",
      endpoint: config.endpoint ?? r2Endpoint(config.accountId),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  return new S3CompatibleAdapter({ client, bucket: config.bucket, provider: "r2" });
}
