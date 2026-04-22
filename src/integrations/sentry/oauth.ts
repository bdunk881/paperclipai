import { SentryClient } from "./sentryClient";
import { ConnectorError, SentryTokenSet } from "./types";

const SENTRY_OAUTH_BASE = (process.env.SENTRY_OAUTH_BASE_URL ?? "https://sentry.io").replace(/\/$/, "");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ConnectorError("auth", `${name} is not configured`, 503);
  }
  return value;
}

function normalizeScopes(scope?: string): string[] {
  if (!scope) return [];
  return scope
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildSentryOAuthUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const clientId = requiredEnv("SENTRY_CLIENT_ID");
  const redirectUri = requiredEnv("SENTRY_REDIRECT_URI");
  const scopes = process.env.SENTRY_SCOPES ?? "org:read project:read event:read";

  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${SENTRY_OAUTH_BASE}/oauth/authorize/?${query.toString()}`;
}

async function fetchToken(payload: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: string;
  scope?: string;
}> {
  const response = await fetch(`${SENTRY_OAUTH_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    expires_at?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    const message = body.error_description || body.error || response.statusText;
    throw new ConnectorError("auth", `Sentry OAuth token exchange failed: ${message}`, 401);
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
    expires_at: body.expires_at,
    scope: body.scope,
  };
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
}): Promise<SentryTokenSet> {
  const clientId = requiredEnv("SENTRY_CLIENT_ID");
  const clientSecret = requiredEnv("SENTRY_CLIENT_SECRET");
  const redirectUri = requiredEnv("SENTRY_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const client = new SentryClient(token.access_token, "oauth2_pkce");
  const viewer = await client.viewer();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_at
      ?? (token.expires_in
        ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
        : undefined),
    scope: token.scope,
    organizationId: viewer.organizationId,
    organizationSlug: viewer.organizationSlug,
    organizationName: viewer.organizationName,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<SentryTokenSet> {
  const clientId = requiredEnv("SENTRY_CLIENT_ID");
  const clientSecret = requiredEnv("SENTRY_CLIENT_SECRET");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const client = new SentryClient(token.access_token, "oauth2_pkce");
  const viewer = await client.viewer();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: token.expires_at
      ?? (token.expires_in
        ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
        : undefined),
    scope: token.scope,
    organizationId: viewer.organizationId,
    organizationSlug: viewer.organizationSlug,
    organizationName: viewer.organizationName,
  };
}

export function parseSentryScopes(scope?: string): string[] {
  return normalizeScopes(scope);
}
