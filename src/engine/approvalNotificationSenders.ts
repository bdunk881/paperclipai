import { ApprovalNotification } from "./approvalNotificationStore";
import { Mailer } from "../mailer/types";
import { buildSystemMailer, isSesConfigured } from "../mailer/sesMailer";
// HEL-364: side-effect import registers the `approval-request-out-of-band`
// template so the SES fallback can render it (mirrors memberInviteRoutes.ts).
import "../mailer/systemTemplates";

type NotificationSender = (notification: ApprovalNotification) => Promise<void>;

export interface ApprovalNotificationSenders {
  inbox: NotificationSender;
  email: NotificationSender;
}

export interface ApprovalNotificationSenderDeps {
  /**
   * Internal mailer for the out-of-band SES fallback (test injection). When
   * provided it forces the fallback path on regardless of env; otherwise the
   * fallback is active only when SES is configured (AUTOFLOW_SYSTEM_EMAIL_FROM).
   */
  mailer?: Mailer;
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

function dashboardBaseUrl(): string | undefined {
  const raw = normalizeEnv("DASHBOARD_APP_URL");
  return raw ? raw.replace(/\/$/, "") : undefined;
}

/**
 * HEL-364: review / approve / deny deep links into the dashboard. These are
 * authenticated dashboard links (they land the assignee on the approval), not
 * one-click GET resolves — there is no tokenized GET-resolve endpoint today.
 */
function approvalDeepLinks(approvalRequestId: string): {
  reviewUrl?: string;
  approveUrl?: string;
  denyUrl?: string;
} {
  const base = dashboardBaseUrl();
  if (!base) return {};
  const reviewUrl = `${base}/approvals/${approvalRequestId}`;
  return {
    reviewUrl,
    approveUrl: `${reviewUrl}?decision=approve`,
    denyUrl: `${reviewUrl}?decision=reject`,
  };
}

function approvalTemplateData(notification: ApprovalNotification): Record<string, unknown> {
  const message =
    typeof notification.payload.message === "string"
      ? notification.payload.message
      : "A workflow approval requires your review.";
  const requestedAt =
    typeof notification.payload.requestedAt === "string"
      ? notification.payload.requestedAt
      : notification.createdAt;
  const timeoutMinutes =
    typeof notification.payload.timeoutMinutes === "number"
      ? notification.payload.timeoutMinutes
      : undefined;
  let expiresAt: string | undefined;
  if (typeof timeoutMinutes === "number") {
    const requestedMs = new Date(requestedAt).getTime();
    if (!Number.isNaN(requestedMs)) {
      expiresAt = new Date(requestedMs + timeoutMinutes * 60_000).toISOString();
    }
  }
  return {
    workflowName: notification.templateName,
    stepName: notification.stepName,
    message,
    requestedAt,
    timeoutMinutes,
    expiresAt,
    ...approvalDeepLinks(notification.approvalRequestId),
  };
}

function workspaceIdFromPayload(notification: ApprovalNotification): string | null {
  const value = notification.payload.workspaceId;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * HEL-364: out-of-band approval sender via the internal SES mailer. Used only
 * when no other sender (Resend) is configured, so an approval can still leave
 * the app. Renders the `approval-request-out-of-band` template, tags the send
 * with the originating workspace for bounce attribution, honours the
 * suppression list (`{ suppressed: true }`), and logs a DISTINCT line so we can
 * monitor how many workspaces depend on the fallback vs a configured sender.
 */
function buildOutOfBandSesSender(mailer: Mailer): NotificationSender {
  return async (notification) => {
    if (!isEmailAddress(notification.recipient)) {
      throw new Error(
        `Approval recipient ${notification.recipient} is not a valid email address`,
      );
    }
    const workspaceId = workspaceIdFromPayload(notification);
    console.log(
      `[approval-notifications] out-of-band SES fallback for notification ${notification.id} ` +
        `(approval ${notification.approvalRequestId}, workspace ${workspaceId ?? "—"}) → ${notification.recipient}`,
    );
    const result = await mailer.sendTemplate({
      template: "approval-request-out-of-band",
      to: notification.recipient,
      data: approvalTemplateData(notification),
      workspaceId,
    });
    if (result.suppressed) {
      console.log(
        `[approval-notifications] out-of-band SES send suppressed for ${notification.recipient} ` +
          `(notification ${notification.id})`,
      );
    }
  };
}

export function buildApprovalNotificationSenders(
  deps: ApprovalNotificationSenderDeps = {},
): ApprovalNotificationSenders {
  // HEL-364: the out-of-band fallback uses the internal SES mailer. An injected
  // mailer forces the fallback on (tests); otherwise it's active only when SES
  // is configured (AUTOFLOW_SYSTEM_EMAIL_FROM).
  const sesFallbackMailer = deps.mailer ?? (isSesConfigured() ? buildSystemMailer() : null);

  let email: NotificationSender;
  if (normalizeEnv("RESEND_API_KEY")) {
    // HEL-604: AutoFlow's canonical transactional provider is Resend. (SendGrid
    // is a customer-facing connector in the agent plane, not our system mailer.)
    email = buildResendEmailSender();
  } else if (sesFallbackMailer) {
    // HEL-364: no configured sender → deliver out-of-band via the internal SES
    // mailer so the approval still leaves the app. Single XOR branch, so a
    // workspace is never double-sent (Resend OR SES, never both).
    email = buildOutOfBandSesSender(sesFallbackMailer);
  } else {
    // Pure dev with neither configured — log so the notification is observable
    // without a live mailbox (mirrors buildDefaultMfaEmailSender).
    email = async (notification) => {
      console.log(
        `[approval-notifications] (dev) would deliver email notification ${notification.id} to ${notification.recipient}`,
      );
    };
  }

  return {
    inbox: async () => {
      return;
    },
    email,
  };
}
