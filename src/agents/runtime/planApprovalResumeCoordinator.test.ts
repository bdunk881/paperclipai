import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Pool, QueryResult } from "pg";

const mockResume = jest.fn<(args: {
  pool: Pool;
  approvalId: string;
}) => Promise<{ resumed: boolean; reason?: string }>>(
  async () => ({ resumed: true }),
);

jest.mock("./planApprovalBridge", () => {
  const actual = jest.requireActual<typeof import("./planApprovalBridge")>(
    "./planApprovalBridge",
  );
  return {
    ...actual,
    resumeApprovedPlan: (...args: unknown[]) => mockResume(...(args as [{ pool: Pool; approvalId: string }])),
  };
});

import { runPlanApprovalResumeSweep } from "./planApprovalResumeCoordinator";

function poolWith(rows: Array<{ id: string; comment: string | null }>) {
  const query = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>(
    (sql) => {
      if (sql.includes("SELECT")) {
        return Promise.resolve({ rows } as unknown as QueryResult);
      }
      return Promise.resolve({ rows: [] } as unknown as QueryResult);
    },
  );
  return { pool: { query } as unknown as Pool, query };
}

beforeEach(() => {
  mockResume.mockReset();
  mockResume.mockResolvedValue({ resumed: true });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("runPlanApprovalResumeSweep", () => {
  it("returns an empty result set when no approved plan rows exist", async () => {
    const { pool } = poolWith([]);
    const outcomes = await runPlanApprovalResumeSweep(pool);
    expect(outcomes).toEqual([]);
    expect(mockResume).not.toHaveBeenCalled();
  });

  it("calls resumeApprovedPlan for each pending row and stamps a success marker", async () => {
    const { pool, query } = poolWith([
      { id: "a1", comment: null },
      { id: "a2", comment: "earlier comment" },
    ]);
    const outcomes = await runPlanApprovalResumeSweep(pool);
    expect(outcomes).toEqual([
      { approvalId: "a1", resumed: true },
      { approvalId: "a2", resumed: true },
    ]);
    // 1 select + 2 UPDATEs
    expect(query).toHaveBeenCalledTimes(3);
    // The UPDATE call for a2 should preserve the prior comment.
    const update2 = query.mock.calls[2];
    expect(String(update2[1] && (update2[1] as unknown[])[1])).toContain("earlier comment");
    expect(String(update2[1] && (update2[1] as unknown[])[1])).toContain("[plan-resume:ok]");
  });

  it("stamps an error marker when the resume fails", async () => {
    mockResume.mockResolvedValueOnce({ resumed: false, reason: "agent_not_found" });
    const { pool, query } = poolWith([{ id: "a1", comment: null }]);
    const outcomes = await runPlanApprovalResumeSweep(pool);
    expect(outcomes[0]).toMatchObject({ resumed: false, reason: "agent_not_found" });
    const update = query.mock.calls[1];
    expect(String(update[1] && (update[1] as unknown[])[1])).toContain("[plan-resume:error] agent_not_found");
  });

  it("does not crash when the marker-stamp UPDATE itself fails", async () => {
    const { pool } = (() => {
      const query = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>(
        (sql) => {
          if (sql.includes("SELECT")) {
            return Promise.resolve(
              { rows: [{ id: "a1", comment: null }] } as unknown as QueryResult,
            );
          }
          return Promise.reject(new Error("update blew up"));
        },
      );
      return { pool: { query } as unknown as Pool };
    })();
    const outcomes = await runPlanApprovalResumeSweep(pool);
    expect(outcomes[0]?.resumed).toBe(true);
  });
});
