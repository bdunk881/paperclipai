import type { Pool, PoolClient } from "pg";
import { withUserContext } from "./workspaceContext";

function makeClient(overrides: Partial<{ query: jest.Mock; release: jest.Mock }> = {}): PoolClient {
  const query = overrides.query ?? jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const release = overrides.release ?? jest.fn();
  return { query, release } as unknown as PoolClient;
}

function makePool(client: PoolClient): Pool {
  return { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
}

describe("withUserContext", () => {
  it("sets app.current_user_id, commits, and returns the fn result", async () => {
    const client = makeClient();
    const pool = makePool(client);

    const result = await withUserContext(pool, "user-abc", async (c) => {
      await c.query("SELECT 1");
      return "done";
    });

    expect(result).toBe("done");
    const calls = (client.query as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toMatch(/set_config.*app\.current_user_id/);
    expect(calls[2]).toBe("SELECT 1");
    expect(calls[3]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("passes userId as the set_config parameter", async () => {
    const client = makeClient();
    const pool = makePool(client);

    await withUserContext(pool, "user-xyz", async () => undefined);

    const setConfigCall = (client.query as jest.Mock).mock.calls[1] as [string, string[]];
    expect(setConfigCall[1]).toEqual(["user-xyz"]);
  });

  it("rolls back and releases the connection on fn error", async () => {
    const client = makeClient();
    const pool = makePool(client);
    const boom = new Error("boom");

    await expect(
      withUserContext(pool, "user-abc", async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const calls = (client.query as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("releases the connection even when ROLLBACK itself throws", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // set_config
      .mockRejectedValueOnce(new Error("fn error")) // fn body
      .mockRejectedValueOnce(new Error("rollback error")); // ROLLBACK
    const client = makeClient({ query });
    const pool = makePool(client);

    await expect(withUserContext(pool, "user-abc", async (c) => c.query("boom"))).rejects.toThrow(
      "fn error",
    );

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("does not share GUC state between two sequential calls", async () => {
    const client1 = makeClient();
    const client2 = makeClient();
    const pool = {
      connect: jest
        .fn()
        .mockResolvedValueOnce(client1)
        .mockResolvedValueOnce(client2),
    } as unknown as Pool;

    await withUserContext(pool, "user-1", async () => undefined);
    await withUserContext(pool, "user-2", async () => undefined);

    const user1Calls = (client1.query as jest.Mock).mock.calls;
    const user2Calls = (client2.query as jest.Mock).mock.calls;

    const configParam1 = (user1Calls[1] as [string, string[]])[1][0];
    const configParam2 = (user2Calls[1] as [string, string[]])[1][0];
    expect(configParam1).toBe("user-1");
    expect(configParam2).toBe("user-2");
  });
});
