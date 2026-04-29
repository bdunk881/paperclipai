import { randomUUID } from "node:crypto";
import express from "express";

const DEFAULT_CIAM_TENANT_SUBDOMAIN = "autoflowciam";
const DEFAULT_CIAM_TENANT_ID = "5e4f1080-8afc-4005-b05e-32b21e69363a";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "x-correlation-id",
  "x-ms-correlation-id",
  "x-ms-request-id",
  "traceparent",
  "tracestate",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "retry-after",
  "www-authenticate",
] as const;

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

function normalizeHttpsUrl(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.hostname.toLowerCase().endsWith(".ciamlogin.com")
    ) {
      return null;
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    return pathname ? `${url.origin}${pathname}` : url.origin;
  } catch {
    return null;
  }
}

function parseOriginAllowlist(value: string | undefined): Set<string> {
  if (typeof value !== "string") {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0 && origin !== "*")
  );
}

function resolveFallbackCiamAuthority(): string | null {
  const tenantSubdomain =
    process.env.AZURE_CIAM_TENANT_SUBDOMAIN ??
    process.env.AZURE_TENANT_SUBDOMAIN ??
    DEFAULT_CIAM_TENANT_SUBDOMAIN;
  const tenantId =
    process.env.AZURE_CIAM_TENANT_ID ??
    process.env.AZURE_TENANT_ID ??
    DEFAULT_CIAM_TENANT_ID;
  if (!tenantSubdomain?.trim() || !tenantId?.trim()) {
    return null;
  }

  return `https://${tenantSubdomain.trim()}.ciamlogin.com/${tenantId.trim()}`;
}

export function resolveNativeAuthProxyBaseUrl(): string | null {
  return resolveNativeAuthProxyBaseUrls()[0] ?? null;
}

export function resolveNativeAuthProxyBaseUrls(): string[] {
  return Array.from(
    new Set(
      [
        normalizeHttpsUrl(process.env.AUTH_NATIVE_AUTH_PROXY_BASE_URL),
        normalizeHttpsUrl(process.env.AZURE_CIAM_AUTHORITY),
        resolveFallbackCiamAuthority(),
      ].filter((value): value is string => Boolean(value))
    )
  );
}

function getAllowedOrigins(): Set<string> {
  return new Set([
    ...parseOriginAllowlist(process.env.ALLOWED_ORIGINS),
    ...parseOriginAllowlist(process.env.AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS),
    ...parseOriginAllowlist(process.env.AUTH_SOCIAL_ALLOWED_REDIRECT_ORIGINS),
    ...parseOriginAllowlist(process.env.SOCIAL_AUTH_DASHBOARD_URL),
  ]);
}

function isAllowedOrigin(originHeader: string | undefined): boolean {
  if (typeof originHeader !== "string") {
    return false;
  }

  const origin = originHeader.trim();
  if (!origin) {
    return false;
  }

  return getAllowedOrigins().has(origin);
}

function hasRequestBody(body: unknown): boolean {
  if (body == null) {
    return false;
  }

  if (typeof body === "string") {
    return body.length > 0;
  }

  if (Buffer.isBuffer(body)) {
    return body.length > 0;
  }

  if (typeof body === "object") {
    return Object.keys(body as Record<string, unknown>).length > 0;
  }

  return true;
}

function getForwardHeaders(req: express.Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of FORWARDED_REQUEST_HEADERS) {
    const value = req.header(header);
    if (typeof value === "string" && value.trim()) {
      headers[header] = value.trim();
    }
  }
  return headers;
}

function copyResponseHeaders(source: Headers, res: express.Response): void {
  for (const header of FORWARDED_RESPONSE_HEADERS) {
    const value = source.get(header);
    if (typeof value === "string" && value.trim()) {
      res.setHeader(header, value);
    }
  }
}

function isSupportedContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return true;
  }

  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("application/json") ||
    normalized.includes("application/x-www-form-urlencoded")
  );
}

