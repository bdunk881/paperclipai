/**
 * Read-only impersonation token mint + verify.
 *
 * A platform admin clicks "View as user"; we mint a short-lived (30 min)
 * impersonation JWT keyed by a separate signing secret so a leak of the
 * normal auth signing key cannot forge one. The customer dashboard recognizes
 * the token via the `impersonate` URL parameter and:
 *   - displays a banner
 *   - rejects every non-GET request for the lifetime of the session
 *
 * The token is single-purpose: it only carries enough claims for the dashboard
 * to render that user's data. It cannot be exchanged for a real Supabase
 * session token.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface ImpersonationJwtPayload {
  jti: string;
  iat: number;
  exp: number;
  /** The platform admin who initiated the session. */
  impersonator_user_id: string;
  /** The user being impersonated. */
  impersonated_user_id: string;
  /** Currently always 'read_only' in v1. */
  mode: "read_only";
  /** Server-side impersonation_sessions row id. */
  session_id: string;
}

const DEFAULT_TTL_SECONDS = 30 * 60;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function readSecret(): string {
  const s = process.env.IMPERSONATION_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "IMPERSONATION_TOKEN_SECRET is missing or too short (need ≥ 32 chars). Impersonation is disabled.",
    );
  }
  return s;
}

export function isImpersonationConfigured(): boolean {
  const s = process.env.IMPERSONATION_TOKEN_SECRET;
  return !!s && s.length >= 32;
}

export function mintImpersonationToken(args: {
  impersonatorUserId: string;
  impersonatedUserId: string;
  sessionId: string;
  ttlSeconds?: number;
}): { token: string; payload: ImpersonationJwtPayload } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (args.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const payload: ImpersonationJwtPayload = {
    jti: randomUUID(),
    iat: now,
    exp,
    impersonator_user_id: args.impersonatorUserId,
    impersonated_user_id: args.impersonatedUserId,
    mode: "read_only",
    session_id: args.sessionId,
  };

  // Custom HMAC-signed token (not standards-JWT, intentionally) — keeps the
  // verifier minimal and rules out alg-confusion attacks. Format:
  //   base64url(headerJson) . base64url(payloadJson) . base64url(hmacBytes)
  const header = JSON.stringify({ typ: "AFI", alg: "HS256" });
  const body = JSON.stringify(payload);
  const data = `${b64url(Buffer.from(header))}.${b64url(Buffer.from(body))}`;
  const sig = createHmac("sha256", readSecret()).update(data).digest();
  const token = `${data}.${b64url(sig)}`;
  return { token, payload };
}

export class InvalidImpersonationTokenError extends Error {
  constructor(public readonly reason: string) {
    super(`Invalid impersonation token: ${reason}`);
  }
}

export function verifyImpersonationToken(token: string): ImpersonationJwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new InvalidImpersonationTokenError("format");
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", readSecret()).update(data).digest();
  let actual: Buffer;
  try {
    actual = b64urlDecode(sigB64);
  } catch {
    throw new InvalidImpersonationTokenError("signature");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InvalidImpersonationTokenError("signature");
  }
  let payload: ImpersonationJwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as ImpersonationJwtPayload;
  } catch {
    throw new InvalidImpersonationTokenError("payload");
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    throw new InvalidImpersonationTokenError("expired");
  }
  if (payload.mode !== "read_only") {
    throw new InvalidImpersonationTokenError("mode");
  }
  if (!payload.impersonator_user_id || !payload.impersonated_user_id || !payload.session_id) {
    throw new InvalidImpersonationTokenError("claims");
  }
  return payload;
}
