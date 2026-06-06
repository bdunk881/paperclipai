import {
  executeComposioTool,
  resolveActiveConnectedAccount,
  listComposioToolsForToolkit,
} from "./toolExecution";
import { getComposioBroker } from "./client";
import { connectedAccountStore, type ComposioWorkspaceContext } from "./connectedAccountStore";

jest.mock("./client", () => ({
  getComposioBroker: jest.fn(),
  resetComposioBrokerForTests: jest.fn(),
}));

const getBroker = getComposioBroker as jest.MockedFunction<typeof getComposioBroker>;

// In jest, isPostgresConfigured() is false and AUTOFLOW_ALLOW_INMEMORY=true
// (jest.env.cjs), so the store exercises its in-memory backend.
describe("toolExecution (HEL-752 / P3-0)", () => {
  const ORIGINAL_ENV = { ...process.env };
  const executeMock = jest.fn();
  const getRawToolsMock = jest.fn();
  const ctx: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };

  beforeEach(() => {
    jest.clearAllMocks();
    connectedAccountStore.__resetForTests();
    process.env = {
      ...ORIGINAL_ENV,
      COMPOSIO_ENABLED: "true",
      COMPOSIO_API_KEY: "ck_test",
    };
    getBroker.mockResolvedValue({
      tools: { execute: executeMock, getRawComposioTools: getRawToolsMock },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function seedActive(toolkit: string, caId: string) {
    await connectedAccountStore.upsert(ctx, {
      toolkit,
      connectedAccountId: caId,
      authConfigId: `ac_${caId}`,
      status: "ACTIVE",
    });
  }

  describe("executeComposioTool", () => {
    it("executes against the workspace's active connection, scoped by the ws_ tenancy id", async () => {
      await seedActive("github", "ca_1");
      executeMock.mockResolvedValue({ data: { issue: 42 }, successful: true, error: null });

      const result = await executeComposioTool({
        workspaceId: "ws-A",
        userId: "user-A",
        toolkit: "github",
        slug: "GITHUB_CREATE_ISSUE",
        arguments: { title: "Bug" },
      });

      expect(executeMock).toHaveBeenCalledWith("GITHUB_CREATE_ISSUE", {
        userId: "ws_ws-A",
        connectedAccountId: "ca_1",
        arguments: { title: "Bug" },
      });
      expect(result).toEqual({
        successful: true,
        data: { issue: 42 },
        error: null,
        connectedAccountId: "ca_1",
      });
    });

    it("surfaces a failed execution without throwing", async () => {
      await seedActive("github", "ca_1");
      executeMock.mockResolvedValue({ data: null, successful: false, error: "rate limited" });

      const result = await executeComposioTool({
        workspaceId: "ws-A",
        userId: "user-A",
        toolkit: "github",
        slug: "GITHUB_CREATE_ISSUE",
        arguments: {},
      });

      expect(result).toMatchObject({ successful: false, data: null, error: "rate limited" });
    });

    it("throws when the workspace has no active connection for the toolkit", async () => {
      await connectedAccountStore.upsert(ctx, {
        toolkit: "github",
        connectedAccountId: "ca_init",
        authConfigId: "ac_init",
        status: "INITIATED",
      });

      await expect(
        executeComposioTool({
          workspaceId: "ws-A",
          userId: "user-A",
          toolkit: "github",
          slug: "GITHUB_CREATE_ISSUE",
          arguments: {},
        }),
      ).rejects.toThrow(/No active github connection/);
      expect(executeMock).not.toHaveBeenCalled();
    });

    it("honors an explicit ACTIVE connectionId", async () => {
      await seedActive("github", "ca_a");
      await seedActive("github", "ca_b");
      executeMock.mockResolvedValue({ data: {}, successful: true, error: null });

      await executeComposioTool({
        workspaceId: "ws-A",
        userId: "user-A",
        toolkit: "github",
        slug: "GITHUB_CREATE_ISSUE",
        arguments: {},
        connectionId: "ca_b",
      });

      expect(executeMock).toHaveBeenCalledWith(
        "GITHUB_CREATE_ISSUE",
        expect.objectContaining({ connectedAccountId: "ca_b" }),
      );
    });

    it("rejects when Composio is disabled, without touching the broker", async () => {
      delete process.env.COMPOSIO_API_KEY;
      await expect(
        executeComposioTool({
          workspaceId: "ws-A",
          userId: "user-A",
          toolkit: "github",
          slug: "GITHUB_CREATE_ISSUE",
          arguments: {},
        }),
      ).rejects.toThrow(/not enabled/);
      expect(getBroker).not.toHaveBeenCalled();
    });
  });

  describe("resolveActiveConnectedAccount", () => {
    it("picks the ACTIVE connection and rejects a non-ACTIVE explicit id", async () => {
      await seedActive("slack", "ca_live");
      await expect(resolveActiveConnectedAccount(ctx, "slack")).resolves.toMatchObject({
        connectedAccountId: "ca_live",
      });

      await connectedAccountStore.upsert(ctx, {
        toolkit: "slack",
        connectedAccountId: "ca_dead",
        authConfigId: "ac_dead",
        status: "EXPIRED",
      });
      await expect(resolveActiveConnectedAccount(ctx, "slack", "ca_dead")).rejects.toThrow(
        /is EXPIRED, not ACTIVE/,
      );
    });
  });

  describe("listComposioToolsForToolkit", () => {
    it("returns [] when disabled and the SDK tool list when enabled", async () => {
      delete process.env.COMPOSIO_API_KEY;
      await expect(listComposioToolsForToolkit({ toolkit: "github" })).resolves.toEqual([]);

      process.env.COMPOSIO_API_KEY = "ck_test";
      getRawToolsMock.mockResolvedValue([{ slug: "GITHUB_CREATE_ISSUE" }]);
      await expect(listComposioToolsForToolkit({ toolkit: "github", limit: 5 })).resolves.toEqual([
        { slug: "GITHUB_CREATE_ISSUE" },
      ]);
      expect(getRawToolsMock).toHaveBeenCalledWith({ toolkits: ["github"], limit: 5 });
    });
  });
});
