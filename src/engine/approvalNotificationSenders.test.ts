import { buildApprovalNotificationSenders } from "./approvalNotificationSenders";
import { ApprovalNotification } from "./approvalNotificationStore";
import type { Mailer, MailerSendInput, MailerSendResult } from "../mailer/types";

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

// HEL-604: approval-notification email goes through Resend (AutoFlow's canonical
// transactional provider), not SendGrid (a customer connector, not our mailer).
describe("buildApprovalNotificationSenders", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_BASE_URL;
    delete process.env.AUTOFLOW_APPROVAL_EMAIL_FROM;
    delete process.env.AUTOFLOW_APPROVAL_EMAIL_FROM_NAME;
    delete process.env.DASHBOARD_APP_URL;
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("falls back to the log-based sender when RESEND_API_KEY is not set", async () => {
    const senders = buildApprovalNotificationSenders();
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(senders.email(baseNotification)).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      `[approval-notifications] (dev) would deliver email notification ${baseNotification.id} to ${baseNotification.recipient}`
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends approval email through Resend when RESEND_API_KEY is set", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTOFLOW_APPROVAL_EMAIL_FROM = "autoflow@example.com";
    process.env.AUTOFLOW_APPROVAL_EMAIL_FROM_NAME = "AutoFlow Ops";
    process.env.DASHBOARD_APP_URL = "https://dashboard.example.com";
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });

    const senders = buildApprovalNotificationSenders();
    await expect(senders.email(baseNotification)).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("AutoFlow Ops <autoflow@example.com>");
    expect(body.to).toEqual(["manager@example.com"]);
    expect(body.subject).toContain("Approval required");
    expect(body.text).toContain("Please review this escalation");
    expect(body.text).toContain("https://dashboard.example.com/approvals/approval-1");
    expect(body.html).toContain("Please review this escalation");
  });

  it("throws when Resend is selected but the from-address is missing", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const senders = buildApprovalNotificationSenders();

    await expect(senders.email(baseNotification)).rejects.toThrow(
      "AUTOFLOW_APPROVAL_EMAIL_FROM is not configured"
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // HEL-364: when no configured sender (Resend) exists, fall back to the
  // internal SES mailer so the approval still leaves the app.
  describe("out-of-band SES fallback (HEL-364)", () => {
    function fakeMailer(result: MailerSendResult = { providerMessageId: "ses-1" }): {
      mailer: Mailer;
      calls: MailerSendInput[];
    } {
      const calls: MailerSendInput[] = [];
      return {
        mailer: {
          sendTemplate: async (input) => {
            calls.push(input);
            return result;
          },
        },
        calls,
      };
    }

    const wsNotification: ApprovalNotification = {
      ...baseNotification,
      payload: { ...baseNotification.payload, workspaceId: "ws-123" },
    };

    it("delivers via the injected SES mailer when Resend is unset", async () => {
      process.env.DASHBOARD_APP_URL = "https://dashboard.example.com";
      const { mailer, calls } = fakeMailer();
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

      const senders = buildApprovalNotificationSenders({ mailer });
      await expect(senders.email(wsNotification)).resolves.toBeUndefined();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        template: "approval-request-out-of-band",
        to: "manager@example.com",
        workspaceId: "ws-123",
      });
      expect(calls[0].data).toMatchObject({
        workflowName: "Support Bot",
        stepName: "Manager Approval",
        message: "Please review this escalation",
        reviewUrl: "https://dashboard.example.com/approvals/approval-1",
        approveUrl: "https://dashboard.example.com/approvals/approval-1?decision=approve",
        denyUrl: "https://dashboard.example.com/approvals/approval-1?decision=reject",
      });
      // expiry = requestedAt (10:00) + 60m
      expect(calls[0].data.expiresAt).toBe("2026-04-22T11:00:00.000Z");
      // distinct audit log so we can monitor opt-in conversion
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("out-of-band SES fallback"),
      );
    });

    it("does NOT use the SES fallback when Resend is configured (no double-send)", async () => {
      process.env.RESEND_API_KEY = "re_test";
      process.env.AUTOFLOW_APPROVAL_EMAIL_FROM = "autoflow@example.com";
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "",
      });
      const { mailer, calls } = fakeMailer();

      const senders = buildApprovalNotificationSenders({ mailer });
      await expect(senders.email(baseNotification)).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledTimes(1); // Resend delivered
      expect(calls).toHaveLength(0); // SES mailer never touched
    });

    it("logs distinctly when the SES send is suppressed", async () => {
      const { mailer } = fakeMailer({ suppressed: true });
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

      const senders = buildApprovalNotificationSenders({ mailer });
      await expect(senders.email(baseNotification)).resolves.toBeUndefined();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("suppressed"));
    });

    it("throws on a non-email recipient before calling the mailer", async () => {
      const { mailer, calls } = fakeMailer();
      const senders = buildApprovalNotificationSenders({ mailer });

      await expect(
        senders.email({ ...baseNotification, recipient: "user-uuid-not-email" }),
      ).rejects.toThrow(/not a valid email address/);
      expect(calls).toHaveLength(0);
    });
  });
});
