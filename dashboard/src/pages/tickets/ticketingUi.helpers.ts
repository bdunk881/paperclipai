import {
  getTicketActorProfile,
  normalizeTicketSlaState,
  type TicketActorRef,
  type TicketPriority,
  type TicketRecord,
  type TicketSlaStateLike,
  type TicketStatus,
  type TicketUpdate,
} from "../../api/tickets";
import { AlertTriangle, CheckCircle2, MessageSquare, OctagonAlert, PauseCircle, ShieldAlert, XCircle } from "lucide-react";

export function formatTicketTimestamp(value?: string): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function relativeTicketTime(value?: string): string {
  if (!value) return "No activity";

  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function statusLabel(status: TicketStatus): string {
  return status.replace("_", " ");
}

export function priorityLabel(priority: TicketPriority): string {
  return priority;
}

export function slaLabel(slaState: TicketSlaStateLike | string): string {
  return normalizeTicketSlaState(slaState).replace("_", " ");
}

// DASH-35: V2 token palette for ticket status / priority / SLA badges.
//
// Mapping from V1 dark-mode chip colors to af2 editorial tones:
//   sage    = healthy / in-progress / on-track  (var(--af2-sage))
//   mustard = warning / blocked / at-risk       (var(--af2-mustard))
//   clay    = critical / urgent / breached      (var(--af2-clay))
//   ink     = neutral / open / new              (var(--af2-ink))
//   muted   = inactive / resolved / paused / low (var(--af2-ink-3))
//
// Returned class strings rely on the af2 color tokens compiled by
// Tailwind from `tailwind.config.js` (text-af2-* + bg-af2-* + border-af2-*).
// Keeping the chip shape identical across tones so layout doesn't shift
// when a ticket moves states.

export function ticketStatusClasses(status: TicketStatus): string {
  switch (status) {
    case "open":
      return "border-af2-line bg-af2-paper-2 text-af2-ink";
    case "in_progress":
      return "border-af2-sage/30 bg-af2-sage/10 text-af2-sage";
    case "blocked":
      return "border-af2-mustard/30 bg-af2-mustard/10 text-af2-mustard";
    case "resolved":
      return "border-af2-line bg-af2-paper-2 text-af2-ink-3";
    case "cancelled":
      return "border-af2-clay/30 bg-af2-clay/10 text-af2-clay";
    default:
      return "border-af2-line bg-af2-paper-2 text-af2-ink-2";
  }
}

export function ticketPriorityClasses(priority: TicketPriority): string {
  switch (priority) {
    case "urgent":
      return "border-af2-clay/30 bg-af2-clay/10 text-af2-clay";
    case "high":
      return "border-af2-mustard/30 bg-af2-mustard/10 text-af2-mustard";
    case "medium":
      return "border-af2-line bg-af2-paper-2 text-af2-ink";
    case "low":
      return "border-af2-line bg-af2-paper-2 text-af2-ink-3";
    default:
      return "border-af2-line bg-af2-paper-2 text-af2-ink-2";
  }
}

export function ticketSlaClasses(slaState: TicketSlaStateLike | string): string {
  switch (normalizeTicketSlaState(slaState)) {
    case "at_risk":
      return "border-af2-mustard/30 bg-af2-mustard/10 text-af2-mustard";
    case "breached":
      return "border-af2-clay/30 bg-af2-clay/10 text-af2-clay";
    case "paused":
      return "border-af2-line bg-af2-paper-2 text-af2-ink-3";
    case "on_track":
      return "border-af2-sage/30 bg-af2-sage/10 text-af2-sage";
    default:
      return "border-af2-line bg-af2-paper-2 text-af2-ink-2";
  }
}

export function ticketUpdateIcon(update: TicketUpdate) {
  switch (update.type) {
    case "status_change":
      return OctagonAlert;
    case "structured_update":
      return ShieldAlert;
    case "comment":
    default:
      return MessageSquare;
  }
}

export function ticketUpdateTone(update: TicketUpdate): string {
  switch (update.type) {
    case "status_change":
      return "border-af2-mustard/30 bg-af2-mustard/10 text-af2-mustard";
    case "structured_update":
      return "border-af2-sage/30 bg-af2-sage/10 text-af2-sage";
    case "comment":
    default:
      return "border-af2-line bg-af2-paper-2 text-af2-ink-2";
  }
}

export function primaryAssignee(ticket: TicketRecord): TicketActorRef | undefined {
  return ticket.assignees.find((assignee) => assignee.role === "primary");
}

export function collaboratorCount(ticket: TicketRecord): number {
  return ticket.assignees.filter((assignee) => assignee.role === "collaborator").length;
}

export function aggregateActorCounts(tickets: TicketRecord[]) {
  const counts = new Map<
    string,
    TicketActorRef & {
      open: number;
      in_progress: number;
      resolved: number;
      blocked: number;
      cancelled: number;
      total: number;
    }
  >();

  for (const ticket of tickets) {
    for (const assignee of ticket.assignees) {
      const key = `${assignee.type}:${assignee.id}`;
      const current =
        counts.get(key) ??
        ({
          type: assignee.type,
          id: assignee.id,
          open: 0,
          in_progress: 0,
          resolved: 0,
          blocked: 0,
          cancelled: 0,
          total: 0,
        } as const);

      counts.set(key, {
        ...current,
        [ticket.status]: current[ticket.status] + 1,
        total: current.total + 1,
      });
    }
  }

  return [...counts.values()].sort((left, right) => right.total - left.total);
}

export function slaStateIcon(slaState: TicketSlaStateLike | string) {
  const normalized = normalizeTicketSlaState(slaState);
  return normalized === "paused"
    ? PauseCircle
    : normalized === "breached"
      ? XCircle
      : normalized === "at_risk"
        ? AlertTriangle
        : CheckCircle2;
}

export { getTicketActorProfile, normalizeTicketSlaState };
