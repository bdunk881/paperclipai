export type ApolloAuthMethod = "oauth2" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface ApolloTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  accountId: string;
  accountLabel?: string;
}

export interface ApolloCredential {
  id: string;
  userId: string;
  authMethod: ApolloAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  accountId: string;
  accountLabel?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface ApolloCredentialPublic {
  id: string;
  userId: string;
  authMethod: ApolloAuthMethod;
  tokenMasked: string;
  scopes: string[];
  accountId: string;
  accountLabel?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface ApolloConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  accountId?: string;
  authMethod?: ApolloAuthMethod;
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
