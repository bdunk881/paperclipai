import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://app.helloautoflow.com",
  "https://staging.app.helloautoflow.com",
  "http://localhost:3000",
  "http://localhost:5173",
];

function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.WAITLIST_SIGNUP_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins?.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
}

function getAllowedOrigin(req: VercelRequest): string | null {
  const originHeader = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (!originHeader) {
    return null;
  }

  return getAllowedOrigins().includes(originHeader) ? originHeader : null;
}

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const allowedOrigin = getAllowedOrigin(req);
  if (!allowedOrigin) {
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body as { email?: string };

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  // TODO: persist to database or forward to email service (e.g. Mailchimp, Resend)
  console.log(`[waitlist] New signup: ${email}`);

  return res.status(200).json({ ok: true });
}
