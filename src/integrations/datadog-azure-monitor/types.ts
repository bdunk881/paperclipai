export type MonitoringProvider = "datadog" | "azure_monitor";

export type MonitoringAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface AzureTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tenantId?: string;
}

export interface MonitoringCredential {
  id: string;
  userId: string;
  provider: MonitoringProvider;
  authMethod: MonitoringAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  site?: string;
  tenantId?: string;
  accountId?: string;
  accountName?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface MonitoringCredentialPublic {
  id: string;
  userId: string;
  provider: MonitoringProvider;
  authMethod: MonitoringAuthMethod;
  tokenMasked: string;
  scopes: string[];
  site?: string;
  tenantId?: string;
  accountId?: string;
  accountName?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface MonitoringConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  provider?: MonitoringProvider;
  authMethod?: MonitoringAuthMethod;
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
