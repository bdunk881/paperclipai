export type ComposioAuthMethod = "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface ComposioCredential {
  id: string;
  userId: string;
  authMethod: ComposioAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface ComposioCredentialPublic {
  id: string;
  userId: string;
  authMethod: ComposioAuthMethod;
  tokenMasked: string;
  createdAt: string;
  revokedAt?: string;
}

export interface ComposioConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  authMethod?: ComposioAuthMethod;
  tokenRefreshStatus?: "not_applicable";
  details: {
    auth: boolean;
    apiReachable: boolean;
    rateLimited: boolean;
    errorType?: ConnectorErrorType;
    message?: string;
  };
}

export interface ComposioConnectedAccount {
  id: string;
  status?: string;
  toolkitSlug?: string;
  toolkitName?: string;
  userId?: string;
  authConfigId?: string;
  authScheme?: string;
  redirectUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  enabled?: boolean;
}

export interface ComposioActiveTrigger {
  triggerId: string;
  slug?: string;
  status?: string;
  connectedAccountId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ComposioToolExecutionResult {
  successful: boolean;
  data?: unknown;
  error?: string | null;
}

export interface ComposioWebhookEvent {
  id?: string;
  type?: string;
  metadata?: {
    trigger_slug?: string;
    trigger_id?: string;
    connected_account_id?: string;
    auth_config_id?: string;
    user_id?: string;
    [key: string]: unknown;
  };
  data?: unknown;
  timestamp?: string;
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
