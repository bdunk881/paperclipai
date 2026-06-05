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
