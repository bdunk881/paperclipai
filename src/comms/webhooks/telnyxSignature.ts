/**
 * Telnyx webhook signature verification (HEL-613).
 *
 * Telnyx signs each webhook with Ed25519 over `${timestamp}|${rawBody}` and
 * sends `telnyx-signature-ed25519` (base64 signature) + `telnyx-timestamp`
 * headers. The configured public key (TELNYX_WEBHOOK_PUBLIC_KEY) is the base64
 * raw 32-byte Ed25519 key from the Telnyx portal.
 *
 * No SDK / nacl in the dep tree — Node's built-in `crypto.verify` handles
 * Ed25519 once the raw key is wrapped into SPKI DER. (`createVerify` does NOT
 * support Ed25519, so the one-shot API is required.)
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export const TELNYX_PUBLIC_KEY_ENV = "TELNYX_WEBHOOK_PUBLIC_KEY";

/** DER SPKI prefix for an Ed25519 public key (RFC 8410): 12 bytes, then the raw 32. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface TelnyxVerifyInput {
  /** Raw request body, exactly as received. */
  payload: string;
  /** `telnyx-signature-ed25519` header (base64). */
  signature: string;
  /** `telnyx-timestamp` header (unix seconds, as a string). */
  timestamp: string;
  /** Base64 raw Ed25519 public key. Defaults to env TELNYX_WEBHOOK_PUBLIC_KEY. */
  publicKey?: string;
  /** Replay tolerance in seconds. Default 300 (5 min). */
  toleranceSeconds?: number;
}

function publicKeyFromBase64(base64Key: string) {
  const raw = Buffer.from(base64Key, "base64");
  if (raw.length !== 32) {
    throw new Error(`telnyx public key must be 32 raw bytes, got ${raw.length}`);
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

/**
 * Verify a Telnyx webhook signature. Returns false (never throws) on any
 * missing input, stale timestamp, malformed key, or signature mismatch.
 */
export function verifyTelnyxSignature(input: TelnyxVerifyInput): boolean {
  const keyB64 = input.publicKey ?? process.env[TELNYX_PUBLIC_KEY_ENV];
  if (!keyB64 || !input.signature || !input.timestamp) {
    return false;
  }

  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  const tolerance = input.toleranceSeconds ?? 300;
  const ageSeconds = Math.abs(Date.now() / 1000 - ts);
  if (ageSeconds > tolerance) {
    return false;
  }

  try {
    const signedPayload = Buffer.from(`${input.timestamp}|${input.payload}`, "utf8");
    const signature = Buffer.from(input.signature, "base64");
    return cryptoVerify(null, signedPayload, publicKeyFromBase64(keyB64), signature);
  } catch {
    return false;
  }
}
