import { approvalStore } from "./approvalStore";

beforeEach(() => {
  jest.useRealTimers();
  approvalStore.clear();
});

afterEach(() => {
  jest.useRealTimers();
  approvalStore.clear();
});

describe("approvalStore", () => {
  it("creates, retrieves, and resolves an approval request", async () => {
    const { id, promise } = approvalStore.create({
      runId: "run-1",
      templateId: "tpl-1",
      templateName: "Template 1",
      stepId: "step-approval",
      stepName: "Approval",
      assignee: "approver-1",
      message: "Approve this change",
      timeoutMinutes: 30,
    });

    expect(approvalStore.get(id)).toEqual(
      expect.objectContaining({
        id,
        runId: "run-1",
        templateId: "tpl-1",
        templateName: "Template 1",
        stepId: "step-approval",
        assignee: "approver-1",
        status: "pending",
      })
    );

    expect(approvalStore.list("pending")).toEqual([
      expect.objectContaining({ id, status: "pending" }),
    ]);

    expect(approvalStore.resolve(id, "approved", "Looks good")).toBe(true);

    await expect(promise).resolves.toEqual({
      approved: true,
      comment: "Looks good",
    });

    expect(approvalStore.get(id)).toEqual(
      expect.objectContaining({
        status: "approved",
        comment: "Looks good",
        resolvedAt: expect.any(String),
      })
    );
  });

  it("times out unresolved approvals", async () => {
    jest.useFakeTimers();

    const { id, promise } = approvalStore.create({
      runId: "run-2",
      templateId: "tpl-2",
      templateName: "Template 2",
      stepId: "step-approval",
      stepName: "Approval",
      assignee: "approver-2",
      message: "Approve this change",
      timeoutMinutes: 1,
    });

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();

    await expect(promise).resolves.toEqual({ approved: false });
    expect(approvalStore.get(id)).toEqual(
      expect.objectContaining({
        status: "timed_out",
        resolvedAt: expect.any(String),
      })
    );
    expect(approvalStore.resolve(id, "approved")).toBe(false);
  });
});
