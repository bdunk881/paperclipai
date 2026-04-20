export type TeamsAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface TeamsTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tenantId?: string;
}

export interface TeamsCredential {
  id: string;
  userId: string;
  authMethod: TeamsAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  tenantId?: string;
  accountId?: string;
  accountName?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface TeamsCredentialPublic {
  id: string;
  userId: string;
  authMethod: TeamsAuthMethod;
  tokenMasked: string;
  scopes: string[];
  tenantId?: string;
  accountId?: string;
  accountName?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface TeamsConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  authMethod?: TeamsAuthMethod;
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
