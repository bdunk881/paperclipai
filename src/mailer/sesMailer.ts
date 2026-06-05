/**
 * SES implementation of the {@link Mailer} (HEL-360). Sends AutoFlow's app-side
 * transactional mail through AWS SES (configuration set `autoflow-mail`,
 * us-east-1), **tagging every send with `workspace_id`** so the SNS
 * bounce/complaint webhook (HEL-361) and comms wake-events (HEL-613) can
 * attribute the recipient back to a workspace. Consults the suppression list
 * first and **fails closed** (`{ suppressed: true }`) rather than deliver to a
 * suppressed address.
 *
 * Live sending is gated on `AUTOFLOW_SYSTEM_EMAIL_FROM`, SES being out of
 * sandbox, and DNS (DKIM/SPF/DMARC) verifying. `buildSystemMailer()` returns a
 * logging fallback when unconfigured (dev), mirroring `buildDefaultMfaEmailSender`.
 */

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { Mailer, MailerSendInput, MailerSendResult } from "./types";
import { suppressionStore } from "./suppressionStore";
import { RenderedEmail, renderTemplate } from "./templates";

/** Suppression scope for a system send with no workspace — matches global rows only. */
const GLOBAL_SUPPRESSION_SENTINEL = "00000000-0000-0000-0000-000000000000";

function normalizeEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface SesSendArgs {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  workspaceId: string | null;
}

export interface SesMailerDeps {
  /** Suppression check (test injection). Defaults to the suppression store. */
  isSuppressed?: (workspaceId: string, email: string) => Promise<boolean>;
  /** Template renderer (test injection). Defaults to the template registry. */
  render?: (template: string, data: Record<string, unknown>) => RenderedEmail;
  /** Low-level SES send (test injection). Defaults to the SESv2 SDK. */
  sendEmail?: (args: SesSendArgs) => Promise<{ messageId?: string }>;
  /** From identity override (else `AUTOFLOW_SYSTEM_EMAIL_FROM`). */
  from?: string;
}

let _client: SESv2Client | null = null;
function sesClient(): SESv2Client {
  if (!_client) {
    const region = normalizeEnv("SES_REGION") ?? normalizeEnv("AWS_REGION") ?? "us-east-1";
    _client = new SESv2Client({ region });
  }
  return _client;
}

async function defaultSesSend(args: SesSendArgs): Promise<{ messageId?: string }> {
  const configurationSetName = normalizeEnv("SES_CONFIGURATION_SET") ?? "autoflow-mail";
  const command = new SendEmailCommand({
    FromEmailAddress: args.from,
    Destination: { ToAddresses: [args.to] },
    ConfigurationSetName: configurationSetName,
    // SES tag values allow [A-Za-z0-9_-]; a workspace UUID qualifies.
    EmailTags: args.workspaceId ? [{ Name: "workspace_id", Value: args.workspaceId }] : undefined,
    Content: {
      Simple: {
        Subject: { Data: args.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: args.html, Charset: "UTF-8" },
          Text: { Data: args.text, Charset: "UTF-8" },
        },
      },
    },
  });
  const result = await sesClient().send(command);
  return { messageId: result.MessageId };
}

/** True when the SES mailer has a From identity configured. */
export function isSesConfigured(): boolean {
  return Boolean(normalizeEnv("AUTOFLOW_SYSTEM_EMAIL_FROM"));
}

export class SesMailer implements Mailer {
  private readonly isSuppressed: (workspaceId: string, email: string) => Promise<boolean>;
  private readonly render: (template: string, data: Record<string, unknown>) => RenderedEmail;
  private readonly sendEmail: (args: SesSendArgs) => Promise<{ messageId?: string }>;
  private readonly fromOverride?: string;

  constructor(deps: SesMailerDeps = {}) {
    this.isSuppressed =
      deps.isSuppressed ?? ((ws, email) => suppressionStore.isSuppressed(ws, email));
    this.render = deps.render ?? renderTemplate;
    this.sendEmail = deps.sendEmail ?? defaultSesSend;
    this.fromOverride = deps.from;
  }

  async sendTemplate(input: MailerSendInput): Promise<MailerSendResult> {
    const workspaceId = input.workspaceId ?? null;

    // Fail closed on suppressed recipients (workspace-scoped + global).
    const suppressionScope = workspaceId ?? GLOBAL_SUPPRESSION_SENTINEL;
    if (await this.isSuppressed(suppressionScope, input.to)) {
      return { suppressed: true };
    }

    const from = this.fromOverride ?? normalizeEnv("AUTOFLOW_SYSTEM_EMAIL_FROM");
    if (!from) {
      throw new Error("AUTOFLOW_SYSTEM_EMAIL_FROM is not configured");
    }

    const rendered = this.render(input.template, input.data);
    const result = await this.sendEmail({
      from,
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      workspaceId,
    });
    return { providerMessageId: result.messageId };
  }
}

/** Dev/unconfigured fallback — logs instead of sending (mirrors the MFA mailer). */
export class LoggingMailer implements Mailer {
  async sendTemplate(input: MailerSendInput): Promise<MailerSendResult> {
    console.log(
      `[mailer] (dev) would send template '${input.template}' to ${input.to} ` +
        `(workspace=${input.workspaceId ?? "—"})`,
    );
    return {};
  }
}

/** SES when `AUTOFLOW_SYSTEM_EMAIL_FROM` is set, else a dev logging fallback. */
export function buildSystemMailer(): Mailer {
  return isSesConfigured() ? new SesMailer() : new LoggingMailer();
}
