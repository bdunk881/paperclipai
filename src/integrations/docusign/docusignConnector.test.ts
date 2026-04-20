import { createHmac } from "crypto";
import { docuSignCredentialStore } from "./credentialStore";
import { DocuSignClient } from "./docusignClient";
import { clearPkceState } from "./pkceStore";
import { DocuSignConnectorService } from "./service";
import { clearDocuSignWebhookReplayCache, verifyDocuSignWebhook } from "./webhook";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("DocuSign connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DOCUSIGN_CLIENT_ID: "docusign-client",
      DOCUSIGN_CLIENT_SECRET: "docusign-secret",
      DOCUSIGN_REDIRECT_URI: "https://autoflow.test/api/integrations/docusign/oauth/callback",
      DOCUSIGN_SCOPES: "signature extended offline_access",
      DOCUSIGN_WEBHOOK_SECRET: "docusign-webhook-secret",
    };

    clearPkceState();
    clearDocuSignWebhookReplayCache();
    docuSignCredentialStore.clear();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("builds an OAuth URL with PKCE state and challenge", () => {
    const service = new DocuSignConnectorService();
    const result = service.beginOAuth("user-1");

    expect(result.authUrl).toContain("/oauth/auth");
    expect(result.authUrl).toContain("code_challenge_method=S256");
    expect(result.state).toBeTruthy();
    expect(result.codeVerifier).toBeTruthy();
    expect(result.expiresInSeconds).toBeGreaterThan(0);
  });

  it("completes OAuth and stores encrypted credentials", async () => {
    const service = new DocuSignConnectorService();
    const start = service.beginOAuth("user-1");

    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "oauth-access-token",
          refresh_token: "oauth-refresh-token",
          expires_in: 3600,
          scope: "signature extended offline_access",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          accounts: [
            {
              account_id: "123456",
              account_name: "AutoFlow Docs",
              base_uri: "https://demo.docusign.net/restapi",
              is_default: true,
            },
          ],
        })
      );

    const connection = await service.completeOAuth({ code: "oauth-code", state: start.state });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(connection.authMethod).toBe("oauth2_pkce");
    expect(connection.accountId).toBe("123456");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("connects with API-key fallback and verifies account", async () => {
    const service = new DocuSignConnectorService();

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          accountId: "123456",
          accountName: "AutoFlow Docs",
        })
      );

    const connection = await service.connectApiKey({
      userId: "user-1",
      accessToken: "api-access-token",
      accountId: "123456",
      baseUri: "https://demo.docusign.net/restapi",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.accountId).toBe("123456");
  });

  it("returns down health when connector is not configured", async () => {
    const service = new DocuSignConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("refreshes OAuth access token when token is near expiry", async () => {
    const service = new DocuSignConnectorService();
    const start = service.beginOAuth("user-1");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "old-access-token",
          refresh_token: "old-refresh-token",
          expires_in: 1,
          scope: "signature extended offline_access",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          accounts: [
            {
              account_id: "123456",
              account_name: "AutoFlow Docs",
              base_uri: "https://demo.docusign.net/restapi",
              is_default: true,
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          scope: "signature extended offline_access",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          accounts: [
            {
              account_id: "123456",
              account_name: "AutoFlow Docs",
              base_uri: "https://demo.docusign.net/restapi",
              is_default: true,
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          accountId: "123456",
          accountName: "AutoFlow Docs",
        })
      );

    await service.completeOAuth({ code: "oauth-code", state: start.state });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const account = await service.testConnection("user-1");

    expect(account.accountId).toBe("123456");
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("handles start_position pagination in envelope listing", async () => {
    const client = new DocuSignClient({
      token: "api-token",
      accountId: "123456",
      baseUri: "https://demo.docusign.net/restapi",
    });

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          envelopes: [{ envelopeId: "env-1", status: "sent" }],
          nextUri: "/v2.1/accounts/123456/envelopes?from_date=2025-01-01&start_position=100",
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          envelopes: [{ envelopeId: "env-2", status: "delivered" }],
        })
      );

    const envelopes = await client.listEnvelopes(100);
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0].envelopeId).toBe("env-1");
    expect(envelopes[1].envelopeId).toBe("env-2");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new DocuSignClient({
      token: "api-token",
      accountId: "123456",
      baseUri: "https://demo.docusign.net/restapi",
    });

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorCode: "RATE_LIMIT_EXCEEDED" }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          accountId: "123456",
          accountName: "AutoFlow Docs",
        })
      );

    const account = await client.getAccountInfo();
    expect(account.accountId).toBe("123456");
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("verifies DocuSign webhook signatures and blocks replay", () => {
    const payload = Buffer.from(JSON.stringify({ event: "envelope-sent" }), "utf8");
    const signature = createHmac("sha256", "docusign-webhook-secret").update(payload).digest("hex");

    verifyDocuSignWebhook({
      rawBody: payload,
      signatureHeader: signature,
      deliveryIdHeader: "delivery-1",
      signingSecret: "docusign-webhook-secret",
    });

    expect(() =>
      verifyDocuSignWebhook({
        rawBody: payload,
        signatureHeader: signature,
        deliveryIdHeader: "delivery-1",
        signingSecret: "docusign-webhook-secret",
      })
    ).toThrow(/replay/i);
  });
});
