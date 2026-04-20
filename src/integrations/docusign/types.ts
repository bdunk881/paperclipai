export type DocuSignAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface DocuSignTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  accountId: string;
  accountName?: string;
  baseUri: string;
}

export interface DocuSignCredential {
  id: string;
  userId: string;
  authMethod: DocuSignAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  accountId: string;
  accountName?: string;
  baseUri: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface DocuSignCredentialPublic {
  id: string;
  userId: string;
  authMethod: DocuSignAuthMethod;
  tokenMasked: string;
  scopes: string[];
  accountId: string;
  accountName?: string;
  baseUri: string;
  createdAt: string;
  revokedAt?: string;
}

export interface DocuSignConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  accountId?: string;
  authMethod?: DocuSignAuthMethod;
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
