import { approvalNotificationStore } from "./approvalNotificationStore";
import { approvalStore } from "./approvalStore";

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
});

describe("approvalNotificationStore.createForApproval", () => {
  it("creates inbox and email notifications for each approval", async () => {
    const { id } = await approvalStore.create(base);
    const notifications = await approvalNotificationStore.listByApprovalRequest(id);
    expect(notifications).toHaveLength(2);
    expect(notifications.map((notification) => notification.channel)).toEqual(["inbox", "email"]);
    expect(notifications.every((notification) => notification.status === "pending")).toBe(true);
  });
});

describe("approvalNotificationStore.markSent", () => {
  it("marks an existing notification as sent", async () => {
    const { id } = await approvalStore.create(base);
    const [notification] = await approvalNotificationStore.listByApprovalRequest(id);
    const ok = await approvalNotificationStore.markSent(notification.id);
    expect(ok).toBe(true);
    await expect(approvalNotificationStore.get(notification.id)).resolves.toMatchObject({
      status: "sent",
      sentAt: expect.any(String),
    });
  });
});
