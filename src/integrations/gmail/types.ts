export type GmailAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface GmailTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  emailAddress: string;
  historyId?: string;
}

export interface GmailCredential {
  id: string;
  userId: string;
  authMethod: GmailAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  emailAddress: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface GmailCredentialPublic {
  id: string;
  userId: string;
  authMethod: GmailAuthMethod;
  tokenMasked: string;
  scopes: string[];
  emailAddress: string;
  createdAt: string;
  revokedAt?: string;
}

export interface GmailConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  emailAddress?: string;
  authMethod?: GmailAuthMethod;
  tokenRefreshStatus?: "not_applicable" | "healthy" | "failed";
  details: {
    auth: boolean;
    apiReachable: boolean;
    rateLimited: boolean;
    errorType?: ConnectorErrorType;
    message?: string;
  };
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  textBody?: string;
  htmlBody?: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
}

export interface GmailWatchResponse {
  historyId: string;
  expiration?: string;
}

export interface GmailWebhookNotification {
  subscription?: string;
  messageId: string;
  publishTime?: string;
  emailAddress?: string;
  historyId?: string;
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
