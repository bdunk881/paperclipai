type Env = {
  APP_JWT_AUDIENCE?: string;
  APP_JWT_EXPIRES_IN?: string;
  APP_JWT_ISSUER?: string;
  APP_JWT_SECRET?: string;
  CF_PAGES_BRANCH?: string;
  NODE_ENV?: string;
  QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW?: string;
  QA_PREVIEW_ACCESS_TOKEN?: string;
};

const QA_PREVIEW_USER = {
  id: "qa-smoke-user",
  email: "qa-preview@autoflow.local",
  name: "QA Preview User",
};

const DEFAULT_APP_JWT_AUDIENCE = "autoflow-api";
const DEFAULT_APP_JWT_ISSUER = "autoflow-app";
const DEFAULT_APP_JWT_EXPIRES_IN_SECONDS = 60 * 60;

export const onRequestPost = async (context: {
  env: Env;
  request: Request;
}): Promise<Response> => {
  const env = context.env;
  const branch = normalizeSecret(env.CF_PAGES_BRANCH);
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  const isProduction = !nodeEnv || nodeEnv === "production";
  const allowNonPreview =
    !isProduction && env.QA_PREVIEW_ACCESS_ALLOW_NON_PREVIEW === "true";

  if (branch === "master" || branch === "main") {
    return json({ error: "QA preview access is only enabled on preview deployments" }, 403);
  }
  if (!branch && !allowNonPreview) {
    return json({ error: "QA preview access is only enabled on preview deployments" }, 403);
  }

  const expectedToken = normalizeSecret(env.QA_PREVIEW_ACCESS_TOKEN);
  if (!expectedToken) {
    return json({ error: "QA preview access is not configured" }, 503);
  }

  const requestBody = (await context.request.json().catch(() => null)) as { token?: string } | null;
  const requestToken = normalizeSecret(requestBody?.token);
  if (!requestToken) {
    return json({ error: "token is required" }, 400);
  }
  if (!tokensMatch(requestToken, expectedToken)) {
    return json({ error: "invalid preview access token" }, 401);
  }

  try {
    const accessToken = await signQaPreviewToken(env, QA_PREVIEW_USER);
    return json({ accessToken, user: QA_PREVIEW_USER });
  } catch (error) {
    console.error("[qa-preview-access] failed to issue app token", error);
    return json({ error: "QA preview access is not fully configured" }, 503);
  }
};

async function signQaPreviewToken(env: Env, user: typeof QA_PREVIEW_USER): Promise<string> {
  const secret = normalizeSecret(env.APP_JWT_SECRET);
  if (!secret) {
    throw new Error("APP_JWT_SECRET is required");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      iss: env.APP_JWT_ISSUER?.trim() || DEFAULT_APP_JWT_ISSUER,
      aud: env.APP_JWT_AUDIENCE?.trim() || DEFAULT_APP_JWT_AUDIENCE,
      iat: now,
      exp: now + parseJwtExpirySeconds(env.APP_JWT_EXPIRES_IN),
    })
  );

  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const signature = base64UrlEncodeBytes(new Uint8Array(signatureBuffer));
  return `${data}.${signature}`;
}

function parseJwtExpirySeconds(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_APP_JWT_EXPIRES_IN_SECONDS;
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const match = normalized.match(/^(\d+)([smhd])$/i);
  if (!match) return DEFAULT_APP_JWT_EXPIRES_IN_SECONDS;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "s" ? 1 :
    unit === "m" ? 60 :
    unit === "h" ? 60 * 60 :
    60 * 60 * 24;
  return amount * multiplier;
}

function tokensMatch(candidate: string, expected: string): boolean {
  const candidateBytes = new TextEncoder().encode(candidate);
  const expectedBytes = new TextEncoder().encode(expected);
  if (candidateBytes.length !== expectedBytes.length) return false;

  let result = 0;
  for (let i = 0; i < candidateBytes.length; i += 1) {
    result |= candidateBytes[i] ^ expectedBytes[i];
  }
  return result === 0;
}

function normalizeSecret(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\\n/g, "\n");
  return trimmed ? trimmed : null;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
