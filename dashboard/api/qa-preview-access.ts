import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const QA_PREVIEW_USER = {
  id: "usr-qa-preview",
  email: "qa-preview@autoflow.local",
  name: "QA Preview User",
};

function normalizeSecret(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
  const allowNonPreview = process.env.QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW === "true";

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

  return res.status(200).json({ user: QA_PREVIEW_USER });
}
