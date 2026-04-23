import { HubSpotTokenSet, ConnectorError } from "./types";

const DEFAULT_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const DEFAULT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const DEFAULT_METADATA_URL = "https://api.hubapi.com/oauth/v1/access-tokens";
const MAX_RETRIES = 4;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ConnectorError("auth", `${name} is not configured`, 503);
  }
  return value;
}

function oauthAuthorizeUrl(): string {
  return (process.env.HUBSPOT_OAUTH_AUTHORIZE_URL ?? DEFAULT_AUTHORIZE_URL).replace(/\/$/, "");
}

function oauthTokenUrl(): string {
  return (process.env.HUBSPOT_OAUTH_TOKEN_URL ?? DEFAULT_TOKEN_URL).replace(/\/$/, "");
}

function oauthMetadataBaseUrl(): string {
  return (process.env.HUBSPOT_OAUTH_METADATA_URL ?? DEFAULT_METADATA_URL).replace(/\/$/, "");
}

function normalizeScopes(scope?: string | string[]): string[] {
  if (Array.isArray(scope)) {
    return scope.map((value) => value.trim()).filter(Boolean);
  }

  if (!scope) {
    return [];
  }

  return scope
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildHubSpotOAuthUrl(params: { state: string }): string {
  const clientId = requiredEnv("HUBSPOT_CLIENT_ID");
  const redirectUri = requiredEnv("HUBSPOT_REDIRECT_URI");
  const scopes = process.env.HUBSPOT_SCOPES
    ?? "crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.objects.deals.read crm.objects.deals.write";

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
  scopes?: string[];
  hub_id?: string | number;
}> {
  const response = await fetch(oauthTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: payload,
  });

  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    scopes?: string[];
    hub_id?: string | number;
    error?: string;
    error_description?: string;
    message?: string;
  };

  if (!response.ok || !body.access_token) {
    const message = body.error_description || body.error || body.message || response.statusText;
    throw new ConnectorError("auth", `HubSpot OAuth token exchange failed: ${message}`, 401);
  }

  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: body.expires_in,
    scope: body.scope,
    scopes: body.scopes,
    hub_id: body.hub_id,
  };
}

export async function fetchHubSpotAccessTokenMetadata(accessToken: string): Promise<{
  hubId: string;
  hubDomain?: string;
  scopes: string[];
}> {
  async function run(attempt = 0): Promise<{
    hubId: string;
    hubDomain?: string;
    scopes: string[];
  }> {
    try {
      const response = await fetch(`${oauthMetadataBaseUrl()}/${encodeURIComponent(accessToken)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const body = await response.json() as {
        hub_id?: string | number;
        hub_domain?: string;
        scopes?: string[];
        scope?: string;
        error?: string;
        message?: string;
      };

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "HubSpot token metadata lookup rate limited", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return run(attempt + 1);
      }

      if (!response.ok || body.hub_id == null) {
        const message = body.error || body.message || response.statusText;
        throw new ConnectorError("auth", `HubSpot token metadata lookup failed: ${message}`, 401);
      }

      return {
        hubId: String(body.hub_id),
        hubDomain: typeof body.hub_domain === "string" ? body.hub_domain : undefined,
        scopes: normalizeScopes(body.scopes ?? body.scope),
      };
    } catch (error) {
      if (error instanceof ConnectorError) {
        const retryable = error.type === "rate-limit" || error.type === "upstream" || error.type === "network";
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return run(attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return run(attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `HubSpot token metadata lookup failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  return run();
}

export async function exchangeCodeForTokens(params: { code: string }): Promise<HubSpotTokenSet> {
  const clientId = requiredEnv("HUBSPOT_CLIENT_ID");
  const clientSecret = requiredEnv("HUBSPOT_CLIENT_SECRET");
  const redirectUri = requiredEnv("HUBSPOT_REDIRECT_URI");

  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const token = await fetchToken(payload);
  const metadata = await fetchHubSpotAccessTokenMetadata(token.access_token);

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scopes: normalizeScopes(token.scopes ?? token.scope).length
      ? normalizeScopes(token.scopes ?? token.scope)
      : metadata.scopes,
    hubId: token.hub_id != null ? String(token.hub_id) : metadata.hubId,
    hubDomain: metadata.hubDomain,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<HubSpotTokenSet> {
  const clientId = requiredEnv("HUBSPOT_CLIENT_ID");
  const clientSecret = requiredEnv("HUBSPOT_CLIENT_SECRET");

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const token = await fetchToken(payload);
  const metadata = await fetchHubSpotAccessTokenMetadata(token.access_token);

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
      : undefined,
    scopes: normalizeScopes(token.scopes ?? token.scope).length
      ? normalizeScopes(token.scopes ?? token.scope)
      : metadata.scopes,
    hubId: token.hub_id != null ? String(token.hub_id) : metadata.hubId,
    hubDomain: metadata.hubDomain,
  };
}

export function parseHubSpotScopes(scope?: string | string[]): string[] {
  return normalizeScopes(scope);
}
