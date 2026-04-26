import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam";

const ALLOWED_PATHS = new Set([
  "oauth2/v2.0/token",
  "oauth2/v2.0/initiate",
  "oauth2/v2.0/challenge",
  "oauth2/v2.0/introspect",
  "signup/v1.0/start",
  "signup/v1.0/challenge",
  "signup/v1.0/continue",
  "challenge/v1.0/continue",
  "resetpassword/v1.0/start",
  "resetpassword/v1.0/challenge",
  "resetpassword/v1.0/continue",
  "resetpassword/v1.0/submit",
  "resetpassword/v1.0/poll_completion",
]);

function getCiamAuthority(): string {
  const subdomain =
    (process.env.AZURE_CIAM_TENANT_SUBDOMAIN ?? process.env.AZURE_TENANT_SUBDOMAIN ?? "").trim() ||
    DEFAULT_CIAM_TENANT_SUBDOMAIN;
  const tenantId = (process.env.AZURE_CIAM_TENANT_ID ?? process.env.AZURE_TENANT_ID ?? "").trim();
  const domain = tenantId || `${subdomain}.onmicrosoft.com`;
  return `https://${subdomain}.ciamlogin.com/${domain}`;
}

function serializeFormBody(body: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed." });
  }

  const pathSegments = req.query.path;
  const proxyPath = Array.isArray(pathSegments) ? pathSegments.join("/") : pathSegments;

  if (!proxyPath || !ALLOWED_PATHS.has(proxyPath)) {
    return res.status(400).json({ error: "Native auth proxy path is not allowed." });
  }

  const authority = getCiamAuthority();
  const upstreamUrl = `${authority}/${proxyPath}`;

  // Build form-urlencoded body from JSON input
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
    return res.status(400).json({ error: "Request body is required." });
  }

  const formBody = serializeFormBody(body);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: formBody,
    });

    const responseText = await upstreamResponse.text();

    // Forward relevant headers
    const contentType = upstreamResponse.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    const cacheControl = upstreamResponse.headers.get("cache-control");
    if (cacheControl) {
      res.setHeader("Cache-Control", cacheControl);
    }

    return res.status(upstreamResponse.status).send(responseText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(502).json({ error: `CIAM upstream request failed: ${message}` });
  }
}
