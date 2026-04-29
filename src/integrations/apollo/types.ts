import {
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
} from "../shared/tier1Contract";

export type ApolloAuthMethod = "oauth2" | "api_key";

export type ConnectorErrorType = Tier1ConnectorErrorType;

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

export interface ApolloCredentialPublic extends Tier1ConnectionPublic<ApolloAuthMethod, {
  scopes: string[];
  accountId: string;
  accountLabel?: string;
}> {}

export interface ApolloConnectionHealth extends Tier1ConnectionHealth<ApolloAuthMethod, {
  accountId?: string;
}> {}

export class ConnectorError extends Tier1ConnectorError {
  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "ConnectorError";
  }
}
