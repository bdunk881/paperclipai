/**
 * HEL-708: scoped realtime access tokens.
 *
 * A short-lived, READ-ONLY, single-run token that lets a browser subscribe to
 * one run's live event stream WITHOUT a full session — the trigger.dev "public
 * access token" pattern. Minted by an authenticated endpoint
 * (`POST /api/runs/:id/realtime-token`) and verified on the public SSE endpoint
 * (`GET /api/realtime/runs/:id/stream`).
 *
 * Security posture (mirrors the impersonation token, intentionally minimal):
 *   - Custom HMAC-SHA256 token (header.payload.sig, base64url), NOT standards
 *     JWT — rules out alg-confusion; the verifier is tiny.
 *   - Signed with a DEDICATED secret (REALTIME_TOKEN_SECRET), so leaking the
 *     normal auth signing key can't forge one, and vice-versa.
 *   - Scoped to a single (workspace_id, run_id) and read-only; the SSE endpoint
 *     additionally checks the path's run id equals the token's.
 *   - Short TTL (default 30 min). Timing-safe signature compare.
 *
 * Disabled (mint returns 503) until REALTIME_TOKEN_SECRET (≥ 32 chars) is set.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface RealtimeTokenPayload {
  jti: string;
  iat: number;
  exp: number;
  workspace_id: string;
  run_id: string;
  scope: "run_read";
}

export const DEFAULT_REALTIME_TOKEN_TTL_SECONDS = 30 * 60;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function readSecret(): string {
  const s = process.env.REALTIME_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "REALTIME_TOKEN_SECRET is missing or too short (need ≥ 32 chars). Realtime tokens are disabled.",
    );
  }
  return s;
}

export function isRealtimeTokenConfigured(): boolean {
  const s = process.env.REALTIME_TOKEN_SECRET;
  return !!s && s.length >= 32;
}

export function mintRealtimeToken(args: {
  workspaceId: string;
  runId: string;
  ttlSeconds?: number;
}): { token: string; payload: RealtimeTokenPayload } {
  const now = Math.floor(Date.now() / 1000);
  const payload: RealtimeTokenPayload = {
    jti: randomUUID(),
    iat: now,
    exp: now + (args.ttlSeconds ?? DEFAULT_REALTIME_TOKEN_TTL_SECONDS),
    workspace_id: args.workspaceId,
    run_id: args.runId,
    scope: "run_read",
  };

  const header = JSON.stringify({ typ: "AFRT", alg: "HS256" });
  const body = JSON.stringify(payload);
  const data = `${b64url(Buffer.from(header))}.${b64url(Buffer.from(body))}`;
  const sig = createHmac("sha256", readSecret()).update(data).digest();
  return { token: `${data}.${b64url(sig)}`, payload };
}

export class InvalidRealtimeTokenError extends Error {
  constructor(public readonly reason: string) {
    super(`Invalid realtime token: ${reason}`);
    this.name = "InvalidRealtimeTokenError";
  }
}

export function verifyRealtimeToken(token: string): RealtimeTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new InvalidRealtimeTokenError("format");
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", readSecret()).update(data).digest();
  let actual: Buffer;
  try {
    actual = b64urlDecode(sigB64);
  } catch {
    throw new InvalidRealtimeTokenError("signature");
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InvalidRealtimeTokenError("signature");
  }
  let payload: RealtimeTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as RealtimeTokenPayload;
  } catch {
    throw new InvalidRealtimeTokenError("payload");
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    throw new InvalidRealtimeTokenError("expired");
  }
  if (payload.scope !== "run_read") {
    throw new InvalidRealtimeTokenError("scope");
  }
  if (!payload.workspace_id || !payload.run_id) {
    throw new InvalidRealtimeTokenError("claims");
  }
  return payload;
}
