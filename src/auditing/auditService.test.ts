import type { Pool, PoolClient } from "pg";

const mockWithWorkspaceContext = jest.fn();

jest.mock("../middleware/workspaceContext", () => ({
  withWorkspaceContext: (
    pool: Pool,
    ctx: { workspaceId: string; userId: string },
    fn: (client: PoolClient) => Promise<unknown>,
  ) => mockWithWorkspaceContext(pool, ctx, fn),
}));

jest.mock("../db/postgres", () => ({
  getPostgresPool: () => ({} as Pool),
}));

import { recordAction, recordActionWithin } from "./auditService";

function makeClient(): PoolClient {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  } as unknown as PoolClient;
}

beforeEach(() => {
  mockWithWorkspaceContext.mockReset();
});

describe("recordAction", () => {
  it("emits a single insert inside withWorkspaceContext", async () => {
    const client = makeClient();
    mockWithWorkspaceContext.mockImplementation((_pool, _ctx, fn) => fn(client));

    await recordAction(
      {
        workspaceId: "ws-1",
        userId: "u-1",
        actorUserId: "u-1",
        actorAgentId: null,
      },
      {
        category: "provisioning",
        action: "company.create",
        target: { type: "provisioned_company", id: "co-1" },
        metadata: { region: "us-east-1" },
      },
      {} as Pool,
    );

    expect(mockWithWorkspaceContext).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (client.query as jest.Mock).mock.calls[0];
    expect(sql).toMatch(/INSERT INTO control_plane_audit_log/);
    expect(params).toEqual([
      "ws-1",
      "u-1",
      null,
      "provisioning",
      "company.create",
      "provisioned_company",
      "co-1",
      JSON.stringify({ region: "us-east-1" }),
    ]);
  });

  it("forwards the workspace context (workspaceId + userId) so RLS sees the right session vars", async () => {
    const client = makeClient();
    mockWithWorkspaceContext.mockImplementation((_pool, _ctx, fn) => fn(client));

    await recordAction(
      {
        workspaceId: "ws-9",
        userId: "u-9",
        actorUserId: null,
        actorAgentId: "agent-9",
      },
      { category: "execution", action: "exec.start" },
      {} as Pool,
    );

    const ctx = mockWithWorkspaceContext.mock.calls[0][1];
    expect(ctx).toEqual({ workspaceId: "ws-9", userId: "u-9" });
  });

  it("rejects entries with no actor (matches the DB CHECK constraint)", async () => {
    await expect(
      recordAction(
        { workspaceId: "ws-1", userId: "u-1" },
        { category: "auth", action: "login" },
        {} as Pool,
      ),
    ).rejects.toThrow(/audit_actor_required/);
    expect(mockWithWorkspaceContext).not.toHaveBeenCalled();
  });

  it("rejects empty action strings", async () => {
    mockWithWorkspaceContext.mockImplementation((_pool, _ctx, fn) => fn(makeClient()));
    await expect(
      recordAction(
        { workspaceId: "ws-1", userId: "u-1", actorUserId: "u-1" },
        { category: "auth", action: "  " },
        {} as Pool,
      ),
    ).rejects.toThrow(/audit_action_required/);
  });

  it("rejects action strings longer than 64 chars (matches DB CHECK)", async () => {
    mockWithWorkspaceContext.mockImplementation((_pool, _ctx, fn) => fn(makeClient()));
    const longAction = "a".repeat(65);
    await expect(
      recordAction(
        { workspaceId: "ws-1", userId: "u-1", actorUserId: "u-1" },
        { category: "auth", action: longAction },
        {} as Pool,
      ),
    ).rejects.toThrow(/audit_action_too_long/);
  });

  it("serializes metadata to JSON and writes null when absent", async () => {
    const client = makeClient();
    mockWithWorkspaceContext.mockImplementation((_pool, _ctx, fn) => fn(client));

    await recordAction(
      { workspaceId: "ws-1", userId: "u-1", actorUserId: "u-1" },
      { category: "auth", action: "login" },
      {} as Pool,
    );

    const params = (client.query as jest.Mock).mock.calls[0][1];
    expect(params[5]).toBeNull(); // target_type
    expect(params[6]).toBeNull(); // target_id
    expect(params[7]).toBeNull(); // metadata
  });
});

describe("recordActionWithin", () => {
  it("does not begin a new transaction; inserts on the supplied client", async () => {
    const client = makeClient();
    await recordActionWithin(
      client,
      { workspaceId: "ws-2", userId: "u-2", actorAgentId: "agent-2" },
      { category: "agent_lifecycle", action: "agent.create", target: { type: "agent", id: "a-1" } },
    );

    expect(mockWithWorkspaceContext).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
    const params = (client.query as jest.Mock).mock.calls[0][1];
    expect(params[0]).toBe("ws-2");
    expect(params[1]).toBeNull();
    expect(params[2]).toBe("agent-2");
    expect(params[3]).toBe("agent_lifecycle");
    expect(params[4]).toBe("agent.create");
  });
});
