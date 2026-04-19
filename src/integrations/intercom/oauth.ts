import { IntercomClient } from "./intercomClient";
import { ConnectorError, IntercomTokenSet } from "./types";

const DEFAULT_AUTHORIZE_URL = "https://app.intercom.com/oauth";
const DEFAULT_TOKEN_BASE_URL = "https://api.intercom.io/auth/eagle";

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

function oauthAuthorizeUrlBase(): string {
  return (process.env.INTERCOM_OAUTH_AUTHORIZE_URL ?? DEFAULT_AUTHORIZE_URL).replace(/\/$/, "");
}

function oauthTokenBaseUrl(): string {
  return (process.env.INTERCOM_OAUTH_TOKEN_BASE_URL ?? DEFAULT_TOKEN_BASE_URL).replace(/\/$/, "");
}

export function buildIntercomOAuthUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const clientId = requiredEnv("INTERCOM_CLIENT_ID");
  const redirectUri = requiredEnv("INTERCOM_REDIRECT_URI");
  const scopes = process.env.INTERCOM_SCOPES ?? "read_conversations read_contacts write_contacts write_conversations";

  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${oauthAuthorizeUrlBase()}?${query.toString()}`;
}

async function fetchToken(payload: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}> {
  const response = await fetch(`${oauthTokenBaseUrl()}/token`, {
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
    message?: string;
  };

  if (!response.ok || !body.access_token) {
    const message = body.error_description || body.error || body.message || response.statusText;
    throw new ConnectorError("auth", `Intercom OAuth token exchange failed: ${message}`, 401);
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
}): Promise<IntercomTokenSet> {
  const clientId = requiredEnv("INTERCOM_CLIENT_ID");
  const clientSecret = requiredEnv("INTERCOM_CLIENT_SECRET");
  const redirectUri = requiredEnv("INTERCOM_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const client = new IntercomClient(token.access_token);
  const viewer = await client.viewer();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scope: token.scope,
    workspaceId: viewer.workspaceId,
    workspaceName: viewer.workspaceName,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<IntercomTokenSet> {
  const clientId = requiredEnv("INTERCOM_CLIENT_ID");
  const clientSecret = requiredEnv("INTERCOM_CLIENT_SECRET");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const client = new IntercomClient(token.access_token);
  const viewer = await client.viewer();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scope: token.scope,
    workspaceId: viewer.workspaceId,
    workspaceName: viewer.workspaceName,
  };
}

export function parseIntercomScopes(scope?: string): string[] {
  return normalizeScopes(scope);
}
