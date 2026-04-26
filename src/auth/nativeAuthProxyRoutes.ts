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
    if (!isAllowedOrigin(req.header("origin"))) {
      res.status(403).json({ error: "Origin is not allowed for native auth proxy requests." });
      return;
    }

    const upstreamBaseUrl = resolveNativeAuthProxyBaseUrl();
    if (!upstreamBaseUrl) {
      res.status(503).json({ error: "Native auth proxy is not configured." });
      return;
    }

    const contentType = req.header("content-type");
    if (!isSupportedContentType(contentType)) {
      res.status(415).json({
        error: "Native auth proxy only supports application/json and application/x-www-form-urlencoded payloads.",
      });
      return;
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

    const upstreamBaseUrls = resolveNativeAuthProxyBaseUrls();
    const queryIndex = req.originalUrl.indexOf("?");
    let lastError: Error | null = null;

    for (const upstreamBase of upstreamBaseUrls) {
      const upstreamUrl = new URL(`${upstreamBase}/${proxyPath}`);
      if (queryIndex >= 0) {
        upstreamUrl.search = req.originalUrl.slice(queryIndex);
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
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown upstream error");
        console.warn(
          `[auth] Native auth upstream fetch failed for ${upstreamUrl.origin}: ${lastError.message}`
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
