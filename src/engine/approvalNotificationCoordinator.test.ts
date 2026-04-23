import { approvalNotificationStore } from "./approvalNotificationStore";
import { approvalStore } from "./approvalStore";
import {
  resetApprovalNotificationSenders,
  runApprovalNotificationSweep,
  startApprovalNotificationCoordinator,
  stopApprovalNotificationCoordinator,
  setApprovalNotificationSender,
} from "./approvalNotificationCoordinator";

const base = {
  runId: "run-1",
  templateName: "Support Bot",
  stepId: "step_approve",
  stepName: "Manager Approval",
  assignee: "manager@example.com",
  message: "Please review this escalation",
  timeoutMinutes: 60,
};

beforeEach(async () => {
  await approvalStore.clear();
  await approvalNotificationStore.clear();
  resetApprovalNotificationSenders();
});

describe("runApprovalNotificationSweep", () => {
  it("marks pending approval notifications as sent", async () => {
    const { id } = await approvalStore.create(base);
    const sweep = await runApprovalNotificationSweep();
    expect(sweep.delivered).toBe(2);

    const notifications = await approvalNotificationStore.listByApprovalRequest(id);
    expect(notifications.every((notification) => notification.status === "sent")).toBe(true);
  });

  it("marks a notification failed when its sender throws", async () => {
    const { id } = await approvalStore.create(base);
    setApprovalNotificationSender("email", async () => {
      throw new Error("smtp unavailable");
    });

    const sweep = await runApprovalNotificationSweep();
    expect(sweep.delivered).toBe(1);
    expect(sweep.failed).toBe(1);

    const notifications = await approvalNotificationStore.listByApprovalRequest(id);
    expect(notifications.find((notification) => notification.channel === "inbox")?.status).toBe("sent");
    expect(notifications.find((notification) => notification.channel === "email")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("smtp unavailable"),
    });
  });

  it("returns zero work when there are no pending notifications", async () => {
    await expect(runApprovalNotificationSweep()).resolves.toEqual({
      scanned: 0,
      delivered: 0,
      failed: 0,
    });
  });
});

describe("approval notification coordinator lifecycle", () => {
  afterEach(() => {
    stopApprovalNotificationCoordinator();
    jest.useRealTimers();
  });

  it("starts only one interval and stops cleanly", () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");

    startApprovalNotificationCoordinator(100);
    startApprovalNotificationCoordinator(100);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    stopApprovalNotificationCoordinator();
    stopApprovalNotificationCoordinator();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
