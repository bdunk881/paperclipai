/**
 * Unit-test PARITY between the R2 and S3 adapters (HEL-352 acceptance).
 *
 * The same contract runs against both providers using a real `S3Client` with
 * `send` spied: `getSignedUrl` presigning is pure/offline (needs a real
 * client), while put/get/delete/list go through the spy. No network, no
 * `aws-sdk-client-mock` dependency.
 */

import { Readable } from "stream";
import { S3Client } from "@aws-sdk/client-s3";
import { createR2Adapter } from "./r2Adapter";
import { createS3Adapter } from "./s3Adapter";
import { isLifecycleCapable, type StorageAdapter } from "./storageAdapter";

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ULID_RE = "[0-9A-HJKMNP-TV-Z]{26}";
const SAMPLE_OBJECT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV-a.pdf";

interface Harness {
  adapter: StorageAdapter;
  bucket: string;
  sent: () => Array<{ constructor: { name: string }; input: Record<string, unknown> }>;
  hostPattern: RegExp;
}

function keyPattern(wid: string, collection: string, filename: string): RegExp {
  // Default retention is "standard", so the key is prefixed with `standard/` (HEL-358).
  return new RegExp(`^standard/workspaces/${wid}/${collection}/${ULID_RE}-${filename.replace(/\./g, "\\.")}$`);
}

function spyOnSend(client: S3Client): () => Array<{ constructor: { name: string }; input: Record<string, unknown> }> {
  const sent: Array<{ constructor: { name: string }; input: Record<string, unknown> }> = [];
  jest.spyOn(client as unknown as { send: (c: unknown) => Promise<unknown> }, "send").mockImplementation(
    async (command: unknown) => {
      const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
      sent.push(cmd);
      const name = cmd.constructor.name;
      if (name === "GetObjectCommand") {
        return { Body: Readable.from(Buffer.from("contents")), ContentType: "application/pdf", ContentLength: 8 };
      }
      if (name === "ListObjectsV2Command") {
        const prefix = cmd.input.Prefix as string;
        return {
          Contents: [{ Key: `${prefix}01ARZ3NDEKTSV4RRFFQ69G5FAV-a.pdf`, Size: 3, LastModified: new Date("2024-01-01T00:00:00Z") }],
          IsTruncated: false,
        };
      }
      if (name === "GetBucketLifecycleConfigurationCommand") {
        return {
          Rules: [
            { ID: "retention-short", Status: "Enabled", Filter: { Prefix: "short/" }, Expiration: { Days: 30 } },
          ],
        };
      }
      return {};
    },
  );
  return () => sent;
}

function makeS3Harness(): Harness {
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  });
  const sent = spyOnSend(client);
  const adapter = createS3Adapter({ region: "us-east-1", bucket: "autoflow-s3", accessKeyId: "x", secretAccessKey: "y", client });
  return { adapter, bucket: "autoflow-s3", sent, hostPattern: /amazonaws\.com/ };
}

function makeR2Harness(): Harness {
  const client = new S3Client({
    region: "auto",
    endpoint: "https://acct123.r2.cloudflarestorage.com",
    forcePathStyle: true,
    credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  });
  const sent = spyOnSend(client);
  const adapter = createR2Adapter({ accountId: "acct123", bucket: "autoflow-r2", accessKeyId: "x", secretAccessKey: "y", client });
  return { adapter, bucket: "autoflow-r2", sent, hostPattern: /r2\.cloudflarestorage\.com/ };
}

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

afterEach(() => jest.restoreAllMocks());

