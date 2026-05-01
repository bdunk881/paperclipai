import { approvalNotificationStore } from "./approvalNotificationStore";
import { approvalStore } from "./approvalStore";
import * as postgres from "../db/postgres";

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

afterEach(() => {
  jest.restoreAllMocks();
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

  it("returns false for an unknown notification", async () => {
    await expect(approvalNotificationStore.markSent("missing")).resolves.toBe(false);
  });
});

describe("approvalNotificationStore.markFailed", () => {
  it("marks an existing notification as failed", async () => {
    const { id } = await approvalStore.create(base);
    const [, emailNotification] = await approvalNotificationStore.listByApprovalRequest(id);
    const ok = await approvalNotificationStore.markFailed(emailNotification.id, "smtp unavailable");

    expect(ok).toBe(true);
    await expect(approvalNotificationStore.get(emailNotification.id)).resolves.toMatchObject({
      status: "failed",
      error: "smtp unavailable",
    });
  });

  it("returns false for an unknown notification", async () => {
    await expect(approvalNotificationStore.markFailed("missing", "nope")).resolves.toBe(false);
  });
});

describe("approvalNotificationStore.list", () => {
  it("filters in-memory notifications by assignee, runId, approvalId, and status", async () => {
    const first = await approvalStore.create(base);
    const second = await approvalStore.create({
      ...base,
      runId: "run-2",
      assignee: "director@example.com",
      stepId: "step-2",
    });
    const [inbox] = await approvalNotificationStore.listByApprovalRequest(first.id);
    await approvalNotificationStore.markSent(inbox.id);

    expect(approvalNotificationStore.list({ assignee: base.assignee })).toHaveLength(2);
    expect(approvalNotificationStore.list({ runId: "run-2" })).toHaveLength(2);
    expect(approvalNotificationStore.list({ approvalId: second.id })).toHaveLength(2);
    expect(approvalNotificationStore.list({ status: "sent" })).toHaveLength(1);
  });
});

describe("approvalNotificationStore postgres persistence", () => {
  const persistedRequest = {
    id: "approval-1",
    runId: "run-1",
    templateName: "Support Bot",
    stepId: "step_approve",
    stepName: "Manager Approval",
    assignee: "manager@example.com",
    message: "Please review this escalation",
    timeoutMinutes: 60,
    requestedAt: "2026-04-22T00:00:00.000Z",
    status: "pending" as const,
  };

  it("persists both inbox and email notifications when enabled", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    const notifications = await approvalNotificationStore.createForApproval(persistedRequest);
    expect(notifications).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO approval_notifications");
  });

  it("loads notifications by approval request id from postgres", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: "notif-1",
          approval_request_id: persistedRequest.id,
          run_id: persistedRequest.runId,
          template_name: persistedRequest.templateName,
          step_id: persistedRequest.stepId,
          step_name: persistedRequest.stepName,
          recipient: persistedRequest.assignee,
          channel: "email",
          status: "pending",
          payload_json: JSON.stringify({ message: persistedRequest.message }),
          created_at: persistedRequest.requestedAt,
          sent_at: null,
          error: null,
        },
      ],
    });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    await expect(approvalNotificationStore.listByApprovalRequest(persistedRequest.id)).resolves.toEqual([
      expect.objectContaining({
        id: "notif-1",
        channel: "email",
        payload: { message: persistedRequest.message },
      }),
    ]);
  });

  it("loads a single notification from postgres", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: "notif-1",
          approval_request_id: persistedRequest.id,
          run_id: persistedRequest.runId,
          template_name: persistedRequest.templateName,
          step_id: persistedRequest.stepId,
          step_name: persistedRequest.stepName,
          recipient: persistedRequest.assignee,
          channel: "inbox",
          status: "sent",
          payload_json: JSON.stringify({ message: persistedRequest.message }),
          created_at: persistedRequest.requestedAt,
          sent_at: "2026-04-22T00:05:00.000Z",
          error: null,
        },
      ],
    });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    await expect(approvalNotificationStore.get("notif-1")).resolves.toMatchObject({
      id: "notif-1",
      status: "sent",
      sentAt: "2026-04-22T00:05:00.000Z",
    });
  });

  it("clears persisted notifications when enabled", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    jest.spyOn(postgres, "isPostgresPersistenceEnabled").mockReturnValue(true);
    jest
      .spyOn(postgres, "getPostgresPool")
      .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);

    await approvalNotificationStore.clear();
    expect(query).toHaveBeenCalledWith("DELETE FROM approval_notifications");
  });
});
