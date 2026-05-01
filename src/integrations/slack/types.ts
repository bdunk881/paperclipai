import {
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
} from "../shared/tier1Contract";

export type SlackAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType = Tier1ConnectorErrorType;

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

export interface SlackCredentialPublic extends Tier1ConnectionPublic<SlackAuthMethod, {
  scopes: string[];
  teamId: string;
  teamName?: string;
}> {}

export interface SlackConnectionHealth extends Tier1ConnectionHealth<SlackAuthMethod, {
  teamId?: string;
}> {}

export class ConnectorError extends Tier1ConnectorError {
  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "ConnectorError";
  }
}
