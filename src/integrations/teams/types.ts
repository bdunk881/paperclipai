import {
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
} from "../shared/tier1Contract";

export type TeamsAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType = Tier1ConnectorErrorType;

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

export interface TeamsCredentialPublic extends Tier1ConnectionPublic<TeamsAuthMethod, {
  scopes: string[];
  tenantId?: string;
  accountId?: string;
  accountName?: string;
}> {}

export interface TeamsConnectionHealth extends Tier1ConnectionHealth<TeamsAuthMethod> {}

export class ConnectorError extends Tier1ConnectorError {
  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "ConnectorError";
  }
}
