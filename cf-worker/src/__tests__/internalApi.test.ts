import { describe, it, expect } from "vitest";
import { jwtVerify } from "jose";
import { mintInternalToken } from "../internalApi";

const SECRET = "test-shared-secret";
const env = {
  CF_WORKER_SHARED_SECRET: SECRET,
  CF_WORKER_INTERNAL_JWT_AUDIENCE: "autoflow-api-internal",
};

describe("mintInternalToken (HEL-798 B1)", () => {
  it("mints an HS256 token matching the requireCfWorker contract", async () => {
    const token = await mintInternalToken(env);
    const { payload, protectedHeader } = await jwtVerify(
      token,
      new TextEncoder().encode(SECRET),
      { issuer: "cf-worker", audience: "autoflow-api-internal" },
    );
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.iss).toBe("cf-worker");
    expect(payload.aud).toBe("autoflow-api-internal");
    expect(payload.sub).toBe("cf-worker");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    // The API rejects exp - iat > 30s; we must stay under the cap.
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(30);
  });

  it("defaults the audience when CF_WORKER_INTERNAL_JWT_AUDIENCE is unset", async () => {
    const token = await mintInternalToken({ CF_WORKER_SHARED_SECRET: SECRET });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
      issuer: "cf-worker",
      audience: "autoflow-api-internal",
    });
    expect(payload.aud).toBe("autoflow-api-internal");
  });

  it("carries a custom subject when provided", async () => {
    const token = await mintInternalToken(env, "workflow-doc-do");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
    expect(payload.sub).toBe("workflow-doc-do");
  });

  it("fails closed when the shared secret is missing (never signs with an empty secret)", async () => {
    await expect(mintInternalToken({ CF_WORKER_SHARED_SECRET: undefined })).rejects.toThrow(
      /not configured/i,
    );
    await expect(mintInternalToken({ CF_WORKER_SHARED_SECRET: "  " })).rejects.toThrow(
      /not configured/i,
    );
  });

  it("rejects verification under a different secret (signature is real)", async () => {
    const token = await mintInternalToken(env);
    await expect(
      jwtVerify(token, new TextEncoder().encode("wrong-secret"), { issuer: "cf-worker" }),
    ).rejects.toBeDefined();
  });
});
