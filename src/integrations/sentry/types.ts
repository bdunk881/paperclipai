export type SentryAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

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

export interface SentryCredentialPublic {
  id: string;
  userId: string;
  authMethod: SentryAuthMethod;
  tokenMasked: string;
  scopes: string[];
  organizationId: string;
  organizationSlug: string;
  organizationName?: string;
  createdAt: string;
  revokedAt?: string;
}

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

export interface SentryConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  organizationId?: string;
  organizationSlug?: string;
  authMethod?: SentryAuthMethod;
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
