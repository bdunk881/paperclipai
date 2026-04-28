import {
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
} from "../shared/tier1Contract";

export type LinearAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType = Tier1ConnectorErrorType;

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

export interface LinearCredentialPublic extends Tier1ConnectionPublic<LinearAuthMethod, {
  scopes: string[];
  organizationId: string;
  organizationName?: string;
}> {}

export interface LinearConnectionHealth extends Tier1ConnectionHealth<LinearAuthMethod, {
  organizationId?: string;
}> {}

export class ConnectorError extends Tier1ConnectorError {
  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "ConnectorError";
  }
}
