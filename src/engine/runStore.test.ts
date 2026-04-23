/**
 * Unit tests for the in-memory RunStore.
 */

import { runStore } from "./runStore";
import { WorkflowRun } from "../types/workflow";
import * as postgres from "../db/postgres";

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-test-001",
    templateId: "tpl-support-bot",
    templateName: "Customer Support Bot",
    status: "pending",
    startedAt: new Date().toISOString(),
    input: {},
    stepResults: [],
    ...overrides,
  };
}

beforeEach(() => {
  return runStore.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("runStore.create", () => {
  it("stores and returns the run", async () => {
    const run = makeRun();
    const result = await runStore.create(run);
    expect(result).toEqual(run);
  });

  it("can retrieve the created run via get()", async () => {
    const run = makeRun();
    await runStore.create(run);
    await expect(runStore.get(run.id)).resolves.toEqual(run);
  });
});

describe("runStore.get", () => {
  it("returns undefined for an unknown id", async () => {
    await expect(runStore.get("run-nope")).resolves.toBeUndefined();
  });

  it("returns the correct run by id", async () => {
    const runA = makeRun({ id: "run-a" });
    const runB = makeRun({ id: "run-b", templateId: "tpl-lead-enrichment" });
    await runStore.create(runA);
    await runStore.create(runB);
    await expect(runStore.get("run-a")).resolves.toEqual(runA);
    await expect(runStore.get("run-b")).resolves.toEqual(runB);
  });
});

describe("runStore.update", () => {
  it("returns undefined for an unknown id", async () => {
    await expect(runStore.update("run-nope", { status: "running" })).resolves.toBeUndefined();
  });

  it("patches the specified fields", async () => {
    const run = makeRun();
    await runStore.create(run);
    const updated = await runStore.update(run.id, { status: "running" });
    expect(updated?.status).toBe("running");
    expect(updated?.templateId).toBe(run.templateId);
  });

  it("persists updates across subsequent get() calls", async () => {
    const run = makeRun();
    await runStore.create(run);
    await runStore.update(run.id, { status: "completed", completedAt: "2024-01-01T00:00:00.000Z" });
    const fetched = await runStore.get(run.id);
    expect(fetched?.status).toBe("completed");
    expect(fetched?.completedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("does not mutate the original object", async () => {
    const run = makeRun();
    await runStore.create(run);
    await runStore.update(run.id, { status: "running" });
    expect(run.status).toBe("pending");
  });

  it("persists runtimeState snapshots", async () => {
    const run = makeRun();
    await runStore.create(run);
    await runStore.update(run.id, {
      runtimeState: {
        config: { mode: "test" },
        context: { ticketId: "T-1", revision: 2 },
        currentStepIndex: 1,
        waitingApprovalId: "approval-123",
      },
    });
    await expect(runStore.get(run.id)).resolves.toMatchObject({
      runtimeState: {
        config: { mode: "test" },
        context: { ticketId: "T-1", revision: 2 },
        currentStepIndex: 1,
        waitingApprovalId: "approval-123",
      },
    });
  });
});

describe("runStore.list", () => {
  it("returns an empty array when the store is empty", async () => {
    await expect(runStore.list()).resolves.toEqual([]);
  });

  it("returns all runs when no templateId filter is provided", async () => {
    await runStore.create(makeRun({ id: "run-1" }));
    await runStore.create(makeRun({ id: "run-2", templateId: "tpl-lead-enrichment" }));
    await expect(runStore.list()).resolves.toHaveLength(2);
  });

  it("filters by templateId", async () => {
    await runStore.create(makeRun({ id: "run-1", templateId: "tpl-support-bot" }));
    await runStore.create(makeRun({ id: "run-2", templateId: "tpl-lead-enrichment" }));
    await runStore.create(makeRun({ id: "run-3", templateId: "tpl-support-bot" }));

    const filtered = await runStore.list("tpl-support-bot");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.templateId === "tpl-support-bot")).toBe(true);
  });

  it("returns empty array when filtering by unknown templateId", async () => {
    await runStore.create(makeRun({ id: "run-1" }));
    await expect(runStore.list("tpl-unknown")).resolves.toEqual([]);
  });

  it("filters by userId", async () => {
    await runStore.create(makeRun({ id: "run-1", userId: "user-a" }));
    await runStore.create(makeRun({ id: "run-2", userId: "user-b" }));
    await runStore.create(makeRun({ id: "run-3" }));

    const filtered = await runStore.list(undefined, "user-a");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("run-1");
  });
});

describe("runStore.clear", () => {
  it("removes all runs", async () => {
    await runStore.create(makeRun({ id: "run-1" }));
    await runStore.create(makeRun({ id: "run-2" }));
    await runStore.clear();
    await expect(runStore.list()).resolves.toHaveLength(0);
  });
});

describe("runStore postgres persistence", () => {
  it("writes run rows and step results when persistence is enabled", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    const created = await runStore.create(
      makeRun({
        input: { customerId: "cust-1" },
        output: { status: "ok" },
        runtimeState: {
          config: { mode: "resume" },
          context: { ticketId: "T-1" },
          currentStepIndex: 2,
          waitingApprovalId: "approval-1",
        },
        stepResults: [
          {
            stepId: "step-1",
            stepName: "Approve",
            status: "success",
            output: { approved: true },
            durationMs: 12,
          },
        ],
        userId: "user-1",
      })
    );

    expect(created.input).toEqual({ customerId: "cust-1" });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO workflow_runs");
    expect(query.mock.calls[1]?.[0]).toContain("DELETE FROM workflow_step_results");
    expect(query.mock.calls[2]?.[0]).toContain("INSERT INTO workflow_step_results");
  });

  it("loads persisted runs and step results", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-pg",
            template_id: "tpl-support-bot",
            template_name: "Customer Support Bot",
            status: "awaiting_approval",
            started_at: "2026-04-22T00:00:00.000Z",
            completed_at: null,
            input_json: JSON.stringify({ customerId: "cust-1" }),
            output_json: JSON.stringify({ status: "pending" }),
            runtime_state_json: JSON.stringify({
              config: { mode: "resume" },
              context: { ticketId: "T-1" },
              currentStepIndex: 2,
              waitingApprovalId: "approval-1",
            }),
            error: null,
            user_id: "user-1",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
        {
          step_id: "step-1",
          step_name: "Approve",
          status: "success",
          output_json: JSON.stringify({ approved: true }),
          duration_ms: 15,
          error: null,
            agent_slot_results_json: null,
            cost_log_json: null,
          },
        ],
      });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    await expect(runStore.get("run-pg")).resolves.toMatchObject({
      id: "run-pg",
      status: "awaiting_approval",
      userId: "user-1",
      input: { customerId: "cust-1" },
      output: { status: "pending" },
      runtimeState: {
        config: { mode: "resume" },
        context: { ticketId: "T-1" },
        currentStepIndex: 2,
        waitingApprovalId: "approval-1",
      },
      stepResults: [
        expect.objectContaining({
          stepId: "step-1",
          output: { approved: true },
        }),
      ],
    });
  });

  it("lists persisted runs with template and user filters", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-pg-1",
            template_id: "tpl-support-bot",
            template_name: "Customer Support Bot",
            status: "completed",
            started_at: "2026-04-22T00:00:00.000Z",
            completed_at: "2026-04-22T00:05:00.000Z",
            input_json: JSON.stringify({ customerId: "cust-1" }),
            output_json: JSON.stringify({ ok: true }),
            runtime_state_json: null,
            error: null,
            user_id: "user-1",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    const runs = await runStore.list("tpl-support-bot", "user-1");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: "run-pg-1", userId: "user-1" });
    expect(query.mock.calls[0]?.[1]).toEqual(["tpl-support-bot", "user-1"]);
  });

  it("updates persisted runs and rewrites step results", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "run-pg",
            template_id: "tpl-support-bot",
            template_name: "Customer Support Bot",
            status: "pending",
            started_at: "2026-04-22T00:00:00.000Z",
            completed_at: null,
            input_json: JSON.stringify({ customerId: "cust-1" }),
            output_json: null,
            runtime_state_json: null,
            error: null,
            user_id: "user-1",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    const updated = await runStore.update("run-pg", {
      status: "completed",
      completedAt: "2026-04-22T00:05:00.000Z",
      output: { ok: true },
      stepResults: [
        {
          stepId: "step-1",
          stepName: "Approve",
          status: "success",
          output: { approved: true },
          durationMs: 20,
        },
      ],
    });

    expect(updated).toMatchObject({
      status: "completed",
      output: { ok: true },
      stepResults: [expect.objectContaining({ stepId: "step-1" })],
    });
    expect(query.mock.calls[2]?.[0]).toContain("UPDATE workflow_runs");
    expect(query.mock.calls[3]?.[0]).toContain("DELETE FROM workflow_step_results");
    expect(query.mock.calls[4]?.[0]).toContain("INSERT INTO workflow_step_results");
  });

  it("clears persisted runs when persistence is enabled", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    await runStore.clear();
    expect(query).toHaveBeenCalledWith("DELETE FROM workflow_runs");
  });
});
