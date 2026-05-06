type Env = {
  AZURE_CIAM_TENANT_SUBDOMAIN?: string;
  AZURE_TENANT_SUBDOMAIN?: string;
  AZURE_CIAM_TENANT_ID?: string;
  AZURE_TENANT_ID?: string;
};

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

export const onRequestPost = async (context: {
  env: Env;
  params: { path?: string[] | string };
  request: Request;
}): Promise<Response> => {
  const correlationId =
    context.request.headers.get("x-correlation-id") ??
    context.request.headers.get("x-ms-correlation-id") ??
    crypto.randomUUID();
  const origin = context.request.headers.get("origin") ?? undefined;
  const rawPath = context.params.path;
  const proxyPath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;

  if (!proxyPath || !ALLOWED_PATHS.has(proxyPath)) {
    logNativeAuth("REJECTED", { correlationId, origin, path: proxyPath, reason: "path_not_allowed" }, "warn");
    return json({ error: "Native auth proxy path is not allowed." }, 400);
  }

  const body = (await context.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
    logNativeAuth("REJECTED", { correlationId, origin, path: proxyPath, reason: "missing_body" }, "warn");
    return json({ error: "Request body is required." }, 400);
  }

  const authority = getCiamAuthority(context.env);
  const upstreamUrl = `${authority}/${proxyPath}`;
  const formBody = serializeFormBody(body);

  logNativeAuth("REQUEST", {
    body: sanitizeBodyForLogging(body),
    correlationId,
    origin,
    path: proxyPath,
    upstreamUrl,
  });

  try {
    const startedAt = Date.now();
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-correlation-id": correlationId,
      },
      body: formBody,
    });

    const responseText = await upstreamRes.text();
    const { error, errorDescription } = parseUpstreamErrorDetails(responseText);

    logNativeAuth("RESPONSE", {
      correlationId,
      elapsedMs: Date.now() - startedAt,
      error,
      errorDescription,
      path: proxyPath,
      status: upstreamRes.status,
      xMsCorrelationId: upstreamRes.headers.get("x-ms-correlation-id") ?? undefined,
      xMsRequestId: upstreamRes.headers.get("x-ms-request-id") ?? undefined,
    });

    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstreamRes.headers.get("Content-Type") ?? "application/json",
    });
    const cacheControl = upstreamRes.headers.get("Cache-Control");
    if (cacheControl) headers.set("Cache-Control", cacheControl);

    return new Response(responseText, {
      status: upstreamRes.status,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logNativeAuth("UPSTREAM_ERROR", { correlationId, error: message, path: proxyPath, upstreamUrl }, "warn");
    return json({ error: `CIAM upstream request failed: ${message}` }, 502);
  }
};

function getCiamAuthority(env: Env): string {
  const subdomain =
    env.AZURE_CIAM_TENANT_SUBDOMAIN?.trim() ||
    env.AZURE_TENANT_SUBDOMAIN?.trim() ||
    DEFAULT_CIAM_TENANT_SUBDOMAIN;
  const tenantId = env.AZURE_CIAM_TENANT_ID?.trim() || env.AZURE_TENANT_ID?.trim();
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

function parseUpstreamErrorDetails(body: string): { error?: string; errorDescription?: string } {
  if (!body) return {};
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

function formatLogValue(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function logNativeAuth(
  event: "REQUEST" | "RESPONSE" | "REJECTED" | "UPSTREAM_ERROR",
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

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
