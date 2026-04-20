import { TeamsClient } from "./teamsClient";
import { ConnectorError, TeamsTokenSet } from "./types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ConnectorError("auth", `${name} is not configured`, 503);
  }
  return value;
}

function getTenantId(): string {
  const tenant = process.env.TEAMS_TENANT_ID?.trim();
  return tenant && tenant.length > 0 ? tenant : "common";
}

function normalizeScopes(scope?: string): string[] {
  if (!scope) return [];
  return scope
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildTeamsOAuthUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const tenant = getTenantId();
  const clientId = requiredEnv("TEAMS_CLIENT_ID");
  const redirectUri = requiredEnv("TEAMS_REDIRECT_URI");
  const scopes = process.env.TEAMS_SCOPES
    ?? "openid profile offline_access User.Read Chat.Read ChannelMessage.Read.All";

  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${query.toString()}`;
}

async function fetchToken(payload: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}> {
  const tenant = getTenantId();
  const tokenEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const response = await fetch(tokenEndpoint, {
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
    throw new ConnectorError("auth", `Teams OAuth token exchange failed: ${message}`, 401);
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
}): Promise<TeamsTokenSet & { accountId?: string; accountName?: string }> {
  const clientId = requiredEnv("TEAMS_CLIENT_ID");
  const clientSecret = requiredEnv("TEAMS_CLIENT_SECRET");
  const redirectUri = requiredEnv("TEAMS_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const client = new TeamsClient(token.access_token);
  const me = await client.me();

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scope: token.scope,
    tenantId: getTenantId(),
    accountId: me.id,
    accountName: me.displayName ?? me.userPrincipalName,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<TeamsTokenSet> {
  const clientId = requiredEnv("TEAMS_CLIENT_ID");
  const clientSecret = requiredEnv("TEAMS_CLIENT_SECRET");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scope: token.scope,
    tenantId: getTenantId(),
  };
}

export function parseTeamsScopes(scope?: string): string[] {
  return normalizeScopes(scope);
}
