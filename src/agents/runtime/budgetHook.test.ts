import { describe, expect, it, jest } from "@jest/globals";
import type { Pool, QueryResult } from "pg";

import { createBudgetHook } from "./budgetHook";

const WS = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";

function makePool(...rowsBatches: Array<Array<Record<string, unknown>>>): Pool {
  const query = jest.fn<() => Promise<QueryResult>>();
  for (const rows of rowsBatches) {
    query.mockResolvedValueOnce({ rows } as unknown as QueryResult);
  }
  return { query } as unknown as Pool;
}

describe("createBudgetHook", () => {
  it("allows the tool call when no monthly cap is set", async () => {
    const pool = makePool([{ budget_monthly_usd: 0 }]);
    const hook = createBudgetHook({ pool, workspaceId: WS, agentId: AGENT });
    const decision = await hook.preToolUse?.({ toolName: "save_memory", toolInput: {} });
    expect(decision).toBeUndefined();
  });

  it("allows the tool call when spent < cap", async () => {
    const pool = makePool(
      [{ budget_monthly_usd: 100 }],
      [{ total: 25 }],
    );
    const hook = createBudgetHook({ pool, workspaceId: WS, agentId: AGENT });
    const decision = await hook.preToolUse?.({ toolName: "save_memory", toolInput: {} });
    expect(decision).toBeUndefined();
  });

  it("blocks the tool call when spent >= cap", async () => {
    const pool = makePool(
      [{ budget_monthly_usd: 50 }],
      [{ total: 50 }],
    );
    const hook = createBudgetHook({ pool, workspaceId: WS, agentId: AGENT });
    const decision = await hook.preToolUse?.({ toolName: "send_email", toolInput: {} });
    expect(decision).toBeDefined();
    expect(decision?.continue).toBe(false);
    expect(decision?.reason).toMatch(/budget/i);
    expect(decision?.reason).toMatch(/send_email/);
  });

  it("does not throw when the DB lookup fails", async () => {
    const query = jest.fn(() => Promise.reject(new Error("db down")));
    const pool = { query } as unknown as Pool;
    const hook = createBudgetHook({ pool, workspaceId: WS, agentId: AGENT });
    const decision = await hook.preToolUse?.({ toolName: "tool", toolInput: {} });
    expect(decision).toBeUndefined();
  });

  // HEL-479 regression: the spend table was renamed control_plane_spend_entries
  // → spend_entries (migration 021). The decision tests above mock pool.query,
  // so they pass regardless of the table name; assert the emitted SQL targets
  // the live table so the rename can't silently regress enforcement again.
  it("queries the renamed spend_entries table (not control_plane_spend_entries)", async () => {
    const query = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();
    query
      .mockResolvedValueOnce({ rows: [{ budget_monthly_usd: 100 }] } as unknown as QueryResult)
      .mockResolvedValueOnce({ rows: [{ total: 10 }] } as unknown as QueryResult);
    const pool = { query } as unknown as Pool;
    const hook = createBudgetHook({ pool, workspaceId: WS, agentId: AGENT });
    await hook.preToolUse?.({ toolName: "save_memory", toolInput: {} });

    const spendSql = String(query.mock.calls[1]?.[0] ?? "");
    expect(spendSql).toMatch(/\bFROM\s+spend_entries\b/);
    expect(spendSql).not.toMatch(/control_plane_spend_entries/);
  });
});
