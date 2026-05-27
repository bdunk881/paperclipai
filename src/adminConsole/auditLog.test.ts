import { recordAdminAction } from "./auditLog";
import type { Pool } from "pg";

function mockPool(): { pool: Pool; query: jest.Mock } {
  const query = jest.fn().mockResolvedValue({ rows: [{ id: "aud-1" }], rowCount: 1 });
  return { pool: { query } as unknown as Pool, query };
}

describe("recordAdminAction", () => {
  it("inserts a row with the expected columns when params are valid", async () => {
    const { pool, query } = mockPool();
    const id = await recordAdminAction(pool, {
      adminUserId: "admin-1",
      action: "lookup_user",
      targetUserId: "user-1",
      reason: "Investigating support ticket #42",
      payload: { q: "alice@example.com" },
      context: { ip: "203.0.113.4", userAgent: "Mozilla/5.0" },
    });
    expect(id).toBe("aud-1");
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO platform_admin_audit_log/);
    expect(args).toEqual([
      "admin-1",
      "lookup_user",
      "user-1",
      null,
      "Investigating support ticket #42",
      JSON.stringify({ q: "alice@example.com" }),
      "203.0.113.4",
      "Mozilla/5.0",
    ]);
  });

  it("rejects unknown action verbs (whitelist)", async () => {
    const { pool, query } = mockPool();
    await expect(
      recordAdminAction(pool, {
        adminUserId: "admin-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        action: "destroy_universe" as any,
      }),
    ).rejects.toThrow(/unknown action/);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects missing adminUserId — every action must be attributable", async () => {
    const { pool, query } = mockPool();
    await expect(
      recordAdminAction(pool, { adminUserId: "", action: "lookup_user" }),
    ).rejects.toThrow(/adminUserId required/);
    expect(query).not.toHaveBeenCalled();
  });

  it("normalises a missing payload to an empty object so the column never sees NULL", async () => {
    const { query } = mockPool();
    await recordAdminAction({ query } as unknown as Pool, {
      adminUserId: "admin-1",
      action: "lookup_user",
    });
    expect(query.mock.calls[0][1][5]).toBe(JSON.stringify({}));
  });
});
