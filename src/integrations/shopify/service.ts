import { shopifyCredentialStore } from "./credentialStore";
import { logShopify } from "./logger";
import {
  buildShopifyOAuthUrl,
  exchangeCodeForTokens,
  normalizeAndValidateShopDomain,
  parseScopes,
} from "./oauth";
import { createPkceState, consumePkceState } from "./pkceStore";
import { ShopifyClient } from "./shopifyClient";
import { ConnectorError, ShopifyConnectionHealth, ShopifyCredentialPublic } from "./types";

function requiredScopes(): string[] {
  return (process.env.SHOPIFY_SCOPES
    ?? "read_products,write_products,read_orders,write_orders,read_customers,write_customers")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function hasMissingRequiredScopes(scopes: string[]): string[] {
  const available = new Set(scopes);
  return requiredScopes().filter((scope) => !available.has(scope));
}

export class ShopifyConnectorService {
  beginOAuth(params: {
    userId: string;
    shopDomain: string;
  }): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const normalizedShopDomain = normalizeAndValidateShopDomain(params.shopDomain);
    const pkce = createPkceState(params.userId, normalizedShopDomain);
    const authUrl = buildShopifyOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
      shopDomain: normalizedShopDomain,
    });

    logShopify({
      event: "connect",
      level: "info",
      connector: "shopify",
      userId: params.userId,
      shopDomain: normalizedShopDomain,
      message: "Shopify OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string; shop?: string }): Promise<ShopifyCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    if (params.shop) {
      const callbackShop = normalizeAndValidateShopDomain(params.shop);
      if (callbackShop !== state.shopDomain) {
        throw new ConnectorError("auth", "OAuth callback shop does not match initialized state", 401);
      }
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
      shopDomain: state.shopDomain,
    });

    const scopes = parseScopes(tokenSet.scope);

    const credential = shopifyCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      scopes,
      shopDomain: tokenSet.shopDomain,
    });

    const missingScopes = hasMissingRequiredScopes(scopes);
    logShopify({
      event: missingScopes.length > 0 ? "error" : "connect",
      level: missingScopes.length > 0 ? "warn" : "info",
      connector: "shopify",
      userId: state.userId,
      shopDomain: tokenSet.shopDomain,
      message: missingScopes.length > 0
        ? "Shopify OAuth connection completed with missing recommended scopes"
        : "Shopify OAuth connection completed",
      metadata: {
        authMethod: "oauth2_pkce",
        missingScopes,
      },
    });

    return credential;
  }

  async connectApiKey(params: {
    userId: string;
    shopDomain: string;
    adminApiToken: string;
  }): Promise<ShopifyCredentialPublic> {
    const normalizedShopDomain = normalizeAndValidateShopDomain(params.shopDomain);
    const client = new ShopifyClient({
      token: params.adminApiToken,
      shopDomain: normalizedShopDomain,
    });
    await client.shop();

    const credential = shopifyCredentialStore.saveApiKey({
      userId: params.userId,
      adminApiToken: params.adminApiToken,
      shopDomain: normalizedShopDomain,
    });

    logShopify({
      event: "connect",
      level: "info",
      connector: "shopify",
      userId: params.userId,
      shopDomain: normalizedShopDomain,
      message: "Shopify API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  listConnections(userId: string): ShopifyCredentialPublic[] {
    return shopifyCredentialStore.getPublicByUser(userId);
  }

  async testConnection(userId: string): Promise<{ shopDomain: string; shopName: string }> {
    const credential = this.ensureCredential(userId);
    const client = this.getClientForCredential(credential);
    const shop = await client.shop();

    logShopify({
      event: "sync",
      level: "info",
      connector: "shopify",
      userId,
      shopDomain: credential.shopDomain,
      message: "Shopify test connection succeeded",
    });

    return {
      shopDomain: credential.shopDomain,
      shopName: shop.name,
    };
  }

  async health(userId: string): Promise<ShopifyConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = shopifyCredentialStore.getActiveByUser(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Shopify credential is connected",
        },
      };
    }

    try {
      const client = this.getClientForCredential(credential);
      await client.shop();

      const missingScopes = credential.authMethod === "oauth2_pkce"
        ? hasMissingRequiredScopes(credential.scopes)
        : [];

      if (missingScopes.length > 0) {
        return {
          status: "degraded",
          checkedAt,
          shopDomain: credential.shopDomain,
          authMethod: credential.authMethod,
          tokenRefreshStatus: "not_applicable",
          details: {
            auth: true,
            apiReachable: true,
            rateLimited: false,
            errorType: "schema",
            message: `Missing scopes: ${missingScopes.join(", ")}`,
          },
        };
      }

      logShopify({
        event: "health",
        level: "info",
        connector: "shopify",
        userId,
        shopDomain: credential.shopDomain,
        message: "Shopify health check passed",
      });

      return {
        status: "ok",
        checkedAt,
        shopDomain: credential.shopDomain,
        authMethod: credential.authMethod,
        tokenRefreshStatus: "not_applicable",
        details: {
          auth: true,
          apiReachable: true,
          rateLimited: false,
        },
      };
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logShopify({
        event: "error",
        level: "error",
        connector: "shopify",
        userId,
        shopDomain: credential.shopDomain,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        shopDomain: credential.shopDomain,
        authMethod: credential.authMethod,
        tokenRefreshStatus: "failed",
        details: {
          auth: connectorError.type !== "auth",
          apiReachable: connectorError.type !== "network",
          rateLimited: connectorError.type === "rate-limit",
          errorType: connectorError.type,
          message: connectorError.message,
        },
      };
    }
  }

  disconnect(userId: string, credentialId: string): boolean {
    const revoked = shopifyCredentialStore.revoke(credentialId, userId);

    if (revoked) {
      logShopify({
        event: "disconnect",
        level: "info",
        connector: "shopify",
        userId,
        message: "Shopify credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listProducts(userId: string): Promise<Array<{ id: number; title: string; status?: string }>> {
    const credential = this.ensureCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.listProducts();
  }

  async createProduct(userId: string, input: { title: string; body_html?: string; vendor?: string; product_type?: string }) {
    const credential = this.ensureCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.createProduct(input);
  }

  async updateProduct(userId: string, productId: string, patch: Record<string, unknown>) {
    const credential = this.ensureCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.updateProduct(productId, patch);
  }

  async listOrders(userId: string) {
    const credential = this.ensureCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.listOrders();
  }

  async listCustomers(userId: string) {
    const credential = this.ensureCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.listCustomers();
  }

  async subscribeWebhook(userId: string, input: { topic: string; address: string; format?: "json" | "xml" }) {
    const credential = this.ensureCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.subscribeWebhook(input);
  }

  private ensureCredential(userId: string) {
    const credential = shopifyCredentialStore.getActiveByUser(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Shopify connector is not configured", 404);
    }
    return credential;
  }

  private getClientForCredential(credential: ReturnType<typeof shopifyCredentialStore.getActiveByUser>): ShopifyClient {
    if (!credential) {
      throw new ConnectorError("auth", "Shopify connector is not configured", 404);
    }

    return new ShopifyClient({
      token: shopifyCredentialStore.decryptAccessToken(credential),
      shopDomain: credential.shopDomain,
    });
  }
}

export const shopifyConnectorService = new ShopifyConnectorService();