describe.each<[string, () => Harness]>([
  ["s3", makeS3Harness],
  ["r2", makeR2Harness],
])("StorageAdapter contract: %s", (_label, makeHarness) => {
  it("putObject derives the canonical key and PUTs to the configured bucket", async () => {
    const { adapter, bucket, sent } = makeHarness();
    const res = await adapter.putObject({
      workspaceId: WORKSPACE_A,
      collection: "run-input",
      filename: "Report 2024.pdf",
      body: Buffer.from("hi"),
      contentType: "application/pdf",
    });
    expect(res.bucket).toBe(bucket);
    expect(res.storageKey).toMatch(keyPattern(WORKSPACE_A, "run-input", "Report_2024.pdf"));
    const put = sent().find((c) => c.constructor.name === "PutObjectCommand");
    expect(put?.input.Bucket).toBe(bucket);
    expect(put?.input.Key).toBe(res.storageKey);
    expect(put?.input.ContentType).toBe("application/pdf");
  });

  it("getObject GETs the derived key and streams bytes", async () => {
    const { adapter, bucket, sent } = makeHarness();
    const out = await adapter.getObject({ workspaceId: WORKSPACE_A, collection: "run-input", objectId: SAMPLE_OBJECT_ID });
    expect(out.contentType).toBe("application/pdf");
    expect(await streamToString(out.body)).toBe("contents");
    const get = sent().find((c) => c.constructor.name === "GetObjectCommand");
    expect(get?.input.Bucket).toBe(bucket);
    expect(get?.input.Key).toBe(`standard/workspaces/${WORKSPACE_A}/run-input/${SAMPLE_OBJECT_ID}`);
  });

  it("deleteObject DELETEs the derived key", async () => {
    const { adapter, bucket, sent } = makeHarness();
    await adapter.deleteObject({ workspaceId: WORKSPACE_A, collection: "export", objectId: SAMPLE_OBJECT_ID });
    const del = sent().find((c) => c.constructor.name === "DeleteObjectCommand");
    expect(del?.input.Bucket).toBe(bucket);
    expect(del?.input.Key).toBe(`standard/workspaces/${WORKSPACE_A}/export/${SAMPLE_OBJECT_ID}`);
  });

  it("listObjects lists under the {retention}/workspace/collection prefix and parses refs", async () => {
    const { adapter, sent } = makeHarness();
    const res = await adapter.listObjects({ workspaceId: WORKSPACE_A, collection: "run-input", retentionClass: "standard" });
    const list = sent().find((c) => c.constructor.name === "ListObjectsV2Command");
    expect(list?.input.Prefix).toBe(`standard/workspaces/${WORKSPACE_A}/run-input/`);
    expect(res.objects).toHaveLength(1);
    expect(res.objects[0].ref.workspaceId).toBe(WORKSPACE_A);
    expect(res.objects[0].ref.collection).toBe("run-input");
    expect(res.objects[0].ref.retentionClass).toBe("standard");
  });

  it("getSignedDownloadUrl returns a presigned GET URL for the derived key", async () => {
    const { adapter } = makeHarness();
    const url = await adapter.getSignedDownloadUrl(
      { workspaceId: WORKSPACE_A, collection: "run-input", objectId: SAMPLE_OBJECT_ID },
      { expiresInSeconds: 300 },
    );
    expect(url).toContain(`workspaces/${WORKSPACE_A}/run-input/${SAMPLE_OBJECT_ID}`);
    expect(url).toContain("X-Amz-Expires=300");
    expect(url).toContain("X-Amz-Signature=");
  });

  it("getSignedUploadUrl returns a presigned PUT URL with a generated objectId", async () => {
    const { adapter } = makeHarness();
    const result = await adapter.getSignedUploadUrl({
      workspaceId: WORKSPACE_A,
      collection: "run-input",
      filename: "a b.png",
      contentType: "image/png",
    });
    expect(result.method).toBe("PUT");
    expect(result.storageKey).toMatch(keyPattern(WORKSPACE_A, "run-input", "a_b.png"));
    expect(result.url).toContain("X-Amz-Expires=300");
    expect(result.headers["Content-Type"]).toBe("image/png");
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("refuses a crafted objectId/collection that would escape the workspace prefix", async () => {
    const { adapter } = makeHarness();
    await expect(
      adapter.getObject({ workspaceId: WORKSPACE_A, collection: "run-input", objectId: "../../other/secret" }),
    ).rejects.toThrow(/path separators/);
    await expect(
      adapter.deleteObject({ workspaceId: WORKSPACE_A, collection: "../escape", objectId: "x" }),
    ).rejects.toThrow();
  });

  it("isolates workspaces by prefix (A's key never lands under B)", async () => {
    const { adapter } = makeHarness();
    const a = await adapter.putObject({ workspaceId: WORKSPACE_A, collection: "run-input", filename: "f.txt", body: "a" });
    const b = await adapter.putObject({ workspaceId: WORKSPACE_B, collection: "run-input", filename: "f.txt", body: "b" });
    expect(a.storageKey.startsWith(`standard/workspaces/${WORKSPACE_A}/`)).toBe(true);
    expect(b.storageKey.startsWith(`standard/workspaces/${WORKSPACE_B}/`)).toBe(true);
    expect(a.storageKey).not.toContain(WORKSPACE_B);
  });

  it("putBucketLifecycle sends a PutBucketLifecycleConfiguration with mapped rules (HEL-358)", async () => {
    const { adapter, bucket, sent } = makeHarness();
    if (!isLifecycleCapable(adapter)) throw new Error("adapter should be lifecycle-capable");
    await adapter.putBucketLifecycle({
      rules: [
        { id: "retention-short", status: "Enabled", prefix: "short/", expirationDays: 30 },
        { id: "abort-incomplete-multipart-uploads", status: "Enabled", abortIncompleteMultipartUploadDays: 7 },
      ],
    });
    const put = sent().find((c) => c.constructor.name === "PutBucketLifecycleConfigurationCommand");
    expect(put?.input.Bucket).toBe(bucket);
    const rules = (put?.input.LifecycleConfiguration as { Rules: Array<Record<string, unknown>> }).Rules;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      ID: "retention-short",
      Status: "Enabled",
      Filter: { Prefix: "short/" },
      Expiration: { Days: 30 },
    });
    expect(rules[1]).toMatchObject({
      ID: "abort-incomplete-multipart-uploads",
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
    });
  });

  it("getBucketLifecycle parses the bucket's existing rules (HEL-358)", async () => {
    const { adapter } = makeHarness();
    if (!isLifecycleCapable(adapter)) throw new Error("adapter should be lifecycle-capable");
    const cfg = await adapter.getBucketLifecycle();
    expect(cfg?.rules[0]).toMatchObject({
      id: "retention-short",
      status: "Enabled",
      prefix: "short/",
      expirationDays: 30,
    });
  });
});

describe("R2 / S3 parity", () => {
  it("derives identical keys and differs only in endpoint host", async () => {
    const s3 = makeS3Harness();
    const r2 = makeR2Harness();
    const ref = { workspaceId: WORKSPACE_A, collection: "run-input", objectId: SAMPLE_OBJECT_ID };
    const keyPath = `workspaces/${WORKSPACE_A}/run-input/${SAMPLE_OBJECT_ID}`;

    const s3Url = await s3.adapter.getSignedDownloadUrl(ref);
    const r2Url = await r2.adapter.getSignedDownloadUrl(ref);

    expect(s3Url).toContain(keyPath);
    expect(r2Url).toContain(keyPath);
    expect(s3Url).toMatch(s3.hostPattern);
    expect(r2Url).toMatch(r2.hostPattern);
    expect(s3.adapter.provider).toBe("s3");
    expect(r2.adapter.provider).toBe("r2");
  });
});
