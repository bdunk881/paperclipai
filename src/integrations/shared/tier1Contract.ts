export const TIER1_SDK_SURFACES = [
  "slack",
  "hubspot",
  "stripe",
  "gmail",
  "linear",
  "sentry",
  "microsoft-teams",
  "jira-ticket-sync",
] as const;

export type Tier1SdkSurface = typeof TIER1_SDK_SURFACES[number];
export type Tier1ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";
export type Tier1HealthStatus = "ok" | "degraded" | "down";
export type Tier1TokenRefreshStatus = "not_applicable" | "healthy" | "failed";

export interface Tier1ConnectionHealthDetails<TErrorType extends string = Tier1ConnectorErrorType> {
  auth: boolean;
  apiReachable: boolean;
  rateLimited: boolean;
  errorType?: TErrorType;
  message?: string;
}

export type Tier1ConnectionHealth<
  TAuthMethod extends string = string,
  TMetadata extends Record<string, unknown> = {},
> = TMetadata & {
  status: Tier1HealthStatus;
  checkedAt: string;
  authMethod?: TAuthMethod;
  tokenRefreshStatus?: Tier1TokenRefreshStatus;
  details: Tier1ConnectionHealthDetails;
};

export type Tier1ConnectionPublic<
  TAuthMethod extends string = string,
  TMetadata extends Record<string, unknown> = {},
> = TMetadata & {
  id: string;
  userId: string;
  authMethod: TAuthMethod;
  tokenMasked: string;
  createdAt: string;
  revokedAt?: string;
};

export interface Tier1OAuthStartResult {
  authUrl: string;
  state: string;
  expiresInSeconds: number;
  codeVerifier?: string;
}

export class Tier1ConnectorError extends Error {
  readonly type: Tier1ConnectorErrorType;
  readonly statusCode: number;

  constructor(type: Tier1ConnectorErrorType, message: string, statusCode = 500) {
    super(message);
    this.name = "Tier1ConnectorError";
    this.type = type;
    this.statusCode = statusCode;
  }
}
