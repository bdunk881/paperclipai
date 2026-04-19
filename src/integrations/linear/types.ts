export type LinearAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface LinearTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  organizationId: string;
  organizationName?: string;
}

export interface LinearCredential {
  id: string;
  userId: string;
  authMethod: LinearAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  organizationId: string;
  organizationName?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface LinearCredentialPublic {
  id: string;
  userId: string;
  authMethod: LinearAuthMethod;
  tokenMasked: string;
  scopes: string[];
  organizationId: string;
  organizationName?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface LinearConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  organizationId?: string;
  authMethod?: LinearAuthMethod;
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
