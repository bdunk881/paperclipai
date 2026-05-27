import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import { createRequirePlatformAdmin } from "./requirePlatformAdmin";

interface MockClient {
  client: PoolClient;
  queries: Array<{ sql: string; args: unknown[] }>;
  release: jest.Mock;
}

function mockClient(profileFlag: boolean | null): MockClient {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const release = jest.fn();
  const client = {
    async query(sql: string | { text: string }, args?: unknown[]) {
      const text = typeof sql === "string" ? sql : sql.text;
      queries.push({ sql: text, args: args ?? [] });
      if (text.startsWith("SELECT is_platform_admin")) {
        return profileFlag === null
          ? { rows: [], rowCount: 0 }
          : { rows: [{ is_platform_admin: profileFlag }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release,
  } as unknown as PoolClient;
  return { client, queries, release };
}

function mockPool(client: PoolClient): Pool {
  return { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
}

interface MockRes extends EventEmitter {
  statusCode: number;
  status: (n: number) => MockRes;
  json: jest.Mock;
}

function mockRes(): MockRes {
  const emitter = new EventEmitter() as MockRes;
  emitter.statusCode = 200;
  emitter.json = jest.fn();
  emitter.status = function (n: number) {
    this.statusCode = n;
    return this;
  };
  return emitter;
}

describe("requirePlatformAdmin", () => {
  it("denies callers without an authenticated user", async () => {
    const { client } = mockClient(false);
    const middleware = createRequirePlatformAdmin(mockPool(client));
    const req = {} as unknown as Parameters<typeof middleware>[0];
    const res = mockRes();
    const next = jest.fn();
    await middleware(req, res as unknown as Parameters<typeof middleware>[1], next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("denies a logged-in user without the flag or env allowlist", async () => {
    const { client, queries, release } = mockClient(false);
    const middleware = createRequirePlatformAdmin(mockPool(client), {
      isAllowlistedStaff: () => false,
    });
    const req = { auth: { sub: "user-1" } } as unknown as Parameters<typeof middleware>[0];
    const res = mockRes();
    const next = jest.fn();
    await middleware(req, res as unknown as Parameters<typeof middleware>[1], next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    // ROLLBACK should have been issued before release
    expect(queries.some((q) => q.sql === "ROLLBACK")).toBe(true);
  });

  it("admits a flagged user, sets the GUC, and exposes the PoolClient on req", async () => {
    const { client, queries } = mockClient(true);
    const middleware = createRequirePlatformAdmin(mockPool(client));
    const req = { auth: { sub: "user-1" } } as unknown as Parameters<typeof middleware>[0] & {
      platformAdmin?: { userId: string };
      platformAdminDb?: PoolClient;
    };
    const res = mockRes();
    const next = jest.fn();
    await middleware(req, res as unknown as Parameters<typeof middleware>[1], next);
    expect(next).toHaveBeenCalledWith();
    expect(req.platformAdmin?.userId).toBe("user-1");
    expect(req.platformAdminDb).toBe(client);
    // SET the session GUC inside the BEGIN..(eventual)COMMIT scope.
    expect(queries.some((q) => /set_config\('app\.is_platform_admin'/.test(q.sql))).toBe(true);
  });

  it("commits on a 2xx response", async () => {
    const { client, queries, release } = mockClient(true);
    const middleware = createRequirePlatformAdmin(mockPool(client));
    const req = { auth: { sub: "user-1" } } as unknown as Parameters<typeof middleware>[0];
    const res = mockRes();
    const next = jest.fn();
    await middleware(req, res as unknown as Parameters<typeof middleware>[1], next);
    res.statusCode = 200;
    res.emit("finish");
    await new Promise((r) => setImmediate(r));
    expect(queries.some((q) => q.sql === "COMMIT")).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it("rolls back on a 5xx response", async () => {
    const { client, queries, release } = mockClient(true);
    const middleware = createRequirePlatformAdmin(mockPool(client));
    const req = { auth: { sub: "user-1" } } as unknown as Parameters<typeof middleware>[0];
    const res = mockRes();
    const next = jest.fn();
    await middleware(req, res as unknown as Parameters<typeof middleware>[1], next);
    res.statusCode = 500;
    res.emit("finish");
    await new Promise((r) => setImmediate(r));
    expect(queries.some((q) => q.sql === "ROLLBACK")).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it("respects the env-var allowlist override when the profile row is missing", async () => {
    const { client } = mockClient(null);
    const middleware = createRequirePlatformAdmin(mockPool(client), {
      isAllowlistedStaff: (id) => id === "user-1",
    });
    const req = { auth: { sub: "user-1" } } as unknown as Parameters<typeof middleware>[0];
    const res = mockRes();
    const next = jest.fn();
    await middleware(req, res as unknown as Parameters<typeof middleware>[1], next);
    expect(next).toHaveBeenCalledWith();
  });
});
