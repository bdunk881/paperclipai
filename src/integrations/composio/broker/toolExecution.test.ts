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
      COMPOSIO_RATELIMIT_BASE_DELAY_MS: "1", // keep retry backoff near-instant in tests
    };
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
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

    it("surfaces a non-retryable failed execution immediately (no retry)", async () => {
      await seedActive("github", "ca_1");
      executeMock.mockResolvedValue({ data: null, successful: false, error: "permission denied" });

      const result = await executeComposioTool({
        workspaceId: "ws-A",
        userId: "user-A",
        toolkit: "github",
        slug: "GITHUB_CREATE_ISSUE",
        arguments: {},
      });

      expect(result).toMatchObject({ successful: false, data: null, error: "permission denied" });
      expect(executeMock).toHaveBeenCalledTimes(1);
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

    // HEL-770 (P6a): rate-limit retry + observability.
    it("retries a thrown 429 then succeeds (rate-limited request was not executed)", async () => {
      await seedActive("github", "ca_1");
      executeMock
        .mockRejectedValueOnce({ status: 429, message: "Too Many Requests" })
        .mockResolvedValueOnce({ data: { ok: 1 }, successful: true, error: null });

      const result = await executeComposioTool({
        workspaceId: "ws-A",
        userId: "user-A",
        toolkit: "github",
        slug: "GITHUB_CREATE_ISSUE",
        arguments: {},
      });

      expect(result).toMatchObject({ successful: true, data: { ok: 1 } });
      expect(executeMock).toHaveBeenCalledTimes(2);
    });

    it("retries a rate-limited RESULT then succeeds", async () => {
      await seedActive("github", "ca_1");
      executeMock
        .mockResolvedValueOnce({ data: null, successful: false, error: "Rate limit exceeded" })
        .mockResolvedValueOnce({ data: { ok: 1 }, successful: true, error: null });

      const result = await executeComposioTool({
        workspaceId: "ws-A",
        userId: "user-A",
        toolkit: "github",
        slug: "GITHUB_CREATE_ISSUE",
        arguments: {},
      });

      expect(result).toMatchObject({ successful: true });
      expect(executeMock).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry a non-429 thrown error (the action may have executed)", async () => {
      await seedActive("github", "ca_1");
      executeMock.mockRejectedValue(new Error("500 internal server error"));

      await expect(
        executeComposioTool({
          workspaceId: "ws-A",
          userId: "user-A",
          toolkit: "github",
          slug: "GITHUB_CREATE_ISSUE",
          arguments: {},
        }),
      ).rejects.toThrow(/500 internal/);
      expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it("gives up after the retry budget on a persistent 429", async () => {
      await seedActive("github", "ca_1");
      executeMock.mockRejectedValue({ status: 429, message: "Too Many Requests" });

      await expect(
        executeComposioTool({
          workspaceId: "ws-A",
          userId: "user-A",
          toolkit: "github",
          slug: "GITHUB_CREATE_ISSUE",
          arguments: {},
        }),
      ).rejects.toMatchObject({ status: 429 });
      expect(executeMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it("emits a structured observability record on success", async () => {
      await seedActive("github", "ca_1");
      executeMock.mockResolvedValue({ data: {}, successful: true, error: null });

      await executeComposioTool({
        workspaceId: "ws-A",
        userId: "user-A",
        toolkit: "github",
        slug: "GITHUB_CREATE_ISSUE",
        arguments: {},
      });

      expect(console.log as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining("[composio] execute toolkit=github slug=GITHUB_CREATE_ISSUE"),
      );
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
