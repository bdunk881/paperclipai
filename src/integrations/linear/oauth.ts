import { LinearClient } from "./linearClient";
import { ConnectorError, LinearTokenSet } from "./types";

const LINEAR_OAUTH_BASE = "https://linear.app/oauth";

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

export function buildLinearOAuthUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const clientId = requiredEnv("LINEAR_CLIENT_ID");
  const redirectUri = requiredEnv("LINEAR_REDIRECT_URI");
  const scopes = process.env.LINEAR_SCOPES ?? "read,write";

  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${LINEAR_OAUTH_BASE}/authorize?${query.toString()}`;
}

async function fetchToken(payload: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}> {
  const response = await fetch(`${LINEAR_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    const message = body.error_description || body.error || response.statusText;
    throw new ConnectorError("auth", `Linear OAuth token exchange failed: ${message}`, 401);
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
    scope: body.scope,
  };
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
}): Promise<LinearTokenSet> {
  const clientId = requiredEnv("LINEAR_CLIENT_ID");
  const clientSecret = requiredEnv("LINEAR_CLIENT_SECRET");
  const redirectUri = requiredEnv("LINEAR_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const client = new LinearClient(token.access_token);
  const viewer = await client.viewer();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scope: token.scope,
    organizationId: viewer.organizationId,
    organizationName: viewer.organizationName,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<LinearTokenSet> {
  const clientId = requiredEnv("LINEAR_CLIENT_ID");
  const clientSecret = requiredEnv("LINEAR_CLIENT_SECRET");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const client = new LinearClient(token.access_token);
  const viewer = await client.viewer();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scope: token.scope,
    organizationId: viewer.organizationId,
    organizationName: viewer.organizationName,
  };
}

export function parseLinearScopes(scope?: string): string[] {
  return normalizeScopes(scope);
}
