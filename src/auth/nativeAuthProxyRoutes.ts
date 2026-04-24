import express from "express";

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
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
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
  const tenantSubdomain = process.env.AZURE_CIAM_TENANT_SUBDOMAIN ?? process.env.AZURE_TENANT_SUBDOMAIN;
  const tenantId = process.env.AZURE_CIAM_TENANT_ID ?? process.env.AZURE_TENANT_ID;
  if (!tenantSubdomain?.trim() || !tenantId?.trim()) {
    return null;
  }

  return `https://${tenantSubdomain.trim()}.ciamlogin.com/${tenantId.trim()}`;
}

export function resolveNativeAuthProxyBaseUrl(): string | null {
  return (
    normalizeHttpsUrl(process.env.AUTH_NATIVE_AUTH_PROXY_BASE_URL) ??
    normalizeHttpsUrl(process.env.AZURE_CIAM_AUTHORITY) ??
    resolveFallbackCiamAuthority()
  );
}

function getAllowedOrigins(): Set<string> {
  return parseOriginAllowlist(
    process.env.AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGINS
  );
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

function normalizePath(pathValue: string | undefined): string | null {
  if (typeof pathValue !== "string") {
    return null;
  }

  const trimmed = pathValue.trim();
  if (!trimmed) {
    return null;
  }

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }

  const segments = decoded
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const isSafeSegment = /^[A-Za-z0-9._~-]+$/;
  if (segments.some((segment) => segment === "." || segment === ".." || !isSafeSegment.test(segment))) {
    return null;
  }

  return segments.join("/");
}

function resolveAllowedNativeAuthPath(pathValue: string | undefined): string | null {
  const normalizedPath = normalizePath(pathValue);
  if (!normalizedPath) {
    return null;
  }

  switch (normalizedPath) {
    case "oauth/v2.0/initiate":
      return "oauth/v2.0/initiate";
    case "oauth/v2.0/challenge":
      return "oauth/v2.0/challenge";
    case "oauth/v2.0/token":
      return "oauth/v2.0/token";
    case "oauth/v2.0/introspect":
      return "oauth/v2.0/introspect";
    case "oauth2/v2.0/token":
      return "oauth2/v2.0/token";
    case "challenge/v1.0/continue":
      return "challenge/v1.0/continue";
    case "signup/v1.0/start":
      return "signup/v1.0/start";
    case "signup/v1.0/challenge":
      return "signup/v1.0/challenge";
    case "signup/v1.0/continue":
      return "signup/v1.0/continue";
    case "resetpassword/v1.0/challenge":
      return "resetpassword/v1.0/challenge";
    case "resetpassword/v1.0/start":
      return "resetpassword/v1.0/start";
    case "resetpassword/v1.0/continue":
      return "resetpassword/v1.0/continue";
    case "resetpassword/v1.0/poll_completion":
      return "resetpassword/v1.0/poll_completion";
    case "resetpassword/v1.0/submit":
      return "resetpassword/v1.0/submit";
    default:
      return null;
  }
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

const router = express.Router();

router.post("/*", async (req, res) => {
  if (!isAllowedOrigin(req.header("origin"))) {
    res.status(403).json({ error: "Origin is not allowed for native auth proxy requests." });
    return;
  }

  const upstreamBaseUrl = resolveNativeAuthProxyBaseUrl();
  if (!upstreamBaseUrl) {
    res.status(503).json({ error: "Native auth proxy is not configured." });
    return;
  }

  const wildcardPath = (req.params as Record<string, string | undefined>)["0"];
  const proxyPath = resolveAllowedNativeAuthPath(wildcardPath);
  if (!proxyPath) {
    res.status(400).json({ error: "Native auth proxy path is not allowed." });
    return;
  }

  const contentType = req.header("content-type");
  if (!isSupportedContentType(contentType)) {
    res.status(415).json({
      error: "Native auth proxy only supports application/json and application/x-www-form-urlencoded payloads.",
    });
    return;
  }

  const upstreamUrl = new URL(`${upstreamBaseUrl}/${proxyPath}`);
  const queryIndex = req.originalUrl.indexOf("?");
  if (queryIndex >= 0) {
    upstreamUrl.search = req.originalUrl.slice(queryIndex);
  }

  const init: RequestInit = {
    method: "POST",
    headers: getForwardHeaders(req),
  };

  if (hasRequestBody(req.body)) {
    init.body =
      typeof req.body === "string" || Buffer.isBuffer(req.body)
        ? req.body
        : JSON.stringify(req.body);
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, init);
    copyResponseHeaders(upstreamResponse.headers, res);

    const body = await upstreamResponse.text();
    res.status(upstreamResponse.status);

    if (!body) {
      res.end();
      return;
    }

    res.send(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream error";
    res.status(502).json({ error: `Native auth upstream request failed: ${message}` });
  }
});

export default router;
