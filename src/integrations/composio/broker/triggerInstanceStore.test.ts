import {
  triggerInstanceStore,
  type ComposioWorkspaceContext,
  type CreateTriggerInstanceInput,
} from "./triggerInstanceStore";

// In jest, isPostgresConfigured() is false and AUTOFLOW_ALLOW_INMEMORY=true
// (jest.env.cjs), so the store exercises its in-memory backend.
describe("triggerInstanceStore (in-memory backend)", () => {
  const ctxA: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };
  const ctxB: ComposioWorkspaceContext = { workspaceId: "ws-B", userId: "user-B" };

  const baseInput = (over: Partial<CreateTriggerInstanceInput> = {}): CreateTriggerInstanceInput => ({
    agentId: "agent-1",
    toolkit: "github",
    triggerSlug: "GITHUB_COMMIT_EVENT",
    triggerId: "ti_1",
    connectedAccountId: "ca_1",
    ...over,
  });

  beforeEach(() => {
    triggerInstanceStore.__resetForTests();
  });

  it("creates a new instance defaulting to ENABLED", async () => {
    const row = await triggerInstanceStore.create(ctxA, baseInput());

    expect(row.status).toBe("ENABLED");
    expect(row.workspaceId).toBe("ws-A");
    expect(row.agentId).toBe("agent-1");
    expect(row.toolkit).toBe("github");
    expect(row.triggerSlug).toBe("GITHUB_COMMIT_EVENT");
    expect(row.triggerId).toBe("ti_1");
    expect(row.connectedAccountId).toBe("ca_1");
    expect(row.triggerConfig).toEqual({});
    expect(row.id).toBeTruthy();
  });

  it("create is idempotent — re-creating the same ti_ updates binding/status, keeps id/createdAt", async () => {
    const first = await triggerInstanceStore.create(ctxA, baseInput({ triggerConfig: { repo: "a/b" } }));
    const second = await triggerInstanceStore.create(
      ctxA,
      baseInput({ agentId: "agent-2", status: "DISABLED", triggerConfig: { repo: "c/d" } }),
    );

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.agentId).toBe("agent-2");
    expect(second.status).toBe("DISABLED");
    expect(second.triggerConfig).toEqual({ repo: "c/d" });

    const all = await triggerInstanceStore.listByWorkspace(ctxA);
    expect(all).toHaveLength(1);
  });

  it("listByWorkspace scopes to the workspace (tenancy isolation)", async () => {
    await triggerInstanceStore.create(ctxA, baseInput({ triggerId: "ti_a1" }));
    await triggerInstanceStore.create(ctxA, baseInput({ triggerId: "ti_a2", toolkit: "slack" }));
    await triggerInstanceStore.create(ctxB, baseInput({ triggerId: "ti_b1" }));

    const aAll = await triggerInstanceStore.listByWorkspace(ctxA);
    expect(aAll.map((r) => r.triggerId).sort()).toEqual(["ti_a1", "ti_a2"]);

    const bAll = await triggerInstanceStore.listByWorkspace(ctxB);
    expect(bAll.map((r) => r.triggerId)).toEqual(["ti_b1"]);
  });

  it("markStatus updates the owning workspace and refuses foreign/missing", async () => {
    await triggerInstanceStore.create(ctxA, baseInput());

    await expect(triggerInstanceStore.markStatus(ctxA, "ti_1", "DISABLED")).resolves.toBe(true);
    await expect(triggerInstanceStore.findByTriggerId("ti_1")).resolves.toMatchObject({
      status: "DISABLED",
    });
    // Foreign workspace cannot mutate, and a missing id returns false.
    await expect(triggerInstanceStore.markStatus(ctxB, "ti_1", "ENABLED")).resolves.toBe(false);
    await expect(triggerInstanceStore.markStatus(ctxA, "ti_missing", "ENABLED")).resolves.toBe(false);
  });

  it("deleteByTriggerId deletes the owning workspace's row and refuses foreign deletes", async () => {
    await triggerInstanceStore.create(ctxA, baseInput());

    await expect(triggerInstanceStore.deleteByTriggerId(ctxB, "ti_1")).resolves.toBe(false);
    await expect(triggerInstanceStore.deleteByTriggerId(ctxA, "ti_1")).resolves.toBe(true);
    await expect(triggerInstanceStore.findByTriggerId("ti_1")).resolves.toBeNull();
  });

  it("findByTriggerId looks up across workspaces without a context (sessionless webhook)", async () => {
    await triggerInstanceStore.create(ctxA, baseInput({ triggerId: "ti_a" }));
    await triggerInstanceStore.create(ctxB, baseInput({ triggerId: "ti_b", toolkit: "slack" }));

    const found = await triggerInstanceStore.findByTriggerId("ti_b");
    expect(found?.triggerId).toBe("ti_b");
    expect(found?.workspaceId).toBe("ws-B");
    expect(found?.agentId).toBe("agent-1");
    await expect(triggerInstanceStore.findByTriggerId("ti_missing")).resolves.toBeNull();
  });
});
