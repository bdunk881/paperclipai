import { handleComposioWebhook } from "./webhookService";
import { getComposioBroker } from "./client";
import { connectedAccountStore, type ComposioWorkspaceContext } from "./connectedAccountStore";

jest.mock("./client", () => ({
  getComposioBroker: jest.fn(),
  resetComposioBrokerForTests: jest.fn(),
}));

const getBroker = getComposioBroker as jest.MockedFunction<typeof getComposioBroker>;

describe("handleComposioWebhook (HEL-749)", () => {
  const ORIGINAL_ENV = { ...process.env };
  const verifyMock = jest.fn();
  const ctx: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    connectedAccountStore.__resetForTests();
    process.env = {
      ...ORIGINAL_ENV,
      COMPOSIO_ENABLED: "true",
      COMPOSIO_API_KEY: "ck_test",
      COMPOSIO_WEBHOOK_SECRET: "whsec",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getBroker.mockResolvedValue({ triggers: { verifyWebhook: verifyMock } } as any);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  function expiredEvent(caId: string, slug = "github") {
    return {
      version: "V3",
      payload: {
        triggerSlug: "composio.connected_account.expired",
        // the real ca_/toolkit/status live in payload.payload (the raw `data`)
        payload: { id: caId, toolkit: { slug }, status: "EXPIRED", status_reason: "token revoked" },
      },
      rawPayload: { type: "composio.connected_account.expired" },
    };
  }

  it("marks the connected account EXPIRED on connected_account.expired", async () => {
    await connectedAccountStore.upsert(ctx, {
      toolkit: "github",
      connectedAccountId: "ca_1",
      authConfigId: "ac_1",
      status: "ACTIVE",
    });
    verifyMock.mockResolvedValue(expiredEvent("ca_1"));

    const out = await handleComposioWebhook("{raw}", {
      id: "wh_1",
      timestamp: "123",
      signature: "v1,sig",
    });

    expect(out.status).toBe(200);
    expect(out.body.handled).toBe("expired");
    expect(verifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wh_1", timestamp: "123", signature: "v1,sig", payload: "{raw}", secret: "whsec" }),
    );

    const row = await connectedAccountStore.findByConnectedAccountId("ca_1");
    expect(row?.status).toBe("EXPIRED");
  });

  it("returns 401 on signature verification failure", async () => {
    verifyMock.mockRejectedValue(new Error("invalid signature"));
    const out = await handleComposioWebhook("{}", { id: "wh", timestamp: "1", signature: "x" });
    expect(out.status).toBe(401);
  });

  it("ignores non-expired events with 200", async () => {
    verifyMock.mockResolvedValue({
      version: "V3",
      payload: { triggerSlug: "composio.trigger.message", payload: {} },
      rawPayload: {},
    });
    const out = await handleComposioWebhook("{}", { id: "wh", timestamp: "1", signature: "x" });
    expect(out.status).toBe(200);
    expect(out.body.handled).toBe("ignored");
  });

  it("acks an unknown/foreign account with 200 (no retry)", async () => {
    verifyMock.mockResolvedValue(expiredEvent("ca_unknown"));
    const out = await handleComposioWebhook("{}", { id: "wh", timestamp: "1", signature: "x" });
    expect(out.status).toBe(200);
    expect(out.body.handled).toBe("unknown-account");
  });

  it("returns 503 when Composio is not enabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    const out = await handleComposioWebhook("{}", {});
    expect(out.status).toBe(503);
    expect(getBroker).not.toHaveBeenCalled();
  });

  it("returns 503 when the webhook secret is missing", async () => {
    delete process.env.COMPOSIO_WEBHOOK_SECRET;
    const out = await handleComposioWebhook("{}", {});
    expect(out.status).toBe(503);
    expect(getBroker).not.toHaveBeenCalled();
  });
});
