import clsx from "clsx";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  Clock3,
  Flag,
  Link2,
  MessageSquare,
  OctagonAlert,
  PauseCircle,
  ShieldAlert,
  Ticket,
  UserRound,
} from "lucide-react";
import type {
  TicketActorRef,
  TicketPriority,
  TicketRecord,
  TicketSlaState,
  TicketStatus,
  TicketUpdate,
} from "../../api/tickets";
import { getTicketActorProfile } from "../../api/tickets";

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

export function slaLabel(slaState: TicketSlaState | string): string {
  return String(slaState).replace("_", " ");
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

export function ticketSlaClasses(slaState: TicketSlaState | string): string {
  switch (slaState) {
    case "warning":
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

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
        ticketStatusClasses(status)
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statusLabel(status)}
    </span>
  );
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
        ticketPriorityClasses(priority)
      )}
    >
      <Flag size={12} />
      {priorityLabel(priority)}
    </span>
  );
}

export function TicketSlaBadge({ slaState }: { slaState: TicketSlaState | string }) {
  const Icon = slaState === "paused" ? PauseCircle : slaState === "breached" ? AlertCircle : Clock3;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
        ticketSlaClasses(slaState)
      )}
    >
      <Icon size={12} />
      {slaLabel(slaState)}
    </span>
  );
}

export function TicketActorChip({
  actor,
  role,
  compact = false,
}: {
  actor: TicketActorRef;
  role?: string;
  compact?: boolean;
}) {
  const profile = getTicketActorProfile(actor);
  const Icon = actor.type === "agent" ? Bot : UserRound;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 text-slate-200",
        compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
      )}
    >
      <span
        className={clsx(
          "inline-flex items-center justify-center rounded-full font-semibold",
          compact ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]",
          profile.tone === "teal" && "bg-teal-500/20 text-teal-200",
          profile.tone === "indigo" && "bg-indigo-500/20 text-indigo-200",
          profile.tone === "orange" && "bg-orange-500/20 text-orange-200",
          profile.tone === "slate" && "bg-slate-700 text-slate-200"
        )}
      >
        {profile.initials}
      </span>
      <span className="flex items-center gap-1 truncate">
        <Icon size={compact ? 12 : 13} />
        <span className="truncate">{profile.name}</span>
      </span>
      {role ? <span className="uppercase tracking-[0.16em] text-slate-500">{role}</span> : null}
    </span>
  );
}

export function TicketEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-800 bg-slate-950/60 px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-slate-500">
        <Ticket size={26} />
      </div>
      <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-slate-400">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function TicketSourceNotice({
  source,
  warnings = [],
}: {
  source: "api" | "mock";
  warnings?: string[];
}) {
  if (source === "api" && warnings.length === 0) return null;

  return (
    <div
      className={clsx(
        "rounded-2xl border px-4 py-3 text-sm",
        source === "mock"
          ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
          : "border-slate-700 bg-slate-900/70 text-slate-300"
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {source === "mock" ? <AlertCircle size={15} /> : <Link2 size={15} />}
        {source === "mock"
          ? "Showing local ticketing fallback data while the backend branch is still in review."
          : "Live ticket API connected."}
      </div>
      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-slate-400">
          {warnings.map((warning) => (
            <li key={warning}>- {warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TicketKpiCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-800 bg-slate-950/70 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

export function TicketRowMeta({
  ticket,
}: {
  ticket: TicketRecord;
}) {
  const owner = primaryAssignee(ticket);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span className="font-ticket-mono uppercase tracking-[0.16em] text-slate-400">{ticket.id}</span>
      {owner ? (
        <>
          <span className="text-slate-700">•</span>
          <span className="inline-flex items-center gap-1">
            {owner.type === "agent" ? <Bot size={12} /> : <UserRound size={12} />}
            {getTicketActorProfile(owner).name}
          </span>
        </>
      ) : null}
      {ticket.dueDate ? (
        <>
          <span className="text-slate-700">•</span>
          <span>Due {formatTicketTimestamp(ticket.dueDate)}</span>
        </>
      ) : null}
    </div>
  );
}

export function TicketUpdateCard({ update }: { update: TicketUpdate }) {
  const profile = getTicketActorProfile(update.actor);
  const Icon = ticketUpdateIcon(update);

  return (
    <article className="rounded-[24px] border border-slate-800 bg-slate-950/75 p-4">
      <div className="flex items-start gap-3">
        <div
          className={clsx(
            "mt-1 inline-flex h-10 w-10 items-center justify-center rounded-2xl border",
            ticketUpdateTone(update)
          )}
        >
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-100">{profile.name}</span>
            <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
              {update.type.replace("_", " ")}
            </span>
            <span className="text-xs text-slate-500">{relativeTicketTime(update.createdAt)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{update.content}</p>
          {Object.keys(update.metadata ?? {}).length > 0 ? (
            <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Metadata
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                {Object.entries(update.metadata).map(([key, value]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2.5 py-1"
                  >
                    <ArrowUpRight size={11} />
                    {key}: {String(value)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
