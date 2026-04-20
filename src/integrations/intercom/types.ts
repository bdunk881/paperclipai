export type IntercomAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface IntercomTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  workspaceId: string;
  workspaceName?: string;
}

export interface IntercomCredential {
  id: string;
  userId: string;
  authMethod: IntercomAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  workspaceId: string;
  workspaceName?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface IntercomCredentialPublic {
  id: string;
  userId: string;
  authMethod: IntercomAuthMethod;
  tokenMasked: string;
  scopes: string[];
  workspaceId: string;
  workspaceName?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface IntercomConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  workspaceId?: string;
  authMethod?: IntercomAuthMethod;
  tokenRefreshStatus?: "not_applicable" | "healthy" | "failed";
  details: {
    auth: boolean;
    apiReachable: boolean;
    rateLimited: boolean;
    errorType?: ConnectorErrorType;
    message?: string;
  };
}

export interface IntercomContact {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  createdAt?: string;
}

export interface IntercomConversation {
  id: string;
  title?: string;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
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
