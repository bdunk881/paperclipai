import { clearPkceState } from "./pkceStore";
import { shopifyCredentialStore } from "./credentialStore";
import { ShopifyConnectorService } from "./service";
import { clearShopifyWebhookReplayCache, verifyShopifyWebhook } from "./webhook";
import { ShopifyClient } from "./shopifyClient";
import { createHmac } from "crypto";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Shopify connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SHOPIFY_CLIENT_ID: "shopify_client_123",
      SHOPIFY_CLIENT_SECRET: "shopify_secret_123",
      SHOPIFY_REDIRECT_URI: "https://autoflow.test/api/integrations/shopify/oauth/callback",
      SHOPIFY_SCOPES: "read_products,write_products,read_orders,read_customers",
      SHOPIFY_WEBHOOK_SECRET: "shopify_webhook_secret",
      SHOPIFY_API_VERSION: "2024-10",
    };

    clearPkceState();
    shopifyCredentialStore.clear();
    clearShopifyWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state and challenge", () => {
    const service = new ShopifyConnectorService();
    const result = service.beginOAuth({
      userId: "user-1",
      shopDomain: "acme.myshopify.com",
    });

    expect(result.authUrl).toContain("https://acme.myshopify.com/admin/oauth/authorize");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new ShopifyConnectorService();
    const start = service.beginOAuth({
      userId: "user-1",
      shopDomain: "acme.myshopify.com",
    });

    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "shpat_oauth_token",
          scope: "read_products,write_products,read_orders,read_customers",
        })
      );

    const connection = await service.completeOAuth({
      code: "oauth-code",
      state: start.state,
      shop: "acme.myshopify.com",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.shopDomain).toBe("acme.myshopify.com");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies auth", async () => {
    const service = new ShopifyConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        shop: { id: 101, name: "Acme", domain: "acme.myshopify.com" },
      })
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      shopDomain: "acme.myshopify.com",
      adminApiToken: "shpat_api_token",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.shopDomain).toBe("acme.myshopify.com");
  });

  it("returns down health when connector is not configured", async () => {
    const service = new ShopifyConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("handles cursor pagination for products", async () => {
    const client = new ShopifyClient({
      token: "shpat_token",
      shopDomain: "acme.myshopify.com",
    });

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse(
          {
            products: [{ id: 1, title: "T-Shirt", status: "active" }],
          },
          200,
          {
            link: '<https://acme.myshopify.com/admin/api/2024-10/products.json?limit=50&page_info=cursor-2>; rel="next"',
          }
        )
      )
      .mockResolvedValueOnce(
        mockJsonResponse(
          {
            products: [{ id: 2, title: "Hat", status: "draft" }],
          },
          200,
          { link: '' }
        )
      );

    const products = await client.listProducts(50);
    expect(products).toHaveLength(2);
    expect(products[0].id).toBe(1);
    expect(products[1].id).toBe(2);
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new ShopifyClient({
      token: "shpat_token",
      shopDomain: "acme.myshopify.com",
    });

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: "Too Many Requests" }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          shop: { id: 101, name: "Acme", domain: "acme.myshopify.com" },
        })
      );

    const shop = await client.shop();
    expect(shop.domain).toBe("acme.myshopify.com");
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("verifies Shopify webhook signatures and blocks replay", () => {
    const payload = Buffer.from(JSON.stringify({ id: 1, topic: "orders/create" }), "utf8");
    const signature = createHmac("sha256", "shopify_webhook_secret")
      .update(payload)
      .digest("base64");

    verifyShopifyWebhook({
      rawBody: payload,
      hmacHeader: signature,
      webhookIdHeader: "event-1",
      signingSecret: "shopify_webhook_secret",
    });

    expect(() =>
      verifyShopifyWebhook({
        rawBody: payload,
        hmacHeader: signature,
        webhookIdHeader: "event-1",
        signingSecret: "shopify_webhook_secret",
      })
    ).toThrow(/replay/i);
  });
});
