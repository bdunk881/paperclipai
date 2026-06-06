import {
  connectedAccountStore,
  type ComposioWorkspaceContext,
} from "./connectedAccountStore";

// In jest, isPostgresConfigured() is false and AUTOFLOW_ALLOW_INMEMORY=true
// (jest.env.cjs), so the store exercises its in-memory backend.
describe("connectedAccountStore (in-memory backend)", () => {
  const ctxA: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };
  const ctxB: ComposioWorkspaceContext = { workspaceId: "ws-B", userId: "user-B" };

  beforeEach(() => {
    connectedAccountStore.__resetForTests();
  });

  it("upserts a new account defaulting to INITIATED", async () => {
    const row = await connectedAccountStore.upsert(ctxA, {
      toolkit: "github",
      connectedAccountId: "ca_1",
      authConfigId: "ac_1",
    });

    expect(row.status).toBe("INITIATED");
    expect(row.workspaceId).toBe("ws-A");
    expect(row.toolkit).toBe("github");
    expect(row.connectedAccountId).toBe("ca_1");
    expect(row.metadata).toEqual({});
    expect(row.id).toBeTruthy();
  });

  it("returns an account only for its owning workspace (tenancy isolation)", async () => {
    await connectedAccountStore.upsert(ctxA, {
      toolkit: "github",
      connectedAccountId: "ca_1",
      authConfigId: "ac_1",
    });

    await expect(connectedAccountStore.getByConnectedAccountId(ctxA, "ca_1")).resolves.toMatchObject(
      { connectedAccountId: "ca_1" },
    );
    // Workspace B must NOT see workspace A's account.
    await expect(connectedAccountStore.getByConnectedAccountId(ctxB, "ca_1")).resolves.toBeNull();
  });

  it("upsert is idempotent — re-upserting the same ca_ updates status and keeps id/createdAt", async () => {
    const first = await connectedAccountStore.upsert(ctxA, {
      toolkit: "github",
      connectedAccountId: "ca_1",
      authConfigId: "ac_1",
    });

    const second = await connectedAccountStore.upsert(ctxA, {
      toolkit: "github",
      connectedAccountId: "ca_1",
      authConfigId: "ac_1",
      status: "ACTIVE",
    });

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.status).toBe("ACTIVE");

    const all = await connectedAccountStore.listByWorkspace(ctxA);
    expect(all).toHaveLength(1);
  });

  it("markStatus updates the owning workspace and refuses foreign accounts", async () => {
    await connectedAccountStore.upsert(ctxA, {
      toolkit: "github",
      connectedAccountId: "ca_1",
      authConfigId: "ac_1",
    });

    await expect(connectedAccountStore.markStatus(ctxA, "ca_1", "EXPIRED")).resolves.toBe(true);
    await expect(connectedAccountStore.getByConnectedAccountId(ctxA, "ca_1")).resolves.toMatchObject(
      { status: "EXPIRED" },
    );
    // Foreign workspace cannot mutate, and a missing id returns false.
    await expect(connectedAccountStore.markStatus(ctxB, "ca_1", "ACTIVE")).resolves.toBe(false);
    await expect(connectedAccountStore.markStatus(ctxA, "ca_missing", "ACTIVE")).resolves.toBe(false);
  });

  it("lists scope to the workspace and filter by toolkit", async () => {
    await connectedAccountStore.upsert(ctxA, {
      toolkit: "github",
      connectedAccountId: "ca_gh",
      authConfigId: "ac_gh",
    });
    await connectedAccountStore.upsert(ctxA, {
      toolkit: "slack",
      connectedAccountId: "ca_sl",
      authConfigId: "ac_sl",
    });
    await connectedAccountStore.upsert(ctxB, {
      toolkit: "github",
      connectedAccountId: "ca_other",
      authConfigId: "ac_other",
    });

    const aAll = await connectedAccountStore.listByWorkspace(ctxA);
    expect(aAll.map((r) => r.connectedAccountId).sort()).toEqual(["ca_gh", "ca_sl"]);

    const aGithub = await connectedAccountStore.listByToolkit(ctxA, "github");
    expect(aGithub.map((r) => r.connectedAccountId)).toEqual(["ca_gh"]);
  });

  it("deletes the owning workspace's account and refuses foreign deletes", async () => {
    await connectedAccountStore.upsert(ctxA, {
      toolkit: "github",
      connectedAccountId: "ca_1",
      authConfigId: "ac_1",
    });

    await expect(connectedAccountStore.deleteByConnectedAccountId(ctxB, "ca_1")).resolves.toBe(false);
    await expect(connectedAccountStore.deleteByConnectedAccountId(ctxA, "ca_1")).resolves.toBe(true);
    await expect(connectedAccountStore.getByConnectedAccountId(ctxA, "ca_1")).resolves.toBeNull();
  });
});
