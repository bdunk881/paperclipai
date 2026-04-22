import { buildApprovalNotificationSenders } from "./approvalNotificationSenders";
import { ApprovalNotification } from "./approvalNotificationStore";

const baseNotification: ApprovalNotification = {
  id: "notif-1",
  approvalRequestId: "approval-1",
  runId: "run-1",
  templateName: "Support Bot",
  stepId: "step_approve",
  stepName: "Manager Approval",
  recipient: "manager@example.com",
  channel: "email",
  status: "pending",
  payload: {
    message: "Please review this escalation",
    timeoutMinutes: 60,
    requestedAt: "2026-04-22T10:00:00.000Z",
  },
  createdAt: "2026-04-22T10:00:00.000Z",
};

describe("buildApprovalNotificationSenders", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AUTOFLOW_APPROVAL_EMAIL_PROVIDER;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.AUTOFLOW_APPROVAL_EMAIL_FROM;
    delete process.env.AUTOFLOW_APPROVAL_EMAIL_FROM_NAME;
    delete process.env.SENDGRID_API_BASE_URL;
    delete process.env.DASHBOARD_APP_URL;
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("falls back to the log-based sender when no provider is configured", async () => {
    const senders = buildApprovalNotificationSenders();
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(senders.email(baseNotification)).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      `[approval-notifications] delivered email notification ${baseNotification.id} to ${baseNotification.recipient}`
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends approval email through SendGrid when configured", async () => {
    process.env.AUTOFLOW_APPROVAL_EMAIL_PROVIDER = "sendgrid";
    process.env.SENDGRID_API_KEY = "sg_test";
    process.env.AUTOFLOW_APPROVAL_EMAIL_FROM = "autoflow@example.com";
    process.env.AUTOFLOW_APPROVAL_EMAIL_FROM_NAME = "AutoFlow Ops";
    process.env.DASHBOARD_APP_URL = "https://dashboard.example.com";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => "",
    });

    const senders = buildApprovalNotificationSenders();
    await expect(senders.email(baseNotification)).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sg_test",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init.body));
    expect(body.from).toEqual({ email: "autoflow@example.com", name: "AutoFlow Ops" });
    expect(body.personalizations[0].to).toEqual([{ email: "manager@example.com" }]);
    expect(body.personalizations[0].subject).toContain("Approval required");
    expect(body.content[0].value).toContain("Please review this escalation");
    expect(body.content[0].value).toContain("https://dashboard.example.com/approvals/approval-1");
  });

  it("throws when SendGrid is selected but required config is missing", async () => {
    process.env.AUTOFLOW_APPROVAL_EMAIL_PROVIDER = "sendgrid";
    const senders = buildApprovalNotificationSenders();

    await expect(senders.email(baseNotification)).rejects.toThrow("SENDGRID_API_KEY is not configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
