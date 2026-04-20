export type ShopifyAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface ShopifyTokenSet {
  accessToken: string;
  scope?: string;
  shopDomain: string;
}

export interface ShopifyCredential {
  id: string;
  userId: string;
  authMethod: ShopifyAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  scopes: string[];
  shopDomain: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface ShopifyCredentialPublic {
  id: string;
  userId: string;
  authMethod: ShopifyAuthMethod;
  tokenMasked: string;
  scopes: string[];
  shopDomain: string;
  createdAt: string;
  revokedAt?: string;
}

export interface ShopifyConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  shopDomain?: string;
  authMethod?: ShopifyAuthMethod;
  tokenRefreshStatus?: "not_applicable" | "healthy" | "failed";
  details: {
    auth: boolean;
    apiReachable: boolean;
    rateLimited: boolean;
    errorType?: ConnectorErrorType;
    message?: string;
  };
}

export class ConnectorError extends Error {
  readonly type: ConnectorErrorType;
  readonly statusCode: number;

  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(message);
    this.name = "ConnectorError";
    this.type = type;
    this.statusCode = statusCode;
  }
}
