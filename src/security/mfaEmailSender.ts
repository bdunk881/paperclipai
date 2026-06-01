/**
 * Transactional email sender for the email-OTP + magic-link MFA factors
 * (HEL-282).
 *
 * The repo has no canonical mailer yet — the member-invite path (HEL-213)
 * logs the URL with a TODO. The one real transport is the SendGrid sender in
 * `src/engine/approvalNotificationSenders.ts`. This module mirrors that exact
 * shape so MFA email lands on the same surface: send via SendGrid when
 * `SENDGRID_API_KEY` + `AUTOFLOW_APPROVAL_EMAIL_FROM` are configured,
 * otherwise log in dev so the code/link is observable for tests and local
 * runs. The route always returns `{ sent: true }` regardless — never leak
 * whether delivery succeeded (and never block the auth flow on a mail error).
 *
 * Production email delivery is therefore gated on `SENDGRID_API_KEY` being
 * present in the deploy env. Wiring a dedicated MFA mailer template beyond
 * this seam is out of scope for HEL-282 (tracked by HEL-213's mailer TODO).
 */

export type MfaEmailKind =
  | "email_otp_code"
  | "magic_link"
  // HEL-383: out-of-band notice that the account password was changed.
  | "password_changed";

export interface MfaEmailMessage {
  to: string;
  kind: MfaEmailKind;
  /** 6-digit code for `email_otp_code`. */
  code?: string;
  /** Absolute verification URL for `magic_link`. */
  link?: string;
  /** How the change was made, for `password_changed` copy (e.g. "a recovery code"). */
  method?: string;
  /** 'enroll' | 'verify' — only affects copy. 'notify' for one-way notices. */
  purpose: "enroll" | "verify" | "notify";
}

export interface MfaEmailSender {
  send(message: MfaEmailMessage): Promise<void>;
}

function normalizeEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function render(message: MfaEmailMessage): RenderedEmail {
  if (message.kind === "password_changed") {
    const how = message.method ? ` using ${message.method}` : "";
    return {
      subject: "Your AutoFlow password was changed",
      text:
        `Your AutoFlow password was just changed${how}.\n\n` +
        `If this was you, no action is needed. If you didn't do this, reset your ` +
        `password immediately and contact support — your account may be at risk.`,
      html:
        `<p>Your AutoFlow password was just changed${escapeHtml(how)}.</p>` +
        `<p>If this was you, no action is needed. If you didn't do this, reset your ` +
        `password immediately and contact support — your account may be at risk.</p>`,
    };
  }
  if (message.kind === "email_otp_code") {
    const code = message.code ?? "";
    return {
      subject: "Your AutoFlow verification code",
      text:
        `Your AutoFlow verification code is ${code}.\n\n` +
        `It expires in 5 minutes. If you didn't request this, you can ignore this email.`,
      html:
        `<p>Your AutoFlow verification code is:</p>` +
        `<p style="font-size:24px;font-weight:600;letter-spacing:4px">${escapeHtml(code)}</p>` +
        `<p>It expires in 5 minutes. If you didn't request this, you can ignore this email.</p>`,
    };
  }
  const link = message.link ?? "";
  return {
    subject: "Verify your AutoFlow sign-in",
    text:
      `Click the link below to verify it's you. It expires in 5 minutes and can be used once.\n\n` +
      `${link}\n\n` +
      `If you didn't request this, you can ignore this email.`,
    html:
      `<p>Click the button below to verify it's you. It expires in 5 minutes and can be used once.</p>` +
      `<p><a href="${escapeHtml(link)}">Verify sign-in</a></p>` +
      `<p>If you didn't request this, you can ignore this email.</p>`,
  };
}

/**
 * Sends through the SendGrid v3 API when configured, mirroring
 * `approvalNotificationSenders.ts`. Reuses the same `SENDGRID_API_KEY` /
 * `AUTOFLOW_APPROVAL_EMAIL_FROM` / `SENDGRID_API_BASE_URL` env so a single
 * mail config powers both surfaces.
 */
export class SendGridMfaEmailSender implements MfaEmailSender {
  async send(message: MfaEmailMessage): Promise<void> {
    const apiKey = normalizeEnv("SENDGRID_API_KEY");
    const fromEmail = normalizeEnv("AUTOFLOW_APPROVAL_EMAIL_FROM");
    const fromName = normalizeEnv("AUTOFLOW_APPROVAL_EMAIL_FROM_NAME") ?? "AutoFlow";
    const baseUrl = normalizeEnv("SENDGRID_API_BASE_URL") ?? "https://api.sendgrid.com";

    if (!apiKey) throw new Error("SENDGRID_API_KEY is not configured");
    if (!fromEmail) throw new Error("AUTOFLOW_APPROVAL_EMAIL_FROM is not configured");
    if (!isEmailAddress(message.to)) {
      throw new Error(`MFA recipient ${message.to} is not a valid email address`);
    }

    const { subject, text, html } = render(message);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v3/mail/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }], subject }],
        from: { email: fromEmail, name: fromName },
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SendGrid mail send failed (${response.status}): ${body.slice(0, 300)}`);
    }
  }
}

/**
 * Dev/test fallback: logs that a code/link would have been sent. The code or
 * link is logged so local enrollment and the jest integration tests can
 * complete the round-trip without a live mailbox. Never used when SendGrid is
 * configured.
 */
export class LoggingMfaEmailSender implements MfaEmailSender {
  async send(message: MfaEmailMessage): Promise<void> {
    const detail =
      message.kind === "email_otp_code"
        ? `code=${message.code ?? "?"}`
        : message.kind === "magic_link"
          ? `link=${message.link ?? "?"}`
          : `method=${message.method ?? "?"}`;
    console.log(
      `[mfaEmailSender] (dev) would send ${message.kind} (${message.purpose}) to ${message.to} — ${detail}`,
    );
  }
}

/**
 * Picks SendGrid when `SENDGRID_API_KEY` is present, else the logging
 * fallback. Matches the `AUTOFLOW_APPROVAL_EMAIL_PROVIDER`-style branching in
 * `approvalNotificationSenders.ts` but keyed on key presence so MFA email
 * "just works" wherever approval email already does.
 */
export function buildDefaultMfaEmailSender(): MfaEmailSender {
  return normalizeEnv("SENDGRID_API_KEY")
    ? new SendGridMfaEmailSender()
    : new LoggingMfaEmailSender();
}
