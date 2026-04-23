export type StripeAuthMethod = "oauth2" | "api_key";

export type ConnectorErrorType =
  | "auth"
  | "rate-limit"
  | "schema"
  | "network"
  | "upstream";

export interface StripeTokenSet {
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  scopes: string[];
  accountId: string;
  accountName?: string;
  accountEmail?: string;
  livemode: boolean;
}

export interface StripeCredential {
  id: string;
  userId: string;
  authMethod: StripeAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  accountId: string;
  accountName?: string;
  accountEmail?: string;
  livemode: boolean;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface StripeCredentialPublic {
  id: string;
  userId: string;
  authMethod: StripeAuthMethod;
  tokenMasked: string;
  scopes: string[];
  accountId: string;
  accountName?: string;
  accountEmail?: string;
  livemode: boolean;
  createdAt: string;
  revokedAt?: string;
}

export interface StripeConnectionHealth {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  accountId?: string;
  authMethod?: StripeAuthMethod;
  tokenRefreshStatus?: "not_applicable" | "healthy" | "failed";
  details: {
    auth: boolean;
    apiReachable: boolean;
    rateLimited: boolean;
    errorType?: ConnectorErrorType;
    message?: string;
  };
}

export interface StripeAccountSummary {
  accountId: string;
  accountName?: string;
  accountEmail?: string;
  livemode: boolean;
  scopes: string[];
}

export interface StripeCustomer {
  id: string;
  email?: string;
  name?: string;
  phone?: string;
  currency?: string;
  createdAt: string;
  delinquent?: boolean;
  livemode: boolean;
}

export interface StripeSubscription {
  id: string;
  customerId?: string;
  status: string;
  priceId?: string;
  quantity?: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  createdAt: string;
  livemode: boolean;
}

export interface StripeInvoice {
  id: string;
  customerId?: string;
  status?: string;
  currency?: string;
  total?: number;
  hostedInvoiceUrl?: string;
  createdAt: string;
  livemode: boolean;
}

export interface StripePaymentIntent {
  id: string;
  customerId?: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  createdAt: string;
  livemode: boolean;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  createdAt: string;
  account?: string;
  livemode?: boolean;
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
