/**
 * Unit tests for the HITL approval store.
 */

import { approvalStore } from "./approvalStore";

beforeEach(() => {
  approvalStore.clear();
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
  it("returns an id and a promise", () => {
    const { id, promise } = approvalStore.create(base);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(promise).toBeInstanceOf(Promise);
  });

  it("persists the request with pending status", () => {
    const { id } = approvalStore.create(base);
    const req = approvalStore.get(id);
    expect(req).toBeDefined();
    expect(req!.status).toBe("pending");
    expect(req!.assignee).toBe(base.assignee);
    expect(req!.message).toBe(base.message);
    expect(req!.timeoutMinutes).toBe(60);
  });

  it("sets requestedAt as an ISO timestamp", () => {
    const { id } = approvalStore.create(base);
    const req = approvalStore.get(id);
    expect(() => new Date(req!.requestedAt)).not.toThrow();
  });
});

describe("approvalStore.resolve — approve", () => {
  it("returns true and resolves the promise with approved=true", async () => {
    const { id, promise } = approvalStore.create(base);
    const result = approvalStore.resolve(id, "approved", "Looks good");
    expect(result).toBe(true);
    const outcome = await promise;
    expect(outcome.approved).toBe(true);
    expect(outcome.comment).toBe("Looks good");
  });

  it("sets status to approved and records resolvedAt", () => {
    const { id } = approvalStore.create(base);
    approvalStore.resolve(id, "approved");
    const req = approvalStore.get(id);
    expect(req!.status).toBe("approved");
    expect(req!.resolvedAt).toBeDefined();
  });
});

describe("approvalStore.resolve — reject", () => {
  it("returns true and resolves with approved=false", async () => {
    const { id, promise } = approvalStore.create(base);
    approvalStore.resolve(id, "rejected", "Not this time");
    const outcome = await promise;
    expect(outcome.approved).toBe(false);
    expect(outcome.comment).toBe("Not this time");
  });

  it("sets status to rejected", () => {
    const { id } = approvalStore.create(base);
    approvalStore.resolve(id, "rejected");
    expect(approvalStore.get(id)!.status).toBe("rejected");
  });
});

describe("approvalStore.resolve — guard conditions", () => {
  it("returns false for an unknown id", () => {
    expect(approvalStore.resolve("no-such-id", "approved")).toBe(false);
  });

  it("returns false if already resolved", () => {
    const { id } = approvalStore.create(base);
    approvalStore.resolve(id, "approved");
    expect(approvalStore.resolve(id, "rejected")).toBe(false);
  });
});

describe("approvalStore — timeout", () => {
  it("auto-rejects with approved=false after timeout fires", async () => {
    const { promise } = approvalStore.create({ ...base, timeoutMinutes: 1 });
    jest.advanceTimersByTime(60 * 60 * 1000); // 1 hour in ms
    const outcome = await promise;
    expect(outcome.approved).toBe(false);
  });

  it("sets status to timed_out", async () => {
    const { id, promise } = approvalStore.create({ ...base, timeoutMinutes: 1 });
    jest.advanceTimersByTime(60 * 60 * 1000);
    await promise;
    expect(approvalStore.get(id)!.status).toBe("timed_out");
  });
});

describe("approvalStore.list", () => {
  it("returns all requests when no status filter given", () => {
    approvalStore.create(base);
    approvalStore.create({ ...base, runId: "run-2" });
    expect(approvalStore.list().length).toBe(2);
  });

  it("filters by status", () => {
    const { id } = approvalStore.create(base);
    approvalStore.create({ ...base, runId: "run-2" });
    approvalStore.resolve(id, "approved");
    expect(approvalStore.list("pending").length).toBe(1);
    expect(approvalStore.list("approved").length).toBe(1);
  });
});

describe("approvalStore.get", () => {
  it("returns undefined for an unknown id", () => {
    expect(approvalStore.get("unknown")).toBeUndefined();
  });
});

describe("approvalStore.clear", () => {
  it("removes all entries", () => {
    approvalStore.create(base);
    approvalStore.clear();
    expect(approvalStore.list().length).toBe(0);
  });
});
