export type HubSpotAuthMethod = "oauth2" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface HubSpotTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes: string[];
  hubId: string;
  hubDomain?: string;
}

export interface HubSpotCredential {
  id: string;
  userId: string;
  authMethod: HubSpotAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  hubId: string;
  hubDomain?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface HubSpotCredentialPublic {
  id: string;
  userId: string;
  authMethod: HubSpotAuthMethod;
  tokenMasked: string;
  scopes: string[];
  hubId: string;
  hubDomain?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface HubSpotConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  hubId?: string;
  authMethod?: HubSpotAuthMethod;
  tokenRefreshStatus?: "not_applicable" | "healthy" | "failed";
  details: {
    auth: boolean;
    apiReachable: boolean;
    rateLimited: boolean;
    errorType?: ConnectorErrorType;
    message?: string;
  };
}

export interface HubSpotContact {
  id: string;
  email?: string;
  firstname?: string;
  lastname?: string;
  company?: string;
  phone?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

export interface HubSpotCompany {
  id: string;
  name?: string;
  domain?: string;
  industry?: string;
  phone?: string;
  city?: string;
  country?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

export interface HubSpotDeal {
  id: string;
  dealname?: string;
  amount?: string;
  dealstage?: string;
  pipeline?: string;
  closedate?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
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
