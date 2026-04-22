import { ConnectorError } from "./types";
import { SlackTokenSet } from "./types";

const SLACK_OAUTH_BASE = "https://slack.com/oauth/v2";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ConnectorError("auth", `${name} is not configured`, 503);
  }
  return value;
}

function parseScope(scope?: string): string[] {
  if (!scope) return [];
  return scope
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildSlackOAuthUrl(params: {
  state: string;
  codeChallenge: string;
  userScopes?: string[];
}): string {
  const clientId = requiredEnv("SLACK_CLIENT_ID");
  const redirectUri = requiredEnv("SLACK_REDIRECT_URI");
  const botScopes = process.env.SLACK_SCOPES ?? "channels:read,chat:write,groups:read,channels:history,groups:history";

  const query = new URLSearchParams({
    client_id: clientId,
    scope: botScopes,
    state: params.state,
    redirect_uri: redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    user_scope: (params.userScopes ?? []).join(","),
  });

  return `${SLACK_OAUTH_BASE}/authorize?${query.toString()}`;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
}): Promise<SlackTokenSet> {
  const clientId = requiredEnv("SLACK_CLIENT_ID");
  const clientSecret = requiredEnv("SLACK_CLIENT_SECRET");
  const redirectUri = requiredEnv("SLACK_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(`${SLACK_OAUTH_BASE}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const body = await response.json() as any;

  if (!response.ok || !body.ok) {
    throw new ConnectorError(
      "auth",
      `Slack OAuth exchange failed: ${body.error ?? response.statusText}`,
      401
    );
  }

  const authedUserScope = parseScope(body.authed_user?.scope);
  const botScope = parseScope(body.scope);

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in
      ? new Date(Date.now() + Number(body.expires_in) * 1000).toISOString()
      : undefined,
    scope: [...new Set([...authedUserScope, ...botScope])].join(","),
    teamId: body.team?.id,
    teamName: body.team?.name,
    botUserId: body.bot_user_id,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<SlackTokenSet> {
  const clientId = requiredEnv("SLACK_CLIENT_ID");
  const clientSecret = requiredEnv("SLACK_CLIENT_SECRET");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`${SLACK_OAUTH_BASE}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const body = await response.json() as any;
  if (!response.ok || !body.ok) {
    throw new ConnectorError(
      "auth",
      `Slack token refresh failed: ${body.error ?? response.statusText}`,
      401
    );
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresAt: body.expires_in
      ? new Date(Date.now() + Number(body.expires_in) * 1000).toISOString()
      : undefined,
    scope: body.scope,
    teamId: body.team?.id,
    teamName: body.team?.name,
    botUserId: body.bot_user_id,
  };
}
