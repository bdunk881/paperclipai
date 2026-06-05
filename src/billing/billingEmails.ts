/**
 * Billing emails (HEL-363): transactional receipt + payment-failed (dunning)
 * emails sent through the internal SES mailer when Stripe invoice webhooks fire.
 *
 * The two templates self-register on import, so importing this module from
 * stripeWebhook.ts makes them available to the mailer (the registry — see
 * mailer/templates.ts — is designed for distributed registration, so billing
 * templates live with the billing send helpers rather than in the shared
 * systemTemplates.ts). The send helpers are **best-effort**: they never throw,
 * so a mail hiccup can't fail the Stripe webhook handler (Stripe would
 * otherwise retry the whole event). Templates use plain semantic HTML (no
 * external CSS) so they render across Gmail, Apple Mail, and Outlook.
 */

import { Mailer } from "../mailer/types";
import { buildSystemMailer } from "../mailer/sesMailer";
import { registerTemplate, RenderedEmail } from "../mailer/templates";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** billing-receipt (HEL-363): sent on a successful invoice payment. */
export function renderBillingReceipt(data: Record<string, unknown>): RenderedEmail {
  const planName = str(data.planName);
  const amount = str(data.amount) ?? "your payment";
  const invoiceNumber = str(data.invoiceNumber);
  const periodStart = str(data.periodStart);
  const periodEnd = str(data.periodEnd);
  const invoiceUrl = str(data.invoiceUrl);
  const invoicePdf = str(data.invoicePdf);

  const planLabel = planName ? `${planName} plan` : "subscription";
  const period = periodStart && periodEnd ? `${periodStart} – ${periodEnd}` : null;
  const subject = `Your AutoFlow receipt${invoiceNumber ? ` · ${invoiceNumber}` : ""}`;

  const textLines = [
    "Thanks for your payment to AutoFlow.",
    "",
    `Amount: ${amount}`,
    `Plan: ${planLabel}`,
  ];
  if (invoiceNumber) textLines.push(`Invoice: ${invoiceNumber}`);
  if (period) textLines.push(`Billing period: ${period}`);
  textLines.push("");
  if (invoiceUrl) textLines.push(`View invoice: ${invoiceUrl}`);
  if (invoicePdf) textLines.push(`Download PDF: ${invoicePdf}`);
  if (invoiceUrl || invoicePdf) textLines.push("");
  textLines.push("Questions about your bill? Just reply to this email.");

  const factHtml =
    `<p><strong>Amount:</strong> ${escapeHtml(amount)}<br/>` +
    `<strong>Plan:</strong> ${escapeHtml(planLabel)}` +
    (invoiceNumber ? `<br/><strong>Invoice:</strong> ${escapeHtml(invoiceNumber)}` : "") +
    (period ? `<br/><strong>Billing period:</strong> ${escapeHtml(period)}` : "") +
    `</p>`;
  const htmlParts = ["<p>Thanks for your payment to AutoFlow.</p>", factHtml];
  if (invoiceUrl) htmlParts.push(`<p><a href="${escapeHtml(invoiceUrl)}">View invoice</a></p>`);
  if (invoicePdf) htmlParts.push(`<p><a href="${escapeHtml(invoicePdf)}">Download PDF</a></p>`);
  htmlParts.push("<p>Questions about your bill? Just reply to this email.</p>");

  return { subject, html: htmlParts.join(""), text: textLines.join("\n") };
}

/** billing-payment-failed (HEL-363): dunning email on a failed invoice payment. */
export function renderBillingPaymentFailed(data: Record<string, unknown>): RenderedEmail {
  const planName = str(data.planName);
  const amount = str(data.amount);
  const attempt = str(data.attempt);
  const nextAttemptAt = str(data.nextAttemptAt);
  const updatePaymentUrl = str(data.updatePaymentUrl);
  const billingUrl = str(data.billingUrl);

  const planLabel = planName ? `${planName} plan` : "subscription";
  const amountClause = amount ? `${amount} for your ${planLabel}` : `your ${planLabel}`;
  const subject = "Action needed: your AutoFlow payment failed";

  const textLines = [`We couldn't process the payment for ${amountClause}.`, ""];
  if (attempt) textLines.push(`Failed attempt: ${attempt}`);
  if (nextAttemptAt) textLines.push(`We'll automatically try again on ${nextAttemptAt}.`);
  if (attempt || nextAttemptAt) textLines.push("");
  textLines.push("Update your payment method to keep your subscription active:");
  if (updatePaymentUrl) textLines.push(updatePaymentUrl);
  if (billingUrl) textLines.push(`Manage billing: ${billingUrl}`);
  textLines.push("");
  textLines.push(
    "If the payment keeps failing, your workspace moves to a past-due state and loses access until it's resolved.",
  );

  const htmlParts = [
    `<p>We couldn't process the payment for <strong>${escapeHtml(amountClause)}</strong>.</p>`,
  ];
  const facts: string[] = [];
  if (attempt) facts.push(`<strong>Failed attempt:</strong> ${escapeHtml(attempt)}`);
  if (nextAttemptAt) facts.push(`<strong>Next automatic retry:</strong> ${escapeHtml(nextAttemptAt)}`);
  if (facts.length > 0) htmlParts.push(`<p>${facts.join("<br/>")}</p>`);
  htmlParts.push("<p>Update your payment method to keep your subscription active:</p>");
  if (updatePaymentUrl) {
    htmlParts.push(`<p><a href="${escapeHtml(updatePaymentUrl)}">Update payment method</a></p>`);
  }
  if (billingUrl) htmlParts.push(`<p><a href="${escapeHtml(billingUrl)}">Manage billing</a></p>`);
  htmlParts.push(
    "<p>If the payment keeps failing, your workspace moves to a past-due state and loses access until it's resolved.</p>",
  );

  return { subject, html: htmlParts.join(""), text: textLines.join("\n") };
}

