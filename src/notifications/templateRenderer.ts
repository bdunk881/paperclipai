import {
  NotificationCadence,
  NotificationChannel,
  NotificationEventRecord,
  NotificationKind,
  RenderedNotificationTemplate,
} from "./types";

function titleForKind(kind: NotificationKind): string {
  switch (kind) {
    case "approvals":
      return "Approval update";
    case "milestones":
      return "Milestone update";
    case "kpi_alerts":
      return "KPI alert";
    case "budget_alerts":
      return "Budget alert";
    case "kill_switch":
      return "Kill switch alert";
  }
}

function cadenceLabel(cadence: NotificationCadence): string {
  switch (cadence) {
    case "immediate":
      return "Immediate";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    default:
      return "Notification";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderNotificationTemplate(input: {
  workspaceId: string;
  channel: NotificationChannel;
  kind: NotificationKind;
  cadence: Exclude<NotificationCadence, "off">;
  events: NotificationEventRecord[];
}): RenderedNotificationTemplate {
  const label = titleForKind(input.kind);
  const prefix = `${cadenceLabel(input.cadence)} ${label}`;
  const summaryLine =
    input.events.length === 1
      ? input.events[0]?.summary ?? ""
      : `${input.events.length} events require attention for workspace ${input.workspaceId}.`;

  const bullets = input.events.map((event) => `- ${event.title}: ${event.summary}`);
  const subject = `${prefix} · ${input.workspaceId}`;
  const text = [subject, "", summaryLine, "", ...bullets].join("\n");
  const html = [
    `<h2>${escapeHtml(subject)}</h2>`,
    `<p>${escapeHtml(summaryLine)}</p>`,
    "<ul>",
    ...input.events.map((event) => `<li><strong>${escapeHtml(event.title)}</strong>: ${escapeHtml(event.summary)}</li>`),
    "</ul>",
  ].join("");
  const slack = [`*${subject}*`, summaryLine, ...bullets].join("\n");
  const smsSource = input.events[0];
  const sms = input.events.length === 1
    ? `${prefix}: ${smsSource?.title ?? label} - ${smsSource?.summary ?? ""}`.slice(0, 320)
    : `${prefix}: ${input.events.length} events pending. Review dashboard for details.`.slice(0, 320);

  return { subject, text, html, sms, slack };
}
