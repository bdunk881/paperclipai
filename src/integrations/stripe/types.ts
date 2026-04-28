import {
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
} from "../shared/tier1Contract";

export type StripeAuthMethod = "oauth2" | "api_key";

export type ConnectorErrorType = Tier1ConnectorErrorType;

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

export interface StripeCredentialPublic extends Tier1ConnectionPublic<StripeAuthMethod, {
  scopes: string[];
  accountId: string;
  accountName?: string;
  accountEmail?: string;
  livemode: boolean;
}> {}

export interface StripeConnectionHealth extends Tier1ConnectionHealth<StripeAuthMethod, {
  accountId?: string;
}> {}

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

export class ConnectorError extends Tier1ConnectorError {
  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "ConnectorError";
  }
}
