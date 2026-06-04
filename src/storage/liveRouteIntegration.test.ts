/**
 * Live presigned-URL round-trip (HEL-354) — exercises the signed PUT/GET flow
 * the file routes expose (`getSignedUploadUrl` → client HTTP PUT →
 * `getSignedDownloadUrl` → client HTTP GET → `deleteObject`), against the real
 * bucket. HEL-352's live test covered only server-side put/get; this covers the
 * client-facing presigned flow.
 *
 * Skips unless STORAGE_PROVIDER + creds are set (mirrors liveIntegration.test.ts),
 * so CI stays green. To run:
 *   STORAGE_PROVIDER=s3 STORAGE_S3_REGION=… STORAGE_S3_BUCKET=… \
 *   STORAGE_S3_ACCESS_KEY_ID=… STORAGE_S3_SECRET_ACCESS_KEY=… \
 *   npx jest --config jest.config.cjs --runInBand src/storage/liveRouteIntegration.test.ts
 */

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

describeLive(`file routes live presigned round-trip (${provider || "no provider configured"})`, () => {
  const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
  const BODY = "hello via presigned url";

  it("presigned PUT uploads, presigned GET downloads the same bytes, deleteObject removes", async () => {
    const adapter = buildStorageAdapter();

    const upload = await adapter.getSignedUploadUrl({
      workspaceId: WORKSPACE_ID,
      collection: "test",
      filename: "route-smoke.txt",
      contentType: "text/plain",
    });

    const putRes = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: BODY });
    expect(putRes.ok).toBe(true);

    try {
      const downloadUrl = await adapter.getSignedDownloadUrl(upload.ref);
      const getRes = await fetch(downloadUrl);
      expect(getRes.ok).toBe(true);
      expect(await getRes.text()).toBe(BODY);
    } finally {
      await adapter.deleteObject(upload.ref);
    }
  }, 30_000);
});
