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
  runStore.clear();
});

describe("runStore.create", () => {
  it("stores and returns the run", () => {
    const run = makeRun();
    const result = runStore.create(run);
    expect(result).toBe(run);
  });

  it("can retrieve the created run via get()", () => {
    const run = makeRun();
    runStore.create(run);
    expect(runStore.get(run.id)).toEqual(run);
  });
});

describe("runStore.get", () => {
  it("returns undefined for an unknown id", () => {
    expect(runStore.get("run-nope")).toBeUndefined();
  });

  it("returns the correct run by id", () => {
    const runA = makeRun({ id: "run-a" });
    const runB = makeRun({ id: "run-b", templateId: "tpl-lead-enrichment" });
    runStore.create(runA);
    runStore.create(runB);
    expect(runStore.get("run-a")).toEqual(runA);
    expect(runStore.get("run-b")).toEqual(runB);
  });
});

describe("runStore.update", () => {
  it("returns undefined for an unknown id", () => {
    expect(runStore.update("run-nope", { status: "running" })).toBeUndefined();
  });

  it("patches the specified fields", () => {
    const run = makeRun();
    runStore.create(run);
    const updated = runStore.update(run.id, { status: "running" });
    expect(updated?.status).toBe("running");
    expect(updated?.templateId).toBe(run.templateId);
  });

  it("persists updates across subsequent get() calls", () => {
    const run = makeRun();
    runStore.create(run);
    runStore.update(run.id, { status: "completed", completedAt: "2024-01-01T00:00:00.000Z" });
    const fetched = runStore.get(run.id);
    expect(fetched?.status).toBe("completed");
    expect(fetched?.completedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("does not mutate the original object", () => {
    const run = makeRun();
    runStore.create(run);
    runStore.update(run.id, { status: "running" });
    expect(run.status).toBe("pending");
  });
});

describe("runStore.list", () => {
  it("returns an empty array when the store is empty", () => {
    expect(runStore.list()).toEqual([]);
  });

  it("returns all runs when no templateId filter is provided", () => {
    runStore.create(makeRun({ id: "run-1" }));
    runStore.create(makeRun({ id: "run-2", templateId: "tpl-lead-enrichment" }));
    expect(runStore.list()).toHaveLength(2);
  });

  it("filters by templateId", () => {
    runStore.create(makeRun({ id: "run-1", templateId: "tpl-support-bot" }));
    runStore.create(makeRun({ id: "run-2", templateId: "tpl-lead-enrichment" }));
    runStore.create(makeRun({ id: "run-3", templateId: "tpl-support-bot" }));

    const filtered = runStore.list("tpl-support-bot");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.templateId === "tpl-support-bot")).toBe(true);
  });

  it("returns empty array when filtering by unknown templateId", () => {
    runStore.create(makeRun({ id: "run-1" }));
    expect(runStore.list("tpl-unknown")).toEqual([]);
  });
});

describe("runStore.clear", () => {
  it("removes all runs", () => {
    runStore.create(makeRun({ id: "run-1" }));
    runStore.create(makeRun({ id: "run-2" }));
    runStore.clear();
    expect(runStore.list()).toHaveLength(0);
  });
});
