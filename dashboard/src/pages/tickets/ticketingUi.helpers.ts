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

export function ticketStatusClasses(status: TicketStatus): string {
  switch (status) {
    case "open":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-200";
    case "in_progress":
      return "border-teal-500/30 bg-teal-500/10 text-teal-200";
    case "blocked":
      return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    case "resolved":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
    case "cancelled":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
    default:
      return "border-slate-700 bg-slate-900/70 text-slate-300";
  }
}

export function ticketPriorityClasses(priority: TicketPriority): string {
  switch (priority) {
    case "urgent":
      return "border-[#FF5F57]/30 bg-[#FF5F57]/10 text-[#ff9f9b]";
    case "high":
      return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    case "medium":
      return "border-teal-500/30 bg-teal-500/10 text-teal-200";
    case "low":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
    default:
      return "border-slate-700 bg-slate-900/70 text-slate-300";
  }
}

export function ticketSlaClasses(slaState: TicketSlaStateLike | string): string {
  switch (normalizeTicketSlaState(slaState)) {
    case "at_risk":
      return "border-[#FFD93D]/30 bg-[#FFD93D]/10 text-[#fde68a]";
    case "breached":
      return "border-[#FF5F57]/30 bg-[#FF5F57]/10 text-[#ff9f9b]";
    case "paused":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
    case "on_track":
      return "border-teal-500/30 bg-teal-500/10 text-teal-200";
    default:
      return "border-slate-700 bg-slate-900/70 text-slate-300";
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
      return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    case "structured_update":
      return "border-teal-500/30 bg-teal-500/10 text-teal-200";
    case "comment":
    default:
      return "border-slate-700 bg-slate-900/70 text-slate-300";
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
