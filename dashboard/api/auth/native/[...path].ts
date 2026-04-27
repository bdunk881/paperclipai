import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";

const DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam";
const NATIVE_AUTH_LOG_PREFIX = "[native-auth]";
const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "new_password",
  "oob",
  "continuation_token",
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "client_secret",
  "code",
]);

const ALLOWED_PATHS = new Set([
  "oauth2/v2.0/token",
  "oauth2/v2.0/initiate",
  "oauth2/v2.0/challenge",
  "oauth2/v2.0/introspect",
  "signup/v1.0/start",
  "signup/v1.0/challenge",
  "signup/v1.0/continue",
  "challenge/v1.0/continue",
  "signin/v1.0/start",
  "signin/v1.0/challenge",
  "signin/v1.0/continue",
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

function sanitizeBodyForLogging(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
        return [key, REDACTED_VALUE];
      }

      if (Array.isArray(value)) {
        return [key, value.map((item) => String(item))];
      }

      return [key, value == null ? value : String(value)];
    })
  );
}

function formatLogValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  return JSON.stringify(value);
}

function logNativeAuth(
  event: "REQUEST" | "RESPONSE" | "UPSTREAM_ERROR" | "REJECTED",
  fields: Record<string, unknown>,
  level: "info" | "warn" = "info"
): void {
  const details = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatLogValue(value)}`)
    .join(" ");
  const message = `${NATIVE_AUTH_LOG_PREFIX} ${event}${details ? ` ${details}` : ""}`;

  if (level === "warn") {
    console.warn(message);
    return;
  }

  console.log(message);
}

function getCorrelationId(req: VercelRequest): string {
  const headerValue = req.headers["x-correlation-id"] ?? req.headers["x-ms-correlation-id"];
  if (Array.isArray(headerValue)) {
    return headerValue[0]?.trim() || randomUUID();
  }

  return headerValue?.trim() || randomUUID();
}

function parseUpstreamErrorDetails(body: string): { error?: string; errorDescription?: string } {
  if (!body) {
    return {};
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      error: typeof parsed.error === "string" ? parsed.error : undefined,
      errorDescription:
        typeof parsed.error_description === "string" ? parsed.error_description : undefined,
    };
  } catch {
    return {};
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const correlationId = getCorrelationId(req);
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;

  if (req.method !== "POST") {
    logNativeAuth("REJECTED", { correlationId, origin, reason: "method_not_allowed", method: req.method }, "warn");
    return res.status(405).json({ error: "Only POST is allowed." });
  }

  const pathSegments = req.query.path;
  const proxyPath = Array.isArray(pathSegments) ? pathSegments.join("/") : pathSegments;

  if (!proxyPath || !ALLOWED_PATHS.has(proxyPath)) {
    logNativeAuth("REJECTED", { correlationId, origin, path: proxyPath, reason: "path_not_allowed" }, "warn");
    return res.status(400).json({ error: "Native auth proxy path is not allowed." });
  }

  const authority = getCiamAuthority();
  const upstreamUrl = `${authority}/${proxyPath}`;

  // Build form-urlencoded body from JSON input
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
    logNativeAuth("REJECTED", { correlationId, origin, path: proxyPath, reason: "missing_body" }, "warn");
    return res.status(400).json({ error: "Request body is required." });
  }

  const formBody = serializeFormBody(body);
  const sanitizedBody = sanitizeBodyForLogging(body);

  logNativeAuth("REQUEST", {
    path: proxyPath,
    upstreamUrl,
    origin,
    correlationId,
    body: sanitizedBody,
  });

  try {
    const startTime = Date.now();
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-correlation-id": correlationId,
      },
      body: formBody,
    });

    const responseText = await upstreamResponse.text();
    const elapsedMs = Date.now() - startTime;
    const { error, errorDescription } = parseUpstreamErrorDetails(responseText);
    logNativeAuth("RESPONSE", {
      path: proxyPath,
      status: upstreamResponse.status,
      correlationId,
      error,
      errorDescription,
      xMsRequestId: upstreamResponse.headers.get("x-ms-request-id") ?? undefined,
      xMsCorrelationId: upstreamResponse.headers.get("x-ms-correlation-id") ?? undefined,
      elapsedMs,
    });

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
    logNativeAuth(
      "UPSTREAM_ERROR",
      { path: proxyPath, upstreamUrl, correlationId, error: message },
      "warn"
    );
    return res.status(502).json({ error: `CIAM upstream request failed: ${message}` });
  }
}
