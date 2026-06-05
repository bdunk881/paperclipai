/**
 * System email templates (HEL-362+). Each renderer turns template data into a
 * {@link RenderedEmail} and self-registers in the template registry on import,
 * so importing this module makes the templates available to any Mailer. Add new
 * system templates (billing-receipt, system-status-notice, …) here as their
 * tickets land.
 */

import { registerTemplate, RenderedEmail } from "./templates";

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

/** workspace-invite (HEL-362): invites a teammate to a workspace. */
export function renderWorkspaceInvite(data: Record<string, unknown>): RenderedEmail {
  const workspaceName = str(data.workspaceName) ?? "an AutoFlow workspace";
  const inviterName = str(data.inviterName);
  const inviteLink = str(data.inviteLink) ?? "";
  const role = str(data.role) ?? "member";
  const expiresAt = str(data.expiresAt);

  const byText = inviterName ? ` by ${inviterName}` : "";
  const byHtml = inviterName ? ` by ${escapeHtml(inviterName)}` : "";

  const subject = `You've been invited to ${workspaceName} on AutoFlow`;
  const text =
    `You've been invited${byText} to join ${workspaceName} on AutoFlow as a ${role}.\n\n` +
    `Accept your invite:\n${inviteLink}\n\n` +
    (expiresAt ? `This invite expires on ${expiresAt}.\n\n` : "") +
    `If you weren't expecting this, you can safely ignore this email.`;
  const html =
    `<p>You've been invited${byHtml} to join <strong>${escapeHtml(workspaceName)}</strong> on AutoFlow as a <strong>${escapeHtml(role)}</strong>.</p>` +
    `<p><a href="${escapeHtml(inviteLink)}">Accept your invite</a></p>` +
    (expiresAt ? `<p>This invite expires on ${escapeHtml(expiresAt)}.</p>` : "") +
    `<p>If you weren't expecting this, you can safely ignore this email.</p>`;

  return { subject, html, text };
}

registerTemplate("workspace-invite", renderWorkspaceInvite);

/**
 * approval-request-out-of-band (HEL-364): sent via the internal SES mailer when
 * a workspace has no other configured notification sender, so a pending
 * approval can still leave the app. Carries the approval question, the
 * requesting workflow + step, the expiry, and review / approve / deny deep
 * links into the dashboard. All fields beyond the question degrade gracefully.
 */
export function renderApprovalRequestOutOfBand(data: Record<string, unknown>): RenderedEmail {
  const workflowName = str(data.workflowName) ?? "a workflow";
  const stepName = str(data.stepName);
  const message = str(data.message) ?? "A workflow approval needs your review.";
  const requestedAt = str(data.requestedAt);
  const expiresAt = str(data.expiresAt);
  const reviewUrl = str(data.reviewUrl);
  const approveUrl = str(data.approveUrl);
  const denyUrl = str(data.denyUrl);

  const stepText = stepName ? ` (step "${stepName}")` : "";
  const stepHtml = stepName ? ` (step <strong>${escapeHtml(stepName)}</strong>)` : "";

  const subject = stepName
    ? `Approval needed: ${workflowName} — ${stepName}`
    : `Approval needed: ${workflowName}`;

  const textLines = [
    `${workflowName}${stepText} needs your approval on AutoFlow.`,
    "",
    message,
    "",
  ];
  if (requestedAt) textLines.push(`Requested at: ${requestedAt}`);
  if (expiresAt) textLines.push(`Responds by: ${expiresAt}`);
  if (requestedAt || expiresAt) textLines.push("");
  if (approveUrl) textLines.push(`Approve: ${approveUrl}`);
  if (denyUrl) textLines.push(`Deny: ${denyUrl}`);
  if (reviewUrl) textLines.push(`Review in AutoFlow: ${reviewUrl}`);
  if (approveUrl || denyUrl || reviewUrl) textLines.push("");
  textLines.push("If you weren't expecting this, you can safely ignore this email.");

  const htmlParts = [
    `<p><strong>${escapeHtml(workflowName)}</strong>${stepHtml} needs your approval on AutoFlow.</p>`,
    `<p>${escapeHtml(message)}</p>`,
  ];
  if (requestedAt) htmlParts.push(`<p><strong>Requested at:</strong> ${escapeHtml(requestedAt)}</p>`);
  if (expiresAt) htmlParts.push(`<p><strong>Responds by:</strong> ${escapeHtml(expiresAt)}</p>`);
  if (approveUrl || denyUrl) {
    const buttons: string[] = [];
    if (approveUrl) buttons.push(`<a href="${escapeHtml(approveUrl)}">Approve</a>`);
    if (denyUrl) buttons.push(`<a href="${escapeHtml(denyUrl)}">Deny</a>`);
    htmlParts.push(`<p>${buttons.join(" &nbsp;·&nbsp; ")}</p>`);
  }
  if (reviewUrl) htmlParts.push(`<p><a href="${escapeHtml(reviewUrl)}">Review in AutoFlow</a></p>`);
  htmlParts.push(`<p>If you weren't expecting this, you can safely ignore this email.</p>`);

  return { subject, html: htmlParts.join(""), text: textLines.join("\n") };
}

registerTemplate("approval-request-out-of-band", renderApprovalRequestOutOfBand);
