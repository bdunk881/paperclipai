import { getApiBasePath } from "./baseUrl";
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
