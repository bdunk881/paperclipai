import { createHmac } from "crypto";
import { verifyHmac, signOutboundBody } from "./verifySignature";

const SECRET = "test-secret";

function makeSignature(body: string, secret = SECRET, algorithm = "sha256"): string {
  return createHmac(algorithm, secret).update(body).digest("hex");
}

describe("verifyHmac", () => {
  it("accepts a valid signature", () => {
    const body = Buffer.from("hello world");
    const sig = makeSignature(body.toString());
    expect(() => verifyHmac({ secret: SECRET, rawBody: body, signatureHeader: sig })).not.toThrow();
  });

  it("strips a prefix before comparing", () => {
    const body = Buffer.from("hello world");
    const sig = `sha256=${makeSignature(body.toString())}`;
    expect(() =>
      verifyHmac({ secret: SECRET, rawBody: body, signatureHeader: sig, prefix: "sha256=" })
    ).not.toThrow();
  });

  it("rejects a tampered body", () => {
    const body = Buffer.from("hello world");
    const sig = makeSignature("different body");
    expect(() => verifyHmac({ secret: SECRET, rawBody: body, signatureHeader: sig })).toThrow(
      "Webhook signature mismatch"
    );
  });

  it("rejects a missing signature header", () => {
    const body = Buffer.from("hello world");
    expect(() =>
      verifyHmac({ secret: SECRET, rawBody: body, signatureHeader: undefined })
    ).toThrow("Missing webhook signature header");
  });

  it("rejects an empty signature header", () => {
    const body = Buffer.from("hello world");
    expect(() =>
      verifyHmac({ secret: SECRET, rawBody: body, signatureHeader: "   " })
    ).toThrow("Missing webhook signature header");
  });

  it("rejects an expired timestamp", () => {
    const body = Buffer.from("hello world");
    const sig = makeSignature(body.toString());
    const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    expect(() =>
      verifyHmac({ secret: SECRET, rawBody: body, signatureHeader: sig, timestamp: staleTimestamp })
    ).toThrow("Webhook timestamp outside replay window");
  });

  it("accepts a fresh timestamp within the replay window", () => {
    const body = Buffer.from("hello world");
    const sig = makeSignature(body.toString());
    const freshTimestamp = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    expect(() =>
      verifyHmac({ secret: SECRET, rawBody: body, signatureHeader: sig, timestamp: freshTimestamp })
    ).not.toThrow();
  });

  it("uses sha1 when specified", () => {
    const body = Buffer.from("payload");
    const sig = makeSignature(body.toString(), SECRET, "sha1");
    expect(() =>
      verifyHmac({ secret: SECRET, rawBody: body, signatureHeader: sig, algorithm: "sha1" })
    ).not.toThrow();
  });
});

describe("signOutboundBody", () => {
  it("produces a sha256= prefixed hex digest", () => {
    const result = signOutboundBody(SECRET, "payload");
    expect(result).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("produces stable output for the same inputs", () => {
    const a = signOutboundBody(SECRET, "payload");
    const b = signOutboundBody(SECRET, "payload");
    expect(a).toBe(b);
  });

  it("produces different output for different bodies", () => {
    const a = signOutboundBody(SECRET, "payload-a");
    const b = signOutboundBody(SECRET, "payload-b");
    expect(a).not.toBe(b);
  });

  it("produces different output for different secrets", () => {
    const a = signOutboundBody("secret-1", "payload");
    const b = signOutboundBody("secret-2", "payload");
    expect(a).not.toBe(b);
  });
});
