import {
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
} from "../shared/tier1Contract";

export type GmailAuthMethod = "oauth2_pkce" | "api_key";

export type ConnectorErrorType = Tier1ConnectorErrorType;

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

export interface GmailCredentialPublic extends Tier1ConnectionPublic<GmailAuthMethod, {
  scopes: string[];
  emailAddress: string;
}> {}

export interface GmailConnectionHealth extends Tier1ConnectionHealth<GmailAuthMethod, {
  emailAddress?: string;
}> {}

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

export class ConnectorError extends Tier1ConnectorError {
  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "ConnectorError";
  }
}
