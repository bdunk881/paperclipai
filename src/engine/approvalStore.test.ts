/**
 * Unit tests for the HITL approval store.
 */

import { approvalStore } from "./approvalStore";

beforeEach(() => {
  void approvalStore.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

const base = {
  runId: "run-1",
  templateName: "Support Bot",
  stepId: "step_approve",
  stepName: "Manager Approval",
  assignee: "manager@example.com",
  message: "Please review this escalation",
  timeoutMinutes: 60,
};

describe("approvalStore.create", () => {
  it("returns an id", async () => {
    const { id } = await approvalStore.create(base);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("persists the request with pending status", async () => {
    const { id } = await approvalStore.create(base);
    const req = await approvalStore.get(id);
    expect(req).toBeDefined();
    expect(req!.status).toBe("pending");
    expect(req!.assignee).toBe(base.assignee);
    expect(req!.message).toBe(base.message);
    expect(req!.timeoutMinutes).toBe(60);
  });

  it("sets requestedAt as an ISO timestamp", async () => {
    const { id } = await approvalStore.create(base);
    const req = await approvalStore.get(id);
    expect(() => new Date(req!.requestedAt)).not.toThrow();
  });
});

describe("approvalStore.resolve — approve", () => {
  it("returns true and records the approved decision", async () => {
    const { id } = await approvalStore.create(base);
    const result = await approvalStore.resolve(id, "approved", "Looks good");
    expect(result).toBe(true);
    await expect(approvalStore.get(id)).resolves.toMatchObject({
      status: "approved",
      comment: "Looks good",
    });
  });

  it("sets status to approved and records resolvedAt", async () => {
    const { id } = await approvalStore.create(base);
    await approvalStore.resolve(id, "approved");
    await expect(approvalStore.get(id)).resolves.toMatchObject({
      status: "approved",
      resolvedAt: expect.any(String),
    });
  });
});

describe("approvalStore.resolve — reject", () => {
  it("returns true and records the rejected decision", async () => {
    const { id } = await approvalStore.create(base);
    await approvalStore.resolve(id, "rejected", "Not this time");
    await expect(approvalStore.get(id)).resolves.toMatchObject({
      status: "rejected",
      comment: "Not this time",
    });
  });

  it("sets status to rejected", async () => {
    const { id } = await approvalStore.create(base);
    await approvalStore.resolve(id, "rejected");
    await expect(approvalStore.get(id)).resolves.toMatchObject({ status: "rejected" });
  });
});

describe("approvalStore.resolve — request changes", () => {
  it("returns true and records the request_changes decision", async () => {
    const { id } = await approvalStore.create(base);
    await approvalStore.resolve(id, "request_changes", "Please revise the draft");
    await expect(approvalStore.get(id)).resolves.toMatchObject({
      status: "request_changes",
      comment: "Please revise the draft",
    });
  });
});

describe("approvalStore.resolve — guard conditions", () => {
  it("returns false for an unknown id", async () => {
    await expect(approvalStore.resolve("no-such-id", "approved")).resolves.toBe(false);
  });

  it("returns false if already resolved", async () => {
    const { id } = await approvalStore.create(base);
    await approvalStore.resolve(id, "approved");
    await expect(approvalStore.resolve(id, "rejected")).resolves.toBe(false);
  });
});

describe("approvalStore — timeout", () => {
  it("auto-rejects after timeout fires", async () => {
    const { id } = await approvalStore.create({ ...base, timeoutMinutes: 1 });
    jest.advanceTimersByTime(60 * 60 * 1000);
    await Promise.resolve();
    await expect(approvalStore.get(id)).resolves.toMatchObject({
      status: "timed_out",
    });
  });

  it("sets status to timed_out", async () => {
    const { id } = await approvalStore.create({ ...base, timeoutMinutes: 1 });
    jest.advanceTimersByTime(60 * 60 * 1000);
    await Promise.resolve();
    await expect(approvalStore.get(id)).resolves.toMatchObject({ status: "timed_out" });
  });
});

describe("approvalStore.list", () => {
  it("returns all requests when no status filter given", async () => {
    await approvalStore.create(base);
    await approvalStore.create({ ...base, runId: "run-2" });
    await expect(approvalStore.list()).resolves.toHaveLength(2);
  });

  it("filters by status", async () => {
    const { id } = await approvalStore.create(base);
    await approvalStore.create({ ...base, runId: "run-2" });
    await approvalStore.resolve(id, "approved");
    await expect(approvalStore.list("pending")).resolves.toHaveLength(1);
    await expect(approvalStore.list("approved")).resolves.toHaveLength(1);
  });
});

describe("approvalStore.get", () => {
  it("returns undefined for an unknown id", async () => {
    await expect(approvalStore.get("unknown")).resolves.toBeUndefined();
  });
});

describe("approvalStore.clear", () => {
  it("removes all entries", async () => {
    await approvalStore.create(base);
    await approvalStore.clear();
    await expect(approvalStore.list()).resolves.toHaveLength(0);
  });
});
