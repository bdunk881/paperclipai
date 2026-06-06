import {
  beginConnect,
  completeConnect,
  listConnections,
  disconnectAccount,
  normalizeConnectionStatus,
} from "./connectionService";
import { getComposioBroker } from "./client";
import { connectedAccountStore, type ComposioWorkspaceContext } from "./connectedAccountStore";
import { resetAuthConfigProvisioningForTests } from "./authConfigProvisioning";
import { clearConnectStateForTests } from "./connectStateStore";

jest.mock("./client", () => ({
  getComposioBroker: jest.fn(),
  resetComposioBrokerForTests: jest.fn(),
}));

const getBroker = getComposioBroker as jest.MockedFunction<typeof getComposioBroker>;

describe("connectionService (HEL-740)", () => {
  const ORIGINAL_ENV = { ...process.env };
  const ctx: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };

  const listMock = jest.fn();
  const createMock = jest.fn();
  const linkMock = jest.fn();
  const caListMock = jest.fn();
  const caDeleteMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetAuthConfigProvisioningForTests();
    connectedAccountStore.__resetForTests();
    clearConnectStateForTests();
    process.env = { ...ORIGINAL_ENV, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
    listMock.mockResolvedValue({ items: [] });
    createMock.mockResolvedValue({ id: "ac_gh" });
    linkMock.mockResolvedValue({
      id: "ca_1",
      redirectUrl: "https://backend.composio.dev/redirect/abc",
      status: "INITIALIZING",
    });
    caListMock.mockResolvedValue({ items: [] });
    caDeleteMock.mockResolvedValue(undefined);
    getBroker.mockResolvedValue({
      authConfigs: { list: listMock, create: createMock },
      connectedAccounts: { link: linkMock, list: caListMock, delete: caDeleteMock },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function stateFromLinkCall(): string {
    const callbackUrl = linkMock.mock.calls[0][2].callbackUrl as string;
    return new URL(callbackUrl).searchParams.get("state") ?? "";
  }

  it("beginConnect provisions the auth config, links, persists INITIATED, returns redirectUrl", async () => {
    const result = await beginConnect(ctx, "GitHub", {
      callbackBaseUrl: "https://api.test/",
      allowMultiple: false,
    });

    expect(result).toEqual({
      redirectUrl: "https://backend.composio.dev/redirect/abc",
      connectedAccountId: "ca_1",
      toolkit: "github",
    });

    // link called with the ws_-scoped userId, the provisioned ac_, and our callbackUrl.
    expect(linkMock).toHaveBeenCalledTimes(1);
    const [userId, authConfigId, opts] = linkMock.mock.calls[0];
    expect(userId).toBe("ws_ws-A");
    expect(authConfigId).toBe("ac_gh");
    expect(opts.callbackUrl).toContain("https://api.test/api/composio/callback?state=");
    expect(opts.allowMultiple).toBe(false);

    // INITIALIZING normalized to INITIATED and persisted under the workspace.
    const row = await connectedAccountStore.getByConnectedAccountId(ctx, "ca_1");
    expect(row).toMatchObject({ status: "INITIATED", toolkit: "github", authConfigId: "ac_gh" });
  });

  it("beginConnect throws when the broker is disabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await expect(
      beginConnect(ctx, "github", { callbackBaseUrl: "https://api.test" }),
    ).rejects.toThrow(/not enabled/i);
  });

  it("completeConnect(success) flips the row to ACTIVE for the owning workspace", async () => {
    await beginConnect(ctx, "github", { callbackBaseUrl: "https://api.test" });
    const state = stateFromLinkCall();

    const result = await completeConnect(state, { status: "success", connectedAccountId: "ca_1" });
    expect(result).toEqual({ status: "success", toolkit: "github" });

    const row = await connectedAccountStore.getByConnectedAccountId(ctx, "ca_1");
    expect(row?.status).toBe("ACTIVE");
  });

  it("completeConnect rejects an invalid/expired state", async () => {
    const result = await completeConnect("not-a-real-state", {
      status: "success",
      connectedAccountId: "ca_1",
    });
    expect(result.status).toBe("error");
    expect(result.toolkit).toBeNull();
  });

  it("completeConnect(failed) marks the row INACTIVE and returns error", async () => {
    await beginConnect(ctx, "github", { callbackBaseUrl: "https://api.test" });
    const state = stateFromLinkCall();

    const result = await completeConnect(state, { status: "failed", connectedAccountId: "ca_1" });
    expect(result.status).toBe("error");

    const row = await connectedAccountStore.getByConnectedAccountId(ctx, "ca_1");
    expect(row?.status).toBe("INACTIVE");
  });

  it("state is single-use — a replayed callback is rejected", async () => {
    await beginConnect(ctx, "github", { callbackBaseUrl: "https://api.test" });
    const state = stateFromLinkCall();

    await completeConnect(state, { status: "success", connectedAccountId: "ca_1" });
    const replay = await completeConnect(state, { status: "success", connectedAccountId: "ca_1" });
    expect(replay.status).toBe("error");
  });

  it("normalizeConnectionStatus folds the SDK status enum onto the store union", () => {
    expect(normalizeConnectionStatus("ACTIVE")).toBe("ACTIVE");
    expect(normalizeConnectionStatus("EXPIRED")).toBe("EXPIRED");
    expect(normalizeConnectionStatus("FAILED")).toBe("INACTIVE");
    expect(normalizeConnectionStatus("REVOKED")).toBe("INACTIVE");
    expect(normalizeConnectionStatus("INITIALIZING")).toBe("INITIATED");
    expect(normalizeConnectionStatus(undefined)).toBe("INITIATED");
  });

  describe("listConnections", () => {
    it("returns the workspace's connections as views (no drift)", async () => {
      await connectedAccountStore.upsert(ctx, {
        toolkit: "github",
        connectedAccountId: "ca_1",
        authConfigId: "ac_1",
        status: "INITIATED",
      });

      const views = await listConnections(ctx);
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({
        connectedAccountId: "ca_1",
        toolkit: "github",
        status: "INITIATED",
      });
    });

    it("reconciles drifted status from Composio and persists it", async () => {
      await connectedAccountStore.upsert(ctx, {
        toolkit: "github",
        connectedAccountId: "ca_1",
        authConfigId: "ac_1",
        status: "INITIATED",
      });
      caListMock.mockResolvedValue({
        items: [{ id: "ca_1", status: "ACTIVE", toolkit: { slug: "github" } }],
      });

      const views = await listConnections(ctx);
      expect(views[0].status).toBe("ACTIVE");
      expect(caListMock).toHaveBeenCalledWith({ userIds: ["ws_ws-A"] });

      const row = await connectedAccountStore.getByConnectedAccountId(ctx, "ca_1");
      expect(row?.status).toBe("ACTIVE");
    });

    it("falls back to local rows when the Composio list throws", async () => {
      await connectedAccountStore.upsert(ctx, {
        toolkit: "github",
        connectedAccountId: "ca_1",
        authConfigId: "ac_1",
        status: "INITIATED",
      });
      caListMock.mockRejectedValue(new Error("boom"));

      const views = await listConnections(ctx);
      expect(views).toHaveLength(1);
      expect(views[0].status).toBe("INITIATED");
    });

    it("short-circuits (no broker call) for an empty workspace", async () => {
      const views = await listConnections(ctx);
      expect(views).toEqual([]);
      expect(caListMock).not.toHaveBeenCalled();
    });
  });

  describe("disconnectAccount", () => {
    it("revokes at Composio and removes the local row", async () => {
      await connectedAccountStore.upsert(ctx, {
        toolkit: "github",
        connectedAccountId: "ca_1",
        authConfigId: "ac_1",
        status: "ACTIVE",
      });

      await expect(disconnectAccount(ctx, "ca_1")).resolves.toBe(true);
      expect(caDeleteMock).toHaveBeenCalledWith("ca_1");
      await expect(connectedAccountStore.getByConnectedAccountId(ctx, "ca_1")).resolves.toBeNull();
    });

    it("returns false for a ca_ not owned by the workspace", async () => {
      await expect(disconnectAccount(ctx, "ca_unknown")).resolves.toBe(false);
      expect(caDeleteMock).not.toHaveBeenCalled();
    });

    it("still removes the local row when the remote revoke fails (best-effort)", async () => {
      await connectedAccountStore.upsert(ctx, {
        toolkit: "github",
        connectedAccountId: "ca_1",
        authConfigId: "ac_1",
        status: "ACTIVE",
      });
      caDeleteMock.mockRejectedValue(new Error("revoke failed"));

      await expect(disconnectAccount(ctx, "ca_1")).resolves.toBe(true);
      await expect(connectedAccountStore.getByConnectedAccountId(ctx, "ca_1")).resolves.toBeNull();
    });
  });
});
