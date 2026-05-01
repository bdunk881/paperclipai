import {
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
} from "../shared/tier1Contract";

export type SentryAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType = Tier1ConnectorErrorType;

export interface SentryTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  organizationId: string;
  organizationSlug: string;
  organizationName?: string;
}

export interface SentryCredential {
  id: string;
  userId: string;
  authMethod: SentryAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  organizationId: string;
  organizationSlug: string;
  organizationName?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface SentryCredentialPublic extends Tier1ConnectionPublic<SentryAuthMethod, {
  scopes: string[];
  organizationId: string;
  organizationSlug: string;
  organizationName?: string;
}> {}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform?: string;
  dateCreated?: string;
}

export interface SentryIssue {
  id: string;
  shortId?: string;
  title: string;
  status?: string;
  level?: string;
  culprit?: string;
  permalink?: string;
}

export interface SentryConnectionHealth extends Tier1ConnectionHealth<SentryAuthMethod, {
  organizationId?: string;
  organizationSlug?: string;
}> {}

export class ConnectorError extends Tier1ConnectorError {
  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "ConnectorError";
  }
}