function isFormUrlEncodedContentType(contentType: string | undefined): boolean {
  return typeof contentType === "string" && contentType.toLowerCase().includes("application/x-www-form-urlencoded");
}

function serializeFormUrlEncodedBody(body: Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(body)) {
    if (rawValue == null) {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value == null) {
        continue;
      }
      params.append(key, String(value));
    }
  }

  return params.toString();
}

function parseFormUrlEncodedBody(value: string): Record<string, string | string[]> {
  const params = new URLSearchParams(value);
  const parsed: Record<string, string | string[]> = {};

  for (const [key, rawValue] of params.entries()) {
    const existing = parsed[key];
    if (existing === undefined) {
      parsed[key] = rawValue;
      continue;
    }

    parsed[key] = Array.isArray(existing) ? [...existing, rawValue] : [existing, rawValue];
  }

  return parsed;
}

function sanitizeRequestBodyForLogging(body: unknown): Record<string, unknown> | null {
  if (!hasRequestBody(body)) {
    return null;
  }

  let source: Record<string, unknown>;
  if (typeof body === "string") {
    source = parseFormUrlEncodedBody(body);
  } else if (Buffer.isBuffer(body)) {
    source = parseFormUrlEncodedBody(body.toString("utf-8"));
  } else if (typeof body === "object" && body !== null) {
    source = body as Record<string, unknown>;
  } else {
    return { value: String(body) };
  }

  const sanitizedEntries = Object.entries(source).map(([key, value]) => {
    if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
      return [key, REDACTED_VALUE] as const;
    }

    if (Array.isArray(value)) {
      return [key, value.map((item) => String(item))] as const;
    }

    return [key, value == null ? value : String(value)] as const;
  });

  return Object.fromEntries(sanitizedEntries);
}

function formatNativeAuthLogValue(value: unknown): string {
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
    .map(([key, value]) => `${key}=${formatNativeAuthLogValue(value)}`)
    .join(" ");
  const message = `${NATIVE_AUTH_LOG_PREFIX} ${event}${details ? ` ${details}` : ""}`;

  if (level === "warn") {
    console.warn(message);
    return;
  }

  console.log(message);
}

