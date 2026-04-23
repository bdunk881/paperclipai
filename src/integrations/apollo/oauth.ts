import { ApolloClient } from "./apolloClient";
import { ApolloTokenSet, ConnectorError } from "./types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ConnectorError("auth", `${name} is not configured`, 503);
  }
  return value;
}

function oauthAuthorizeUrl(): string {
  return (process.env.APOLLO_OAUTH_AUTHORIZE_URL ?? "https://app.apollo.io/#/oauth/authorize").replace(/\/$/, "");
}

function oauthTokenUrl(): string {
  return (process.env.APOLLO_OAUTH_TOKEN_URL ?? "https://app.apollo.io/api/v1/oauth/token").replace(/\/$/, "");
}

function normalizeScopes(scope?: string): string[] {
  if (!scope) return [];
  return scope
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildApolloOAuthUrl(params: { state: string }): string {
  const clientId = requiredEnv("APOLLO_CLIENT_ID");
  const redirectUri = requiredEnv("APOLLO_REDIRECT_URI");
  const scopes = process.env.APOLLO_SCOPES ?? "read_user_profile";

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    state: params.state,
  });

  return `${oauthAuthorizeUrl()}?${query.toString()}`;
}

async function fetchToken(payload: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}> {
  const response = await fetch(oauthTokenUrl(), {
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
    throw new ConnectorError("auth", `Apollo OAuth token exchange failed: ${message}`, 401);
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
    scope: body.scope,
  };
}

export async function exchangeCodeForTokens(params: { code: string }): Promise<ApolloTokenSet> {
  const clientId = requiredEnv("APOLLO_CLIENT_ID");
  const clientSecret = requiredEnv("APOLLO_CLIENT_SECRET");
  const redirectUri = requiredEnv("APOLLO_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const token = await fetchToken(payload);
  const client = new ApolloClient(token.access_token, "oauth2");
  const viewer = await client.viewer();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scope: token.scope,
    accountId: viewer.accountId,
    accountLabel: viewer.accountLabel,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<ApolloTokenSet> {
  const clientId = requiredEnv("APOLLO_CLIENT_ID");
  const clientSecret = requiredEnv("APOLLO_CLIENT_SECRET");
  const redirectUri = requiredEnv("APOLLO_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const token = await fetchToken(payload);
  const client = new ApolloClient(token.access_token, "oauth2");
  const viewer = await client.viewer();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scope: token.scope,
    accountId: viewer.accountId,
    accountLabel: viewer.accountLabel,
  };
}

export function parseApolloScopes(scope?: string): string[] {
  return normalizeScopes(scope);
}
