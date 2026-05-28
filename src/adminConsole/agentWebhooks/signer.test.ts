import { buildSignedHeaders, verifySignature } from "./signer";

describe("buildSignedHeaders + verifySignature round-trip", () => {
  it("accepts a freshly-signed request", () => {
    const headers = buildSignedHeaders({
      webhookId: "wh-1",
      secret: "shh",
      rawBody: '{"ok":true}',
    });
    const result = verifySignature({
      secret: "shh",
      rawBody: '{"ok":true}',
      timestamp: headers["X-AutoFlow-Timestamp"],
      signature: headers["X-AutoFlow-Signature"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when the secret differs", () => {
    const headers = buildSignedHeaders({
      webhookId: "wh-1",
      secret: "shh",
      rawBody: "{}",
    });
    const result = verifySignature({
      secret: "wrong",
      rawBody: "{}",
      timestamp: headers["X-AutoFlow-Timestamp"],
      signature: headers["X-AutoFlow-Signature"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature_mismatch");
  });

  it("rejects when the body has been tampered with", () => {
    const headers = buildSignedHeaders({
      webhookId: "wh-1",
      secret: "shh",
      rawBody: '{"v":1}',
    });
    const result = verifySignature({
      secret: "shh",
      rawBody: '{"v":2}',
      timestamp: headers["X-AutoFlow-Timestamp"],
      signature: headers["X-AutoFlow-Signature"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects stale timestamps", () => {
    const oldTs = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    const headers = buildSignedHeaders({
      webhookId: "wh-1",
      secret: "shh",
      rawBody: "{}",
      timestamp: oldTs,
    });
    const result = verifySignature({
      secret: "shh",
      rawBody: "{}",
      timestamp: headers["X-AutoFlow-Timestamp"],
      signature: headers["X-AutoFlow-Signature"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale_timestamp");
  });

  it("rejects missing signature", () => {
    const result = verifySignature({
      secret: "shh",
      rawBody: "{}",
      timestamp: String(Math.floor(Date.now() / 1000)),
      signature: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_signature");
  });

  it("rejects bad-format signatures", () => {
    const result = verifySignature({
      secret: "shh",
      rawBody: "{}",
      timestamp: String(Math.floor(Date.now() / 1000)),
      signature: "not-a-real-signature",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_format");
  });
});