registerTemplate("billing-receipt", renderBillingReceipt);
registerTemplate("billing-payment-failed", renderBillingPaymentFailed);

// ---------------------------------------------------------------------------
// Send helpers (best-effort — never throw)
// ---------------------------------------------------------------------------

export type BillingEmailStatus = "sent" | "suppressed" | "logged" | "skipped" | "failed";

export interface BillingReceiptArgs {
  to?: string | null;
  workspaceId?: string | null;
  planName?: string | null;
  amount: string;
  invoiceNumber?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  invoiceUrl?: string | null;
  invoicePdf?: string | null;
}

export interface BillingPaymentFailedArgs {
  to?: string | null;
  workspaceId?: string | null;
  planName?: string | null;
  amount?: string | null;
  attempt?: string | null;
  nextAttemptAt?: string | null;
  updatePaymentUrl?: string | null;
  billingUrl?: string | null;
}

async function deliverBillingEmail(
  mailer: Mailer,
  template: string,
  to: string | null | undefined,
  workspaceId: string | null | undefined,
  data: Record<string, unknown>,
  label: string,
): Promise<BillingEmailStatus> {
  const recipient = str(to);
  if (!recipient) {
    console.log(`[billing-email] ${label}: no recipient email — skipped`);
    return "skipped";
  }
  try {
    const result = await mailer.sendTemplate({
      template,
      to: recipient,
      data,
      workspaceId: workspaceId ?? null,
    });
    if (result.suppressed) {
      console.log(`[billing-email] ${label}: suppressed for ${recipient}`);
      return "suppressed";
    }
    if (result.providerMessageId) {
      console.log(`[billing-email] ${label}: sent to ${recipient} (${result.providerMessageId})`);
      return "sent";
    }
    return "logged";
  } catch (err) {
    console.error(`[billing-email] ${label}: failed for ${recipient}: ${(err as Error).message}`);
    return "failed";
  }
}

/** Best-effort billing receipt. Never throws (won't fail the Stripe webhook). */
export function sendBillingReceiptEmail(
  args: BillingReceiptArgs,
  mailer: Mailer = buildSystemMailer(),
): Promise<BillingEmailStatus> {
  return deliverBillingEmail(
    mailer,
    "billing-receipt",
    args.to,
    args.workspaceId,
    {
      planName: args.planName ?? undefined,
      amount: args.amount,
      invoiceNumber: args.invoiceNumber ?? undefined,
      periodStart: args.periodStart ?? undefined,
      periodEnd: args.periodEnd ?? undefined,
      invoiceUrl: args.invoiceUrl ?? undefined,
      invoicePdf: args.invoicePdf ?? undefined,
    },
    "receipt",
  );
}

/** Best-effort payment-failed (dunning) email. Never throws. */
export function sendBillingPaymentFailedEmail(
  args: BillingPaymentFailedArgs,
  mailer: Mailer = buildSystemMailer(),
): Promise<BillingEmailStatus> {
  return deliverBillingEmail(
    mailer,
    "billing-payment-failed",
    args.to,
    args.workspaceId,
    {
      planName: args.planName ?? undefined,
      amount: args.amount ?? undefined,
      attempt: args.attempt ?? undefined,
      nextAttemptAt: args.nextAttemptAt ?? undefined,
      updatePaymentUrl: args.updatePaymentUrl ?? undefined,
      billingUrl: args.billingUrl ?? undefined,
    },
    "payment-failed",
  );
}
