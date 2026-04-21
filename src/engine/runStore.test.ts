/**
 * Unit tests for the in-memory RunStore.
 */

import { runStore } from "./runStore";
import { WorkflowRun } from "../types/workflow";

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
});

describe("runStore.clear", () => {
  it("removes all runs", async () => {
    await runStore.create(makeRun({ id: "run-1" }));
    await runStore.create(makeRun({ id: "run-2" }));
    await runStore.clear();
    await expect(runStore.list()).resolves.toHaveLength(0);
  });
});
