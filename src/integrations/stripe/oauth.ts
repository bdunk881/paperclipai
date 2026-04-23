import { StripeConnectorClient } from "./stripeClient";
import { ConnectorError, StripeTokenSet } from "./types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ConnectorError("auth", `${name} is not configured`, 503);
  }
  return value;
}

function oauthAuthorizeUrl(): string {
  return (process.env.STRIPE_OAUTH_AUTHORIZE_URL ?? "https://connect.stripe.com/oauth/authorize").replace(/\/$/, "");
}

function oauthTokenUrl(): string {
  return (process.env.STRIPE_OAUTH_TOKEN_URL ?? "https://connect.stripe.com/oauth/token").replace(/\/$/, "");
}

function normalizeScopes(scope?: string): string[] {
  if (!scope) {
    return [];
  }

  return scope
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function buildStripeOAuthUrl(params: { state: string }): string {
  const clientId = requiredEnv("STRIPE_CLIENT_ID");
  const redirectUri = requiredEnv("STRIPE_REDIRECT_URI");
  const scope = process.env.STRIPE_OAUTH_SCOPE ?? "read_write";

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state: params.state,
  });

  return `${oauthAuthorizeUrl()}?${query.toString()}`;
}

async function fetchToken(payload: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  scope?: string;
  stripe_user_id: string;
  livemode?: boolean;
}> {
  const response = await fetch(oauthTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    stripe_user_id?: string;
    livemode?: boolean;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token || !body.stripe_user_id) {
    const message = body.error_description || body.error || response.statusText;
    throw new ConnectorError("auth", `Stripe OAuth token exchange failed: ${message}`, 401);
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    scope: body.scope,
    stripe_user_id: body.stripe_user_id,
    livemode: body.livemode,
  };
}

export async function exchangeCodeForTokens(params: { code: string }): Promise<StripeTokenSet> {
  const clientId = requiredEnv("STRIPE_CLIENT_ID");
  const clientSecret = requiredEnv("STRIPE_CLIENT_SECRET");
  const redirectUri = requiredEnv("STRIPE_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const token = await fetchToken(payload);
  const client = new StripeConnectorClient(token.access_token, "oauth2");
  const account = await client.viewer();
  const accountId = token.stripe_user_id;

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scope: token.scope,
    scopes: parseStripeScopes(token.scope),
    accountId,
    accountName: account.accountName,
    accountEmail: account.accountEmail,
    livemode: typeof token.livemode === "boolean" ? token.livemode : account.livemode,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<StripeTokenSet> {
  const clientId = requiredEnv("STRIPE_CLIENT_ID");
  const clientSecret = requiredEnv("STRIPE_CLIENT_SECRET");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const client = new StripeConnectorClient(token.access_token, "oauth2");
  const account = await client.viewer();
  const accountId = token.stripe_user_id;

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    scope: token.scope,
    scopes: parseStripeScopes(token.scope),
    accountId,
    accountName: account.accountName,
    accountEmail: account.accountEmail,
    livemode: typeof token.livemode === "boolean" ? token.livemode : account.livemode,
  };
}

export function parseStripeScopes(scope?: string): string[] {
  return normalizeScopes(scope);
}
