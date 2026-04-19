export type SlackAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface SlackTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  teamId: string;
  teamName?: string;
  botUserId?: string;
}

export interface SlackCredential {
  id: string;
  userId: string;
  authMethod: SlackAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  teamId: string;
  teamName?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface SlackCredentialPublic {
  id: string;
  userId: string;
  authMethod: SlackAuthMethod;
  tokenMasked: string;
  scopes: string[];
  teamId: string;
  teamName?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface SlackConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  teamId?: string;
  authMethod?: SlackAuthMethod;
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
