/**
 * App-side mailer types (HEL-360). The Mailer sends AutoFlow's own transactional
 * mail (invites, billing receipts, system notices) on AWS SES. This file is the
 * **SDK-free seam**: the `Mailer` interface + the suppression-list types. The
 * SES implementation (`sesMailer.ts`, `@aws-sdk/client-sesv2`) and the AWS
 * domain / dedicated-IP / DKIM / SNS provisioning are the rest of HEL-360 and
 * require AWS access — they land separately so this seam stays buildable now.
 */

export type SuppressionReason = "bounce" | "complaint" | "manual" | "unsubscribe";

export interface EmailSuppression {
  id: string;
  /** Owning workspace, or null for a global suppression (applies everywhere). */
  workspaceId: string | null;
  email: string;
  reason: SuppressionReason;
  /** Provenance — e.g. the SES/SNS message id, or the admin who suppressed it. */
  source: string | null;
  createdAt: string;
}

export interface MailerSendInput {
  /** Template identifier, e.g. 'workspace-invite'. */
  template: string;
  /** Recipient email address. */
  to: string;
  /** Template variables. */
  data: Record<string, unknown>;
  /** Owning workspace, for attribution + suppression scoping. */
  workspaceId?: string | null;
}

export interface MailerSendResult {
  /** Provider-side message id, when sent. */
  providerMessageId?: string;
  /** True when the send was skipped because the recipient is suppressed. */
  suppressed?: boolean;
}

/**
 * App-side transactional mailer. Implemented by `sesMailer` (HEL-360, deferred
 * pending AWS). Any implementation MUST consult the suppression list before
 * sending and return `{ suppressed: true }` rather than deliver to a suppressed
 * recipient.
 */
export interface Mailer {
  sendTemplate(input: MailerSendInput): Promise<MailerSendResult>;
}
