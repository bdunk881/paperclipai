import { ApprovalNotification } from "./approvalNotificationStore";

type NotificationSender = (notification: ApprovalNotification) => Promise<void>;

export interface ApprovalNotificationSenders {
  inbox: NotificationSender;
  email: NotificationSender;
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildResendEmailSender(): NotificationSender {
  const apiKey = normalizeEnv("RESEND_API_KEY");
  const fromEmail = normalizeEnv("AUTOFLOW_APPROVAL_EMAIL_FROM");
  const fromName = normalizeEnv("AUTOFLOW_APPROVAL_EMAIL_FROM_NAME") ?? "AutoFlow";
  const baseUrl = normalizeEnv("RESEND_API_BASE_URL") ?? "https://api.resend.com";

  return async (notification) => {
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    if (!fromEmail) {
      throw new Error("AUTOFLOW_APPROVAL_EMAIL_FROM is not configured");
    }
    if (!isEmailAddress(notification.recipient)) {
      throw new Error(`Approval recipient ${notification.recipient} is not a valid email address`);
    }

    const message = typeof notification.payload.message === "string"
      ? notification.payload.message
      : "A workflow approval requires your review.";
    const requestedAt = typeof notification.payload.requestedAt === "string"
      ? notification.payload.requestedAt
      : notification.createdAt;
    const timeoutMinutes = typeof notification.payload.timeoutMinutes === "number"
      ? notification.payload.timeoutMinutes
      : undefined;
    const approvalUrl = normalizeEnv("DASHBOARD_APP_URL")
      ? `${normalizeEnv("DASHBOARD_APP_URL")!.replace(/\/$/, "")}/approvals/${notification.approvalRequestId}`
      : undefined;

    const textLines = [
      `Workflow: ${notification.templateName}`,
      `Step: ${notification.stepName}`,
      "",
      message,
      "",
      `Requested at: ${requestedAt}`,
    ];

    if (typeof timeoutMinutes === "number") {
      textLines.push(`Timeout: ${timeoutMinutes} minute(s)`);
    }
    if (approvalUrl) {
      textLines.push(`Review: ${approvalUrl}`);
    }

    const htmlParts = [
      `<p>A workflow approval requires your review.</p>`,
      `<ul><li><strong>Workflow:</strong> ${escapeHtml(notification.templateName)}</li><li><strong>Step:</strong> ${escapeHtml(notification.stepName)}</li></ul>`,
      `<p>${escapeHtml(message)}</p>`,
      `<p><strong>Requested at:</strong> ${escapeHtml(requestedAt)}</p>`,
    ];
    if (typeof timeoutMinutes === "number") {
      htmlParts.push(`<p><strong>Timeout:</strong> ${timeoutMinutes} minute(s)</p>`);
    }
    if (approvalUrl) {
      htmlParts.push(
        `<p><a href="${escapeHtml(approvalUrl)}">Open approval</a></p>`
      );
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [notification.recipient],
        subject: `Approval required: ${notification.templateName} / ${notification.stepName}`,
        text: textLines.join("\n"),
        html: htmlParts.join(""),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Resend mail send failed (${response.status}): ${body.slice(0, 300)}`);
    }
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildApprovalNotificationSenders(): ApprovalNotificationSenders {
  return {
    inbox: async () => {
      return;
    },
    // HEL-604: AutoFlow's canonical transactional provider is Resend. (SendGrid
    // is a customer-facing connector in the agent plane, not our system mailer.)
    // Deliver via Resend when RESEND_API_KEY is set, else log in dev so the
    // notification is observable without a live mailbox — mirrors
    // buildDefaultMfaEmailSender.
    email: normalizeEnv("RESEND_API_KEY")
      ? buildResendEmailSender()
      : async (notification) => {
          console.log(
            `[approval-notifications] (dev) would deliver email notification ${notification.id} to ${notification.recipient}`
          );
        },
  };
}
