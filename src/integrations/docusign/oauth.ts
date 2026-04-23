import { ConnectorError, DocuSignTokenSet } from "./types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ConnectorError("auth", `${name} is not configured`, 503);
  }
  return value;
}

function oauthBaseUrl(): string {
  const raw = process.env.DOCUSIGN_OAUTH_BASE_URL ?? "https://account-d.docusign.com/oauth";
  return raw.trim().replace(/\/$/, "");
}

function normalizeBaseUri(baseUri: string): string {
  return baseUri
    .trim()
    .replace(/\/$/, "")
    .replace(/\/restapi$/i, "");
}

function parseScopes(scope?: string): string[] {
  if (!scope) return [];
  return scope
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function resolveDefaultAccount(accessToken: string): Promise<{
  accountId: string;
  accountName?: string;
  baseUri: string;
}> {
  const response = await fetch(`${oauthBaseUrl()}/userinfo`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const body = await response.json() as any;
  if (!response.ok) {
    throw new ConnectorError(
      "upstream",
      `DocuSign userinfo failed: ${body.error_description ?? body.error ?? response.statusText}`,
      response.status
    );
  }

  const accounts = Array.isArray(body.accounts) ? body.accounts : [];
  const preferred = accounts.find((account: any) => account.is_default) ?? accounts[0];

  const accountId = typeof preferred?.account_id === "string" ? preferred.account_id : "";
  const baseUri = typeof preferred?.base_uri === "string" ? preferred.base_uri : "";

  if (!accountId || !baseUri) {
    throw new ConnectorError("schema", "DocuSign OAuth userinfo did not include an account context", 502);
  }

  return {
    accountId,
    accountName: typeof preferred?.account_name === "string" ? preferred.account_name : undefined,
    baseUri: normalizeBaseUri(baseUri),
  };
}

export function buildDocuSignOAuthUrl(params: {
  state: string;
  codeChallenge: string;
}): string {
  const clientId = requiredEnv("DOCUSIGN_CLIENT_ID");
  const redirectUri = requiredEnv("DOCUSIGN_REDIRECT_URI");
  const scopes = process.env.DOCUSIGN_SCOPES ?? "signature extended offline_access";

  const query = new URLSearchParams({
    response_type: "code",
    scope: scopes,
    client_id: clientId,
    redirect_uri: redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${oauthBaseUrl()}/auth?${query.toString()}`;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
}): Promise<DocuSignTokenSet> {
  const clientId = requiredEnv("DOCUSIGN_CLIENT_ID");
  const clientSecret = requiredEnv("DOCUSIGN_CLIENT_SECRET");
  const redirectUri = requiredEnv("DOCUSIGN_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(`${oauthBaseUrl()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const body = await response.json() as any;
  if (!response.ok || !body.access_token) {
    throw new ConnectorError(
      "auth",
      `DocuSign OAuth exchange failed: ${body.error_description ?? body.error ?? response.statusText}`,
      401
    );
  }

  const account = await resolveDefaultAccount(body.access_token);

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in
      ? new Date(Date.now() + Number(body.expires_in) * 1000).toISOString()
      : undefined,
    scope: parseScopes(body.scope).join(" "),
    accountId: account.accountId,
    accountName: account.accountName,
    baseUri: account.baseUri,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<DocuSignTokenSet> {
  const clientId = requiredEnv("DOCUSIGN_CLIENT_ID");
  const clientSecret = requiredEnv("DOCUSIGN_CLIENT_SECRET");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`${oauthBaseUrl()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  const body = await response.json() as any;
  if (!response.ok || !body.access_token) {
    throw new ConnectorError(
      "auth",
      `DocuSign token refresh failed: ${body.error_description ?? body.error ?? response.statusText}`,
      401
    );
  }

  const account = await resolveDefaultAccount(body.access_token);

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresAt: body.expires_in
      ? new Date(Date.now() + Number(body.expires_in) * 1000).toISOString()
      : undefined,
    scope: parseScopes(body.scope).join(" "),
    accountId: account.accountId,
    accountName: account.accountName,
    baseUri: account.baseUri,
  };
}

export function parseScopeSet(scope?: string): string[] {
  return parseScopes(scope);
}
