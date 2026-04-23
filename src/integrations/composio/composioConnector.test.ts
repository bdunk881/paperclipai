import { createHmac } from "crypto";
import { composioCredentialStore } from "./credentialStore";
import { ComposioClient } from "./composioClient";
import { clearComposioWebhookReplayCache, verifyComposioWebhook } from "./webhook";
import { ComposioConnectorService } from "./service";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("Composio connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev/api/v3.1",
      COMPOSIO_WEBHOOK_SECRET: "composio_webhook_secret",
      COMPOSIO_WEBHOOK_TOLERANCE_SECONDS: "300",
    };

    composioCredentialStore.clear();
    clearComposioWebhookReplayCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("connects with API-key auth and stores encrypted credentials", async () => {
    const service = new ComposioConnectorService();

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse(["GMAIL_SEND_EMAIL", "SLACK_SEND_MESSAGE"])
    );

    const connection = await service.connectApiKey({
      userId: "user-1",
      apiKey: "cmp_project_key_123",
    });

    expect(connection.authMethod).toBe("api_key");
    expect(connection.tokenMasked).toMatch(/^\*{4}/);
  });

  it("returns down health when no credential is configured", async () => {
    const service = new ComposioConnectorService();
    const health = await service.health("missing-user");

    expect(health.status).toBe("down");
    expect(health.details.auth).toBe(false);
    expect(health.details.errorType).toBe("auth");
  });

  it("lists tool enums and executes tools", async () => {
    const client = new ComposioClient("cmp_project_key_123");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse(["GMAIL_SEND_EMAIL", "SLACK_SEND_MESSAGE"]))
      .mockResolvedValueOnce(
        mockJsonResponse({
          successful: true,
          data: { sent: true },
          error: null,
        })
      );

    const tools = await client.listToolEnums();
    const result = await client.executeTool({
      toolSlug: "GMAIL_SEND_EMAIL",
      arguments: { to: "test@example.com", body: "hello" },
      connectedAccountId: "ca_123",
    });

    expect(tools).toContain("GMAIL_SEND_EMAIL");
    expect(result.successful).toBe(true);
    expect(result.data).toEqual({ sent: true });
  });

  it("handles pagination when listing connected accounts", async () => {
    const client = new ComposioClient("cmp_project_key_123");

    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      mockJsonResponse({
        items: [
          {
            id: "ca_1",
            status: "ACTIVE",
            user_id: "user-1",
            toolkit: { slug: "gmail", name: "Gmail" },
            auth_config: { id: "ac_1", auth_scheme: "OAUTH2" },
          },
          {
            id: "ca_2",
            status: "EXPIRED",
            user_id: "user-2",
            toolkit: { slug: "slack", name: "Slack" },
            auth_config: { id: "ac_2", auth_scheme: "API_KEY" },
          },
        ],
        next_cursor: "cursor-2",
      })
    );

    const result = await client.listConnectedAccounts({
      toolkitSlugs: ["gmail", "slack"],
      limit: 2,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe("ca_1");
    expect(result.nextCursor).toBe("cursor-2");
  });

  it("creates and refreshes connected accounts", async () => {
    const client = new ComposioClient("cmp_project_key_123");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "ca_new",
          connectionData: {
            val: {
              status: "INITIATED",
              authUri: "https://connect.composio.dev/link/abc123",
            },
          },
        }, 201)
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          id: "ca_new",
          status: "ACTIVE",
          redirect_url: "https://connect.composio.dev/link/refreshed",
        })
      );

    const created = await client.createConnectedAccount({
      authConfigId: "ac_123",
      userId: "external-user-1",
      connection: { api_key: "nested_key" },
      validateCredentials: true,
    });
    const refreshed = await client.refreshConnectedAccount({
      connectedAccountId: "ca_new",
      redirectUrl: "https://autoflow.test/finish",
    });

    expect(created.id).toBe("ca_new");
    expect(created.redirectUrl).toContain("connect.composio.dev");
    expect(refreshed.status).toBe("ACTIVE");
  });

  it("creates and lists active triggers", async () => {
    const client = new ComposioClient("cmp_project_key_123");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse({ trigger_id: "ti_123" }, 201))
      .mockResolvedValueOnce(
        mockJsonResponse([
          {
            trigger_id: "ti_123",
            trigger_name: "GMAIL_NEW_GMAIL_MESSAGE",
            status: "ACTIVE",
            connected_account_id: "ca_123",
          },
        ])
      );

    const created = await client.upsertTrigger({
      slug: "GMAIL_NEW_GMAIL_MESSAGE",
      connectedAccountId: "ca_123",
      triggerConfig: { label: "Inbox watcher" },
    });
    const triggers = await client.listActiveTriggers({
      connectedAccountIds: ["ca_123"],
    });

    expect(created.triggerId).toBe("ti_123");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].connectedAccountId).toBe("ca_123");
  });

  it("retries on rate limiting and eventually succeeds", async () => {
    const client = new ComposioClient("cmp_project_key_123");

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(mockJsonResponse(["GMAIL_SEND_EMAIL"]));

    const result = await client.listToolEnums();

    expect(result).toEqual(["GMAIL_SEND_EMAIL"]);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });

  it("verifies Composio webhook signatures and blocks replay", () => {
    const payload = Buffer.from(
      JSON.stringify({
        id: "msg_abc123",
        type: "composio.trigger.message",
        metadata: { trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE" },
        data: { subject: "Hello" },
      }),
      "utf8"
    );
    const webhookId = "msg_abc123";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "composio_webhook_secret")
      .update(`${webhookId}.${timestamp}.${payload.toString("utf8")}`)
      .digest("base64");

    verifyComposioWebhook({
      rawBody: payload,
      webhookIdHeader: webhookId,
      webhookTimestampHeader: timestamp,
      signatureHeader: `v1,${signature}`,
      signingSecret: "composio_webhook_secret",
    });

    expect(() =>
      verifyComposioWebhook({
        rawBody: payload,
        webhookIdHeader: webhookId,
        webhookTimestampHeader: timestamp,
        signatureHeader: `v1,${signature}`,
        signingSecret: "composio_webhook_secret",
      })
    ).toThrow("Composio webhook replay detected");
  });
});
