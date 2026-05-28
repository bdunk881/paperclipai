/**
 * HMAC-SHA256 signer for outbound Ask-an-Agent webhooks (HEL infra PR #2).
 *
 * Follows the Slack incoming-webhook convention so receivers can verify
 * with a one-line HMAC check:
 *
 *   HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *
 * Sent as `X-AutoFlow-Signature: sha256=<hex>` alongside
 * `X-AutoFlow-Webhook-Id` and `X-AutoFlow-Timestamp` so the receiver can
 * reject replays past their own freshness window.
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface SignedRequestHeaders {
  "X-AutoFlow-Webhook-Id": string;
  "X-AutoFlow-Timestamp": string;
  "X-AutoFlow-Signature"?: string;
}

export function buildSignedHeaders(args: {
  webhookId: string;
  secret?: string | null;
  rawBody: string;
  timestamp?: number;
}): SignedRequestHeaders {
  const timestamp = String(args.timestamp ?? Math.floor(Date.now() / 1000));
  const headers: SignedRequestHeaders = {
    "X-AutoFlow-Webhook-Id": args.webhookId,
    "X-AutoFlow-Timestamp": timestamp,
  };
  if (args.secret) {
    const mac = createHmac("sha256", args.secret);
    mac.update(`${timestamp}.${args.rawBody}`);
    headers["X-AutoFlow-Signature"] = `sha256=${mac.digest("hex")}`;
  }
  return headers;
}

export interface VerifyInput {
  secret: string;
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  /** Max age in seconds. Default 5 min — clamps replay window. */
  maxAgeSeconds?: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_signature" | "missing_timestamp" | "stale_timestamp" | "bad_format" | "signature_mismatch" };

export function verifySignature(input: VerifyInput): VerifyResult {
  if (!input.signature) return { ok: false, reason: "missing_signature" };
  if (!input.timestamp) return { ok: false, reason: "missing_timestamp" };
  const ts = Number.parseInt(input.timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_format" };
  const maxAge = input.maxAgeSeconds ?? 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > maxAge) return { ok: false, reason: "stale_timestamp" };

  const match = /^sha256=([0-9a-f]{64})$/i.exec(input.signature);
  if (!match) return { ok: false, reason: "bad_format" };

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex");
  const provided = match[1].toLowerCase();
  if (expected.length !== provided.length) return { ok: false, reason: "signature_mismatch" };

  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    return timingSafeEqual(a, b)
      ? { ok: true }
      : { ok: false, reason: "signature_mismatch" };
  } catch {
    return { ok: false, reason: "signature_mismatch" };
  }
}
