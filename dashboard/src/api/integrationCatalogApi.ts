import { getApiBasePath, getConfiguredApiOrigin } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

/**
 * One entry of the public integration catalog, as served by the backend
 * `GET /api/integrations/catalog` route (src/integrations/integrationRoutes.ts).
 *
 * The backend manifest is the single source of truth: it owns the verified
 * logo.dev domain and the honest per-integration OAuth / API-key capability
 * flags. The marketplace UI renders from this shape.
 */
export interface CatalogIntegration {
  slug: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  /** Verified logo.dev domain, e.g. "stripe.com". */
  logoDomain?: string;
  authKind: string;
  supportsOAuth: boolean;
  supportsApiKey: boolean;
  /** True when the integration's baseUrl needs an instance domain/subdomain. */
  requiresInstanceDomain: boolean;
  actionCount: number;
  triggerCount: number;
  verified: boolean;
  docsUrl?: string;
}

export interface IntegrationCatalogResponse {
  catalog: CatalogIntegration[];
  categories: string[];
  total: number;
}

/**
 * Fetch the integration catalog. The endpoint is public (no auth required),
 * so this takes no token.
 */
export async function fetchIntegrationCatalog(): Promise<IntegrationCatalogResponse> {
  const response = await trackedFetch(`${BASE}/integrations/catalog`);
  if (!response.ok) {
    throw new Error(`Failed to fetch integration catalog: ${response.status}`);
  }
  return (await response.json()) as IntegrationCatalogResponse;
}

// ---------------------------------------------------------------------------
// Generic catalog connections (api_key / bearer / basic + OAuth result)
// ---------------------------------------------------------------------------

/** Public view of a stored catalog connection (credentials omitted). */
export interface CatalogConnection {
  id: string;
  integrationSlug: string;
  label: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Credential payload for POST /connections — shape depends on authKind. */
export interface CatalogCredentials {
  /** api_key / bearer */
  token?: string;
  /** basic auth */
  username?: string;
  password?: string;
  /** multi-tenant services (Salesforce, ServiceNow, …) */
  instanceDomain?: string;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function listCatalogConnections(token: string): Promise<CatalogConnection[]> {
  const response = await trackedFetch(`${BASE}/integrations/connections`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to list connections: ${response.status}`);
  }
  const payload = (await response.json()) as { connections: CatalogConnection[] };
  return payload.connections ?? [];
}

export async function createCatalogConnection(
  token: string,
  body: { integrationSlug: string; label: string; credentials: CatalogCredentials },
): Promise<CatalogConnection> {
  const response = await trackedFetch(`${BASE}/integrations/connections`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to save connection (${response.status}): ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as CatalogConnection;
}

export async function deleteCatalogConnection(token: string, id: string): Promise<void> {
  const response = await trackedFetch(`${BASE}/integrations/connections/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to disconnect (${response.status})`);
  }
}

/**
 * Start a BYO-OAuth-app PKCE flow for a catalog integration. Returns the
 * provider authorization URL the browser should be redirected to. The backend
 * stores the client credentials in PKCE state, so they never travel on the
 * provider redirect.
 */
export async function startCatalogOAuth(
  token: string,
  slug: string,
  params: { clientId: string; clientSecret?: string; instanceDomain?: string },
): Promise<string> {
  const redirectUri = `${getConfiguredApiOrigin() || window.location.origin}/api/integrations/oauth2/${slug}/callback`;
  const query = new URLSearchParams({ clientId: params.clientId, redirectUri });
  if (params.clientSecret) query.set("clientSecret", params.clientSecret);
  if (params.instanceDomain) query.set("instanceDomain", params.instanceDomain);

  const response = await trackedFetch(
    `${BASE}/integrations/oauth2/${slug}/authorize?${query.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Couldn't start OAuth (${response.status}): ${detail.slice(0, 200)}`);
  }
  const payload = (await response.json()) as { authorizationUrl?: string };
  if (!payload.authorizationUrl) {
    throw new Error("No authorization URL returned");
  }
  return payload.authorizationUrl;
}
