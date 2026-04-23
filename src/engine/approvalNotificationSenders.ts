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

function buildSendGridEmailSender(): NotificationSender {
  const apiKey = normalizeEnv("SENDGRID_API_KEY");
  const fromEmail = normalizeEnv("AUTOFLOW_APPROVAL_EMAIL_FROM");
  const fromName = normalizeEnv("AUTOFLOW_APPROVAL_EMAIL_FROM_NAME") ?? "AutoFlow";
  const baseUrl = normalizeEnv("SENDGRID_API_BASE_URL") ?? "https://api.sendgrid.com";

  return async (notification) => {
    if (!apiKey) {
      throw new Error("SENDGRID_API_KEY is not configured");
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

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v3/mail/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: notification.recipient }],
            subject: `Approval required: ${notification.templateName} / ${notification.stepName}`,
          },
        ],
        from: {
          email: fromEmail,
          name: fromName,
        },
        content: [
          {
            type: "text/plain",
            value: textLines.join("\n"),
          },
          {
            type: "text/html",
            value: htmlParts.join(""),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SendGrid mail send failed (${response.status}): ${body.slice(0, 300)}`);
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
  const provider = normalizeEnv("AUTOFLOW_APPROVAL_EMAIL_PROVIDER")?.toLowerCase();

  return {
    inbox: async () => {
      return;
    },
    email:
      provider === "sendgrid"
        ? buildSendGridEmailSender()
        : async (notification) => {
            console.log(
              `[approval-notifications] delivered email notification ${notification.id} to ${notification.recipient}`
            );
          },
  };
}
