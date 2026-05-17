import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_MAX_AGE_SECONDS = 300;

export interface VerifyHmacParams {
  secret: string;
  rawBody: Buffer;
  /** The full signature header value, e.g. "sha256=abc123" or "abc123" */
  signatureHeader: string | undefined;
  algorithm?: "sha256" | "sha1";
  /** Strip this prefix (case-insensitive) from signatureHeader before comparing */
  prefix?: string;
  /**
   * When set, checks that the request is not older than maxAgeSeconds.
   * Pass the Unix epoch timestamp (seconds) from the request.
   */
  timestamp?: number;
  /** Replay window in seconds — default 300 (5 minutes). Only used when `timestamp` is provided. */
  maxAgeSeconds?: number;
}

/**
 * Generic HMAC signature verifier for inbound webhook requests.
 * Throws an Error with `statusCode = 401` on any verification failure.
 */
export function verifyHmac(params: VerifyHmacParams): void {
  const {
    secret,
    rawBody,
    signatureHeader,
    algorithm = "sha256",
    prefix,
    timestamp,
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  } = params;

  if (!signatureHeader || !signatureHeader.trim()) {
    throw Object.assign(new Error("Missing webhook signature header"), { statusCode: 401 });
  }

  if (timestamp !== undefined) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > maxAgeSeconds) {
      throw Object.assign(new Error("Webhook timestamp outside replay window"), { statusCode: 401 });
    }
  }

  let incoming = signatureHeader.trim();
  if (prefix && incoming.toLowerCase().startsWith(prefix.toLowerCase())) {
    incoming = incoming.slice(prefix.length);
  }

  const expected = createHmac(algorithm, secret).update(rawBody).digest("hex");

  const incomingBuf = Buffer.from(incoming, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (incomingBuf.length !== expectedBuf.length || !timingSafeEqual(incomingBuf, expectedBuf)) {
    throw Object.assign(new Error("Webhook signature mismatch"), { statusCode: 401 });
  }
}

/**
 * Signs an outbound request body for user-configured webhook delivery.
 * Returns the value to use as the `X-AutoFlow-Signature` header.
 */
export function signOutboundBody(secret: string, body: string): string {
  const hex = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return `sha256=${hex}`;
}
