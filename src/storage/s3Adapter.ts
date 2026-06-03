/**
 * AWS S3 StorageAdapter (HEL-352). Thin wrapper that builds an `S3Client` and
 * delegates all behavior to `S3CompatibleAdapter`. `endpoint` is optional and
 * only set for LocalStack / MinIO (which also need path-style addressing).
 */

import { S3Client } from "@aws-sdk/client-s3";
import { S3CompatibleAdapter } from "./s3CompatibleAdapter";

export interface S3AdapterConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Override the endpoint for LocalStack / MinIO; also enables path-style. */
  endpoint?: string;
  /** Inject a pre-built client (tests). When provided, the credential/region fields are ignored. */
  client?: S3Client;
}

export function createS3Adapter(config: S3AdapterConfig): S3CompatibleAdapter {
  const client =
    config.client ??
    new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.endpoint ? true : undefined,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  return new S3CompatibleAdapter({ client, bucket: config.bucket, provider: "s3" });
}
