/**
 * Live round-trip against a real bucket (HEL-352 acceptance). Skips unless
 * STORAGE_PROVIDER + the matching creds are set — mirrors how
 * src/db/rls.integration.test.ts skips without DATABASE_URL, so CI stays green
 * without secrets. To run it:
 *
 *   STORAGE_PROVIDER=s3 STORAGE_S3_REGION=… STORAGE_S3_BUCKET=… \
 *   STORAGE_S3_ACCESS_KEY_ID=… STORAGE_S3_SECRET_ACCESS_KEY=… \
 *   STORAGE_S3_ENDPOINT=http://localhost:4566 \   # LocalStack/MinIO, optional
 *   npx jest --config jest.config.cjs --runInBand src/storage/liveIntegration.test.ts
 */

import { Readable } from "stream";
import { buildStorageAdapter } from "./index";

const provider = (process.env.STORAGE_PROVIDER ?? "").toLowerCase();

const REQUIRED_BY_PROVIDER: Record<string, string[]> = {
  r2: ["STORAGE_R2_ACCOUNT_ID", "STORAGE_R2_BUCKET", "STORAGE_R2_ACCESS_KEY_ID", "STORAGE_R2_SECRET_ACCESS_KEY"],
  s3: ["STORAGE_S3_REGION", "STORAGE_S3_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY"],
};

const hasCreds =
  (provider === "r2" || provider === "s3") &&
  REQUIRED_BY_PROVIDER[provider].every((key) => (process.env[key] ?? "").trim().length > 0);

const describeLive = hasCreds ? describe : describe.skip;

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

describeLive(`storage live integration (${provider || "no provider configured"})`, () => {
  const WID = "11111111-1111-4111-8111-111111111111";

  it("round-trips put -> get -> list -> delete against the real bucket", async () => {
    const adapter = buildStorageAdapter();
    const put = await adapter.putObject({
      workspaceId: WID,
      collection: "test",
      filename: "hello.txt",
      body: Buffer.from("hello live"),
      contentType: "text/plain",
    });
    try {
      const got = await adapter.getObject(put.ref);
      expect(await streamToString(got.body)).toBe("hello live");

      const list = await adapter.listObjects({ workspaceId: WID, collection: "test" });
      expect(list.objects.some((o) => o.storageKey === put.storageKey)).toBe(true);
    } finally {
      await adapter.deleteObject(put.ref);
    }
  }, 30000);
});
