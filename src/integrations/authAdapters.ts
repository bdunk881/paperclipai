/**
 * Auth Adapters — build HTTP auth headers and manage OAuth2 token flows.
 *
 * Supported auth kinds:
 *   none                      — no auth headers added
 *   api_key                   — custom header (e.g. X-API-Key)
 *   bearer                    — Authorization: Bearer <token>
 *   basic                     — Authorization: Basic <base64(user:pass)>
 *   oauth2_pkce               — Authorization Code + PKCE flow
 *   oauth2_client_credentials — Client Credentials flow (server-to-server)
 */

import { randomBytes, createHash } from "crypto";
import {
  AuthKind,
  IntegrationCredentials,
  IntegrationManifest,
  OAuth2Config,
} from "./integrationManifest";

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/** Generate a cryptographically random PKCE code verifier (43–128 chars). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Derive the code challenge from a verifier using S256. */
export function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ---------------------------------------------------------------------------
// In-memory PKCE state store (keyed by state param)
// ---------------------------------------------------------------------------

interface PkceState {
  integrationSlug: string;
  userId: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

const pkceStateMap = new Map<string, PkceState>();

/** Purge PKCE state entries older than 10 minutes. */
function purgeStalePkceState(): void {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of pkceStateMap.entries()) {
    if (value.createdAt < cutoff) pkceStateMap.delete(key);
  }
}

/** Begin an OAuth2 PKCE flow — returns the authorization redirect URL and stores state. */
export function beginOAuth2PkceFlow(params: {
  manifest: IntegrationManifest;
  userId: string;
  redirectUri: string;
  clientId: string;
  instanceDomain?: string;
}): { authorizationUrl: string; state: string } {
  const { manifest, userId, redirectUri, clientId, instanceDomain } = params;
  const oauth2 = manifest.oauth2Config;
  if (!oauth2) throw new Error(`Integration "${manifest.slug}" does not support OAuth2`);

  purgeStalePkceState();

  const state = randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);

  pkceStateMap.set(state, {
    integrationSlug: manifest.slug,
    userId,
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  });

  const authUrl = resolveUrlTemplate(oauth2.authorizationUrl, instanceDomain);

  const params2 = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: oauth2.scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return { authorizationUrl: `${authUrl}?${params2.toString()}`, state };
}

/** Complete an OAuth2 PKCE flow — exchange the authorization code for tokens. */
export async function completeOAuth2PkceFlow(params: {
  code: string;
  state: string;
  oauth2Config: OAuth2Config;
  clientId: string;
  clientSecret?: string;
  instanceDomain?: string;
}): Promise<IntegrationCredentials> {
  const { code, state, oauth2Config, clientId, clientSecret, instanceDomain } = params;

  const saved = pkceStateMap.get(state);
  if (!saved) throw new Error("OAuth2 state not found or expired — please restart the auth flow");

  pkceStateMap.delete(state);

  const tokenUrl = resolveUrlTemplate(oauth2Config.tokenUrl, instanceDomain);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: saved.redirectUri,
    client_id: clientId,
    code_verifier: saved.codeVerifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (HTTP ${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  const credentials: IntegrationCredentials = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    clientId,
    clientSecret,
    instanceDomain,
  };

  if (json.expires_in) {
    const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
    credentials.accessTokenExpiresAt = expiresAt;
  }

  return credentials;
}

/** Refresh an OAuth2 access token using the stored refresh token. */
export async function refreshOAuth2Token(params: {
  oauth2Config: OAuth2Config;
  credentials: IntegrationCredentials;
  instanceDomain?: string;
}): Promise<IntegrationCredentials> {
  const { oauth2Config, credentials, instanceDomain } = params;

  if (!credentials.refreshToken) {
    throw new Error("No refresh token available — user must re-authenticate");
  }
  if (!credentials.clientId) {
    throw new Error("clientId is required for token refresh");
  }

  const tokenUrl = resolveUrlTemplate(oauth2Config.tokenUrl, instanceDomain);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId,
  });
  if (credentials.clientSecret) body.set("client_secret", credentials.clientSecret);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (HTTP ${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const updated: IntegrationCredentials = {
    ...credentials,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? credentials.refreshToken,
  };

  if (json.expires_in) {
    updated.accessTokenExpiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  }

  return updated;
}

/** Fetch a client-credentials access token (server-to-server). */
export async function fetchClientCredentialsToken(params: {
  oauth2Config: OAuth2Config;
  clientId: string;
  clientSecret: string;
  instanceDomain?: string;
}): Promise<IntegrationCredentials> {
  const { oauth2Config, clientId, clientSecret, instanceDomain } = params;

  const tokenUrl = resolveUrlTemplate(oauth2Config.tokenUrl, instanceDomain);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: oauth2Config.scopes.join(" "),
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Client credentials token fetch failed (HTTP ${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  const credentials: IntegrationCredentials = {
    accessToken: json.access_token,
    clientId,
    clientSecret,
    instanceDomain,
  };

  if (json.expires_in) {
    credentials.accessTokenExpiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  }

  return credentials;
}

// ---------------------------------------------------------------------------
// Token expiry check
// ---------------------------------------------------------------------------

/** Returns true if the stored access token has expired (or will expire in <60 s). */
export function isTokenExpired(credentials: IntegrationCredentials): boolean {
  if (!credentials.accessTokenExpiresAt) return false;
  const expiresAt = new Date(credentials.accessTokenExpiresAt).getTime();
  return Date.now() >= expiresAt - 60_000;
}

// ---------------------------------------------------------------------------
// Header builder
// ---------------------------------------------------------------------------

/**
 * Build the HTTP headers required to authenticate a request for this integration.
 * Called by the action executor before every outbound REST call.
 */
export function buildAuthHeaders(
  authKind: AuthKind,
  credentials: IntegrationCredentials,
  authHeaderKey?: string
): Record<string, string> {
  switch (authKind) {
    case "none":
      return {};

    case "api_key": {
      const key = credentials.token;
      if (!key) throw new Error("api_key auth requires credentials.token to be set");
      return { [authHeaderKey ?? "X-API-Key"]: key };
    }

    case "bearer": {
      const token = credentials.accessToken ?? credentials.token;
      if (!token) throw new Error("bearer auth requires credentials.token or credentials.accessToken");
      return { Authorization: `Bearer ${token}` };
    }

    case "basic": {
      if (!credentials.username || !credentials.password) {
        throw new Error("basic auth requires credentials.username and credentials.password");
      }
      const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }

    case "oauth2_pkce":
    case "oauth2_client_credentials": {
      const token = credentials.accessToken;
      if (!token) throw new Error("OAuth2 auth requires credentials.accessToken to be set");
      return { Authorization: `Bearer ${token}` };
    }

    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// URL template helpers
// ---------------------------------------------------------------------------

/** Replace {{instanceDomain}} placeholders in a URL template. */
export function resolveUrlTemplate(template: string, instanceDomain?: string): string {
  if (!instanceDomain) return template;
  return template.replace(/\{\{instanceDomain\}\}/g, instanceDomain);
}

/** Export the PKCE state map reference for testing. */
export { pkceStateMap };
