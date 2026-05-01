import { stripeCredentialStore } from "./credentialStore";
import { logStripe } from "./logger";
import { buildTier1ConnectionHealth } from "../shared/tier1Contract";
import { buildStripeOAuthUrl, exchangeCodeForTokens, parseStripeScopes, refreshAccessToken } from "./oauth";
import { consumeOAuthState, createOAuthState } from "./oauthStateStore";
import { StripeConnectorClient } from "./stripeClient";
import {
  ConnectorError,
  StripeConnectionHealth,
  StripeCredential,
  StripeCredentialPublic,
  StripeCustomer,
  StripeInvoice,
  StripePaymentIntent,
  StripeSubscription,
} from "./types";

export class StripeConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    expiresInSeconds: number;
  } {
    const state = createOAuthState(userId);
    const authUrl = buildStripeOAuthUrl({ state: state.state });

    logStripe({
      event: "connect",
      level: "info",
      connector: "stripe",
      userId,
      message: "Stripe OAuth flow initialized",
      metadata: { authMethod: "oauth2" },
    });

    return {
      authUrl,
      state: state.state,
      expiresInSeconds: state.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<StripeCredentialPublic> {
    const state = consumeOAuthState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({ code: params.code });
    const credential = stripeCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: tokenSet.scopes,
      accountId: tokenSet.accountId,
      accountName: tokenSet.accountName,
      accountEmail: tokenSet.accountEmail,
      livemode: tokenSet.livemode,
      metadata: tokenSet.scope ? { scope: tokenSet.scope } : undefined,
    });

    logStripe({
      event: "connect",
      level: "info",
      connector: "stripe",
      userId: state.userId,
      accountId: tokenSet.accountId,
      message: "Stripe OAuth connection completed",
      metadata: { authMethod: "oauth2" },
    });

    return credential;
  }

  async connectApiKey(params: { userId: string; apiKey: string }): Promise<StripeCredentialPublic> {
    const client = new StripeConnectorClient(params.apiKey, "api_key");
    const viewer = await client.viewer();

    const credential = stripeCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      scopes: viewer.scopes,
      accountId: viewer.accountId,
      accountName: viewer.accountName,
      accountEmail: viewer.accountEmail,
      livemode: viewer.livemode,
    });

    logStripe({
      event: "connect",
      level: "info",
      connector: "stripe",
      userId: params.userId,
      accountId: viewer.accountId,
      message: "Stripe API-key connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  async listConnections(userId: string): Promise<StripeCredentialPublic[]> {
    return stripeCredentialStore.getPublicByUserAsync(userId);
  }

  async testConnection(userId: string): Promise<{ accountId: string; accountName?: string; accountEmail?: string }> {
    const viewer = await this.withClient(userId, (client) => client.viewer());

    logStripe({
      event: "sync",
      level: "info",
      connector: "stripe",
      userId,
      accountId: viewer.accountId,
      message: "Stripe test connection succeeded",
    });

    return viewer;
  }

  async health(userId: string): Promise<StripeConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = await stripeCredentialStore.getActiveByUserAsync(userId);

    if (!credential) {
      return buildTier1ConnectionHealth({
        connector: "stripe",
        subject: userId,
        checkedAt,
        status: "disabled",
        recommendedNextAction: "Connect a Stripe credential from the dashboard to enable syncs.",
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          message: "No Stripe credential is connected",
        },
      });
    }

    try {
      await this.withClient(userId, (client) => client.viewer());

      const health: StripeConnectionHealth = buildTier1ConnectionHealth({
        connector: "stripe",
        subject: userId,
        checkedAt,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2"
            ? credential.refreshTokenEncrypted
              ? "healthy"
              : "not_applicable"
            : "not_applicable",
        metadata: {
          accountId: credential.accountId,
        },
        details: {
          auth: true,
          apiReachable: true,
          rateLimited: false,
        },
      });

      logStripe({
        event: "health",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logStripe({
        event: "error",
        level: "error",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return buildTier1ConnectionHealth({
        connector: "stripe",
        subject: userId,
        checkedAt,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2"
            ? connectorError.type === "auth" && credential.refreshTokenEncrypted
              ? "failed"
              : "healthy"
            : "not_applicable",
        metadata: {
          accountId: credential.accountId,
        },
        details: {
          auth: connectorError.type !== "auth",
          apiReachable: connectorError.type !== "network",
          rateLimited: connectorError.type === "rate-limit",
          errorType: connectorError.type,
          message: connectorError.message,
        },
      });
    }
  }

  async disconnect(userId: string, credentialId: string): Promise<boolean> {
    const revoked = await stripeCredentialStore.revokeAsync(credentialId, userId);

    if (revoked) {
      logStripe({
        event: "disconnect",
        level: "info",
        connector: "stripe",
        userId,
        message: "Stripe credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listCustomers(userId: string, limit?: number): Promise<StripeCustomer[]> {
    return this.withClient(userId, async (client, credential) => {
      const customers = await client.listCustomers(limit);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe customers synced",
        metadata: { total: customers.length },
      });
      return customers;
    });
  }

  async createCustomer(
    userId: string,
    input: {
      email?: string;
      name?: string;
      phone?: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeCustomer> {
    return this.withClient(userId, async (client, credential) => {
      const customer = await client.createCustomer(input);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe customer created",
        metadata: { customerId: customer.id },
      });
      return customer;
    });
  }

  async updateCustomer(
    userId: string,
    customerId: string,
    input: {
      email?: string;
      name?: string;
      phone?: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeCustomer> {
    return this.withClient(userId, async (client, credential) => {
      const customer = await client.updateCustomer(customerId, input);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe customer updated",
        metadata: { customerId: customer.id },
      });
      return customer;
    });
  }

  async listSubscriptions(
    userId: string,
    params: { customerId?: string; status?: string; limit?: number }
  ): Promise<StripeSubscription[]> {
    return this.withClient(userId, async (client, credential) => {
      const subscriptions = await client.listSubscriptions(params);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe subscriptions synced",
        metadata: { total: subscriptions.length },
      });
      return subscriptions;
    });
  }

  async createSubscription(
    userId: string,
    input: {
      customerId: string;
      priceId: string;
      quantity?: number;
      trialPeriodDays?: number;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeSubscription> {
    return this.withClient(userId, async (client, credential) => {
      const subscription = await client.createSubscription(input);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe subscription created",
        metadata: { subscriptionId: subscription.id },
      });
      return subscription;
    });
  }

  async updateSubscription(
    userId: string,
    subscriptionId: string,
    input: {
      priceId?: string;
      quantity?: number;
      cancelAtPeriodEnd?: boolean;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeSubscription> {
    return this.withClient(userId, async (client, credential) => {
      const subscription = await client.updateSubscription(subscriptionId, input);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe subscription updated",
        metadata: { subscriptionId: subscription.id },
      });
      return subscription;
    });
  }

  async listInvoices(
    userId: string,
    params: { customerId?: string; status?: string; limit?: number }
  ): Promise<StripeInvoice[]> {
    return this.withClient(userId, async (client, credential) => {
      const invoices = await client.listInvoices(params);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe invoices synced",
        metadata: { total: invoices.length },
      });
      return invoices;
    });
  }

  async createInvoice(
    userId: string,
    input: {
      customerId: string;
      autoAdvance?: boolean;
      collectionMethod?: string;
      daysUntilDue?: number;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeInvoice> {
    return this.withClient(userId, async (client, credential) => {
      const invoice = await client.createInvoice(input);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe invoice created",
        metadata: { invoiceId: invoice.id },
      });
      return invoice;
    });
  }

  async updateInvoice(
    userId: string,
    invoiceId: string,
    input: {
      autoAdvance?: boolean;
      collectionMethod?: string;
      daysUntilDue?: number;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeInvoice> {
    return this.withClient(userId, async (client, credential) => {
      const invoice = await client.updateInvoice(invoiceId, input);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe invoice updated",
        metadata: { invoiceId: invoice.id },
      });
      return invoice;
    });
  }

  async deleteInvoice(userId: string, invoiceId: string): Promise<boolean> {
    return this.withClient(userId, async (client, credential) => {
      const deleted = await client.deleteInvoice(invoiceId);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: deleted ? "Stripe invoice deleted" : "Stripe invoice deletion not confirmed",
        metadata: { invoiceId, deleted },
      });
      return deleted;
    });
  }

  async listPaymentIntents(
    userId: string,
    params: { customerId?: string; status?: string; limit?: number }
  ): Promise<StripePaymentIntent[]> {
    return this.withClient(userId, async (client, credential) => {
      const paymentIntents = await client.listPaymentIntents(params);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe payment intents synced",
        metadata: { total: paymentIntents.length },
      });
      return paymentIntents;
    });
  }

  async createPaymentIntent(
    userId: string,
    input: {
      amount: number;
      currency: string;
      customerId?: string;
      description?: string;
      confirm?: boolean;
      paymentMethodId?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StripePaymentIntent> {
    return this.withClient(userId, async (client, credential) => {
      const paymentIntent = await client.createPaymentIntent(input);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe payment intent created",
        metadata: { paymentIntentId: paymentIntent.id },
      });
      return paymentIntent;
    });
  }

  async updatePaymentIntent(
    userId: string,
    paymentIntentId: string,
    input: {
      amount?: number;
      description?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StripePaymentIntent> {
    return this.withClient(userId, async (client, credential) => {
      const paymentIntent = await client.updatePaymentIntent(paymentIntentId, input);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe payment intent updated",
        metadata: { paymentIntentId: paymentIntent.id },
      });
      return paymentIntent;
    });
  }

  async cancelPaymentIntent(userId: string, paymentIntentId: string): Promise<StripePaymentIntent> {
    return this.withClient(userId, async (client, credential) => {
      const paymentIntent = await client.cancelPaymentIntent(paymentIntentId);
      logStripe({
        event: "sync",
        level: "info",
        connector: "stripe",
        userId,
        accountId: credential.accountId,
        message: "Stripe payment intent cancelled",
        metadata: { paymentIntentId: paymentIntent.id },
      });
      return paymentIntent;
    });
  }

  private async withClient<T>(
    userId: string,
    operation: (client: StripeConnectorClient, credential: StripeCredential) => Promise<T>,
    allowRefresh = true
  ): Promise<T> {
    const credential = await this.ensureCredential(userId);
    const token = stripeCredentialStore.decryptAccessToken(credential);
    const client = new StripeConnectorClient(token, credential.authMethod);

    try {
      return await operation(client, credential);
    } catch (error) {
      if (
        allowRefresh &&
        error instanceof ConnectorError &&
        error.type === "auth" &&
        credential.authMethod === "oauth2" &&
        credential.refreshTokenEncrypted
      ) {
        const refreshToken = stripeCredentialStore.decryptRefreshToken(credential);
        if (!refreshToken) {
          throw error;
        }

        try {
          const refreshed = await refreshAccessToken(refreshToken);
          stripeCredentialStore.rotateToken({
            credentialId: credential.id,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            scopes: refreshed.scopes.length > 0 ? refreshed.scopes : parseStripeScopes(refreshed.scope),
            accountName: refreshed.accountName,
            accountEmail: refreshed.accountEmail,
            livemode: refreshed.livemode,
          });

          return this.withClient(userId, operation, false);
        } catch (refreshError) {
          logStripe({
            event: "error",
            level: "error",
            connector: "stripe",
            userId,
            accountId: credential.accountId,
            message: `Stripe token refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
            errorType: "auth",
          });
          throw new ConnectorError("auth", "Stripe token refresh failed", 401);
        }
      }

      throw error;
    }
  }

  private async ensureCredential(userId: string): Promise<StripeCredential> {
    const credential = await stripeCredentialStore.getActiveByUserAsync(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Stripe connector is not configured", 404);
    }

    return credential;
  }
}

export const stripeConnectorService = new StripeConnectorService();
