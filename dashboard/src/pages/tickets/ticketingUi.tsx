import clsx from "clsx";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  Flag,
  Link2,
  Ticket,
  UserRound,
} from "lucide-react";
import type { TicketActorRef, TicketPriority, TicketRecord, TicketSlaStateLike, TicketStatus, TicketUpdate } from "../../api/tickets";
import {
  formatTicketTimestamp,
  priorityLabel,
  relativeTicketTime,
  slaLabel,
  slaStateIcon,
  normalizeTicketSlaState,
  ticketPriorityClasses,
  ticketSlaClasses,
  ticketStatusClasses,
  ticketUpdateIcon,
  ticketUpdateTone,
  statusLabel,
  primaryAssignee,
  getTicketActorProfile,
} from "./ticketingUi.helpers";

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

export function TicketSlaBadge({ slaState }: { slaState: TicketSlaStateLike | string }) {
  const normalized = normalizeTicketSlaState(slaState);
  const Icon = slaStateIcon(normalized);
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-ticket-mono text-[10px] font-bold uppercase tracking-[0.2em] transition-colors duration-300 ease-in-out",
        ticketSlaClasses(normalized)
      )}
    >
      <Icon size={12} />
      {slaLabel(normalized)}
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
  const owner = ticket.assignees.find((a) => a.role === "primary");

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span className="font-ticket-mono uppercase tracking-[0.16em] text-slate-400">{ticket.id}</span>
      {owner ? (
        <>
          <span className="text-slate-700">&bull;</span>
          <span className="inline-flex items-center gap-1">
            {owner.type === "agent" ? <Bot size={12} /> : <UserRound size={12} />}
            {getTicketActorProfile(owner).name}
          </span>
        </>
      ) : null}
      {ticket.dueDate ? (
        <>
          <span className="text-slate-700">&bull;</span>
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
