import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const QA_PREVIEW_USER = {
  id: "qa-smoke-user",
  email: "qa-preview@autoflow.local",
  name: "QA Preview User",
};

const DEFAULT_APP_JWT_AUDIENCE = "autoflow-api";
const DEFAULT_APP_JWT_ISSUER = "autoflow-app";
const DEFAULT_APP_JWT_EXPIRES_IN_SECONDS = 8 * 60 * 60;

function normalizeSecret(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\\n/g, "\n");
  return trimmed ? trimmed : null;
}

function resolveAppJwtConfig(): {
  audience: string;
  expiresInSeconds: number;
  issuer: string;
  secret: string;
} | null {
  const secret = normalizeSecret(process.env.APP_JWT_SECRET);
  if (!secret) {
    return null;
  }

  return {
    secret,
    issuer: process.env.APP_JWT_ISSUER?.trim() || DEFAULT_APP_JWT_ISSUER,
    audience: process.env.APP_JWT_AUDIENCE?.trim() || DEFAULT_APP_JWT_AUDIENCE,
    expiresInSeconds: parseJwtExpirySeconds(process.env.APP_JWT_EXPIRES_IN),
  };
}

function parseJwtExpirySeconds(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) {
    return DEFAULT_APP_JWT_EXPIRES_IN_SECONDS;
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return DEFAULT_APP_JWT_EXPIRES_IN_SECONDS;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "s" ? 1 :
    unit === "m" ? 60 :
    unit === "h" ? 60 * 60 :
    60 * 60 * 24;
  return amount * multiplier;
}

function signQaPreviewToken(user: typeof QA_PREVIEW_USER): string {
  const config = resolveAppJwtConfig();
  if (!config) {
    throw new Error("APP_JWT_SECRET is required for social auth");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      iss: config.issuer,
      aud: config.audience,
      iat: now,
      exp: now + config.expiresInSeconds,
    })
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", config.secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

function timingSafeTokenMatch(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);

  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const vercelEnv = normalizeSecret(process.env.VERCEL_ENV);
  // Phase 5 (ALT-2078) production-boot guard parity: ignore the
  // QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW override when NODE_ENV is "production"
  // (or absent — fail closed). The override is for local / non-preview QA
  // smoke runs only; it must never relax the preview gate in production.
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  const isProduction = !nodeEnv || nodeEnv === "production";
  const allowNonPreview =
    !isProduction && process.env.QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW === "true";

  if (vercelEnv !== "preview" && !allowNonPreview) {
    return res.status(403).json({ error: "QA preview access is only enabled on preview deployments" });
  }

  const expectedToken = normalizeSecret(process.env.QA_PREVIEW_ACCESS_TOKEN);
  if (!expectedToken) {
    return res.status(503).json({ error: "QA preview access is not configured" });
  }

  const requestToken =
    typeof req.body?.token === "string" ? normalizeSecret(req.body.token) : null;

  if (!requestToken) {
    return res.status(400).json({ error: "token is required" });
  }

  if (!timingSafeTokenMatch(requestToken, expectedToken)) {
    return res.status(401).json({ error: "invalid preview access token" });
  }

  let accessToken: string;
  try {
    accessToken = signQaPreviewToken(QA_PREVIEW_USER);
  } catch (error) {
    console.error("[qa-preview-access] failed to issue app token", error);
    return res.status(503).json({ error: "QA preview access is not fully configured" });
  }

  return res.status(200).json({ accessToken, user: QA_PREVIEW_USER });
}
