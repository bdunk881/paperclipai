import type { VercelRequest, VercelResponse } from "@vercel/node";

type ErrorPayload = { error: string };

function normalizeBackendBase(value?: string): string {
  if (!value) return "";

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

function resolveBackendApiBase(): string {
  const candidates = [
    process.env.BILLING_API_BASE_URL,
    process.env.BACKEND_API_BASE_URL,
    process.env.VITE_API_BASE_URL,
    process.env.VITE_API_URL,
    "https://api.helloautoflow.com",
  ];

  for (const value of candidates) {
    const trimmed = normalizeBackendBase(value);
    if (!trimmed) continue;
    return trimmed;
  }

  return "https://api.helloautoflow.com";
}

function sendError(res: VercelResponse, status: number, message: string): void {
  res.status(status).json({ error: message } satisfies ErrorPayload);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  const backendBase = resolveBackendApiBase();
  const upstreamUrl = `${backendBase}/api/billing/checkout`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": req.headers["x-forwarded-for"]?.toString() ?? req.socket.remoteAddress ?? "",
        "X-Forwarded-Host": req.headers.host ?? "",
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const bodyText = await upstreamRes.text();
    const contentType = upstreamRes.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const payload = bodyText ? JSON.parse(bodyText) : {};
        res.status(upstreamRes.status).json(payload);
      } catch {
        sendError(res, 502, "Invalid checkout response from billing API");
      }
      return;
    }

    if (!upstreamRes.ok) {
      sendError(res, upstreamRes.status, "Checkout failed");
      return;
    }

    // Backend should always return JSON on success, but guard for unexpected upstreams.
    sendError(res, 502, "Invalid checkout response from billing API");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout service unavailable";
    sendError(res, 502, message);
  }
}
