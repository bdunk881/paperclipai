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
export type Tier1HealthStatus =
  | "healthy"
  | "degraded"
  | "auth_failed"
  | "rate_limited"
  | "provider_error"
  | "disabled";
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
  lastSuccessfulSyncAt?: string;
  lastErrorCategory?: Tier1ConnectorErrorType;
  recommendedNextAction: string;
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

const tier1HealthMemory = new Map<string, {
  status: Tier1HealthStatus;
  lastSuccessfulSyncAt?: string;
  lastErrorCategory?: Tier1ConnectorErrorType;
}>();

function resolveTier1HealthStatus(errorType?: Tier1ConnectorErrorType): Tier1HealthStatus {
  if (errorType === "auth") {
    return "auth_failed";
  }
  if (errorType === "rate-limit") {
    return "rate_limited";
  }
  if (errorType === "network") {
    return "degraded";
  }
  if (errorType === "schema" || errorType === "upstream") {
    return "provider_error";
  }
  return "healthy";
}

export function getTier1RecommendedNextAction(
  status: Tier1HealthStatus,
  errorType?: Tier1ConnectorErrorType
): string {
  switch (status) {
    case "healthy":
      return "No action required.";
    case "disabled":
      return "Connect or re-enable the connector credential from the dashboard.";
    case "auth_failed":
      return "Reconnect the credential and confirm the required scopes are still granted.";
    case "rate_limited":
      return "Wait for the provider rate-limit window to reset, then retry the connector.";
    case "degraded":
      return "Retry after the transient provider or network issue clears.";
    case "provider_error":
      if (errorType === "schema") {
        return "Review the provider payload or configuration drift and update the connector mapping.";
      }
      return "Inspect the upstream provider error and retry once the service recovers.";
    default:
      return "Inspect connector logs and retry the operation.";
  }
}

export function getTier1HealthHttpStatus(status: Tier1HealthStatus): number {
  switch (status) {
    case "healthy":
      return 200;
    case "degraded":
    case "rate_limited":
      return 206;
    default:
      return 503;
  }
}

export function buildTier1ConnectionHealth<
  TAuthMethod extends string = string,
  TMetadata extends Record<string, unknown> = {},
>(params: {
  connector: string;
  subject: string;
  checkedAt?: string;
  authMethod?: TAuthMethod;
  tokenRefreshStatus?: Tier1TokenRefreshStatus;
  details: Tier1ConnectionHealthDetails;
  metadata?: TMetadata;
  status?: Tier1HealthStatus;
  recommendedNextAction?: string;
}): Tier1ConnectionHealth<TAuthMethod, TMetadata> {
  const checkedAt = params.checkedAt ?? new Date().toISOString();
  const status = params.status ?? resolveTier1HealthStatus(params.details.errorType);
  const key = `${params.connector}:${params.subject}`;
  const previous = tier1HealthMemory.get(key);
  const lastSuccessfulSyncAt = status === "healthy"
    ? checkedAt
    : previous?.lastSuccessfulSyncAt;
  const lastErrorCategory = status === "healthy"
    ? undefined
    : params.details.errorType ?? previous?.lastErrorCategory;
  const recommendedNextAction =
    params.recommendedNextAction ?? getTier1RecommendedNextAction(status, params.details.errorType);

  tier1HealthMemory.set(key, {
    status,
    lastSuccessfulSyncAt,
    lastErrorCategory,
  });

  if (previous?.status && previous.status !== status) {
    console.log(JSON.stringify({
      ts: checkedAt,
      event: "health_transition",
      connector: params.connector,
      subject: params.subject,
      previousStatus: previous.status,
      nextStatus: status,
      lastErrorCategory,
    }));
  }

  return {
    ...(params.metadata ?? {} as TMetadata),
    status,
    checkedAt,
    authMethod: params.authMethod,
    tokenRefreshStatus: params.tokenRefreshStatus,
    lastSuccessfulSyncAt,
    lastErrorCategory,
    recommendedNextAction,
    details: params.details,
  };
}