function getCorrelationId(req: express.Request): string {
  const forwardedCorrelationId = req.header("x-correlation-id")?.trim();
  if (forwardedCorrelationId) {
    return forwardedCorrelationId;
  }

  const microsoftCorrelationId = req.header("x-ms-correlation-id")?.trim();
  if (microsoftCorrelationId) {
    return microsoftCorrelationId;
  }

  return randomUUID();
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

/**
 * Always serialize the request body as application/x-www-form-urlencoded for
 * Azure CIAM, regardless of what the frontend sent.  The frontend may send
 * JSON (which Vercel rewrites preserve) or form-encoded (which Vercel drops).
 */
function serializeRequestBodyAsForm(body: unknown): string | undefined {
  if (!hasRequestBody(body)) {
    return undefined;
  }

  // Already a form-encoded string (from express.text middleware)
  if (typeof body === "string") {
    return body;
  }

  if (Buffer.isBuffer(body)) {
    return body.toString("utf-8");
  }

  if (typeof body === "object" && body !== null) {
    return serializeFormUrlEncodedBody(body as Record<string, unknown>);
  }

  return undefined;
}

const router = express.Router();

const ALLOWED_NATIVE_AUTH_PATHS = [
  "oauth2/v2.0/token",
  "oauth2/v2.0/initiate",
  "oauth2/v2.0/challenge",
  "oauth2/v2.0/introspect",
  "signup/v1.0/start",
  "signup/v1.0/challenge",
  "signup/v1.0/continue",
  "signin/v1.0/start",
  "signin/v1.0/challenge",
  "signin/v1.0/continue",
  "resetpassword/v1.0/challenge",
  "resetpassword/v1.0/start",
  "resetpassword/v1.0/continue",
  "resetpassword/v1.0/poll_completion",
  "resetpassword/v1.0/submit",
] as const;

function createNativeAuthProxyHandler(proxyPath: (typeof ALLOWED_NATIVE_AUTH_PATHS)[number]) {
  return async (req: express.Request, res: express.Response) => {
    const origin = req.header("origin");
    const correlationId = getCorrelationId(req);

    if (!isAllowedOrigin(origin)) {
      logNativeAuth(
        "REJECTED",
        {
          path: proxyPath,
          origin,
          correlationId,
          reason: "origin_not_allowed",
        },
        "warn"
      );
      res.status(403).json({ error: "Origin is not allowed for native auth proxy requests." });
      return;
    }

    const upstreamBaseUrl = resolveNativeAuthProxyBaseUrl();
    if (!upstreamBaseUrl) {
      logNativeAuth(
        "REJECTED",
        {
          path: proxyPath,
          origin,
          correlationId,
          reason: "proxy_not_configured",
        },
        "warn"
      );
      res.status(503).json({ error: "Native auth proxy is not configured." });
      return;
    }

    const contentType = req.header("content-type");
    if (!isSupportedContentType(contentType)) {
      logNativeAuth(
        "REJECTED",
        {
          path: proxyPath,
          origin,
          correlationId,
          contentType,
          reason: "unsupported_content_type",
        },
        "warn"
      );
      res.status(415).json({
        error: "Native auth proxy only supports application/json and application/x-www-form-urlencoded payloads.",
      });
      return;
    }

    const upstreamHeaders = getForwardHeaders(req);
    upstreamHeaders["x-correlation-id"] = correlationId;
    // Always send form-urlencoded to CIAM regardless of frontend content-type
    upstreamHeaders["content-type"] = "application/x-www-form-urlencoded";

    const init: RequestInit = {
      method: "POST",
      headers: upstreamHeaders,
    };

    const requestBody = serializeRequestBodyAsForm(req.body);
    if (requestBody !== undefined) {
      init.body = requestBody;
    }
    const sanitizedBody = sanitizeRequestBodyForLogging(req.body);

    const upstreamBaseUrls = resolveNativeAuthProxyBaseUrls();
    const queryIndex = req.originalUrl.indexOf("?");
    let lastError: Error | null = null;

    for (const upstreamBase of upstreamBaseUrls) {
      const upstreamUrl = new URL(`${upstreamBase}/${proxyPath}`);
      if (queryIndex >= 0) {
        upstreamUrl.search = req.originalUrl.slice(queryIndex);
      }

      logNativeAuth("REQUEST", {
        path: proxyPath,
        upstreamUrl: upstreamUrl.toString(),
        origin,
        correlationId,
        body: sanitizedBody,
      });

      const startTime = Date.now();
      try {
        const upstreamResponse = await fetch(upstreamUrl, init);
        copyResponseHeaders(upstreamResponse.headers, res);

        const body = await upstreamResponse.text();
        const elapsedMs = Date.now() - startTime;
        const { error, errorDescription } = parseUpstreamErrorDetails(body);
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
        res.status(upstreamResponse.status);

        if (!body) {
          res.end();
          return;
        }

        res.send(body);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown upstream error");
        logNativeAuth(
          "UPSTREAM_ERROR",
          {
            path: proxyPath,
            upstreamUrl: upstreamUrl.toString(),
            correlationId,
            elapsedMs: Date.now() - startTime,
            error: lastError.message,
          },
          "warn"
        );
      }
    }

    if (lastError) {
      res.status(502).json({ error: `Native auth upstream request failed: ${lastError.message}` });
      return;
    }

    res.status(502).json({ error: "Native auth upstream request failed: Unknown upstream error" });
  };
}

for (const proxyPath of ALLOWED_NATIVE_AUTH_PATHS) {
  router.post(`/${proxyPath}`, createNativeAuthProxyHandler(proxyPath));
}

export default router;
