export type AgentCatalogProvider = "google" | "github" | "notion";

export const AGENT_CATALOG_PROVIDERS: AgentCatalogProvider[] = ["google", "github", "notion"];

export type ConnectorErrorType = "auth" | "rate-limit" | "schema" | "network" | "upstream";

export class AgentCatalogConnectorError extends Error {
  constructor(
    public readonly type: ConnectorErrorType,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "AgentCatalogConnectorError";
  }
}

export interface AgentCatalogConnection {
  id: string;
  userId: string;
  provider: AgentCatalogProvider;
  authMethod: "oauth2_pkce" | "api_key";
  accountLabel: string;
  tokenMasked: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface AgentCatalogConnectionPublic {
  id: string;
  userId: string;
  provider: AgentCatalogProvider;
  authMethod: "oauth2_pkce" | "api_key";
  accountLabel: string;
  tokenMasked: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}
