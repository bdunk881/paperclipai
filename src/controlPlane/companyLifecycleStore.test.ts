const mockIsPostgresConfigured = jest.fn();
const mockQueryPostgres = jest.fn();

jest.mock("../db/postgres", () => ({
  isPostgresConfigured: () => mockIsPostgresConfigured(),
  queryPostgres: (...args: unknown[]) => mockQueryPostgres(...args),
}));

import { companyLifecycleStore } from "./companyLifecycleStore";

describe("companyLifecycleStore", () => {
  beforeEach(() => {
    companyLifecycleStore.clear();
    mockIsPostgresConfigured.mockReset();
    mockQueryPostgres.mockReset();
  });

  it("returns an active default state when persistence is disabled", async () => {
    mockIsPostgresConfigured.mockReturnValue(false);

    await expect(companyLifecycleStore.getState("user-1")).resolves.toMatchObject({
      userId: "user-1",
      status: "active",
    });
  });

  it("persists pause and resume audit entries when postgres is configured", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const paused = await companyLifecycleStore.applyAction({
      userId: "user-1",
      action: "pause",
      runId: "run-pause",
      reason: "Emergency",
      affectedTeamIds: ["team-1"],
      affectedAgentIds: ["agent-1"],
    });

    expect(paused.state.status).toBe("paused");
    expect(paused.auditEntry.runId).toBe("run-pause");

    const resumed = await companyLifecycleStore.applyAction({
      userId: "user-1",
      action: "resume",
      runId: "run-resume",
      affectedTeamIds: ["team-1"],
      affectedAgentIds: ["agent-1"],
    });

    expect(resumed.state.status).toBe("active");

    const state = await companyLifecycleStore.getState("user-1");
    expect(state.status).toBe("active");

    const auditTrail = await companyLifecycleStore.listAudit("user-1");
    expect(auditTrail).toHaveLength(2);
    expect(auditTrail[0]).toMatchObject({ action: "pause", runId: "run-pause" });
    expect(auditTrail[1]).toMatchObject({ action: "resume", runId: "run-resume" });
    expect(mockQueryPostgres).toHaveBeenCalledTimes(6);
  });
});
