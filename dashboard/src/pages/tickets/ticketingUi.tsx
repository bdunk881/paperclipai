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
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-af2-mono text-[10px] font-bold uppercase tracking-[0.2em] transition-colors duration-300 ease-in-out",
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

  // DASH-35: avatar tone palette maps to af2 editorial colors.
  // teal → sage (agent default), indigo → clay (executive),
  // orange → mustard, slate → muted.
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border border-af2-line bg-af2-card text-af2-ink",
        compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
      )}
    >
      <span
        className={clsx(
          "inline-flex items-center justify-center rounded-full font-semibold",
          compact ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]",
          profile.tone === "teal" && "bg-af2-sage/15 text-af2-sage",
          profile.tone === "indigo" && "bg-af2-clay/15 text-af2-clay",
          profile.tone === "orange" && "bg-af2-mustard/15 text-af2-mustard",
          profile.tone === "slate" && "bg-af2-paper-2 text-af2-ink-2"
        )}
      >
        {profile.initials}
      </span>
      <span className="flex items-center gap-1 truncate">
        <Icon size={compact ? 12 : 13} />
        <span className="truncate">{profile.name}</span>
      </span>
      {role ? (
        <span className="uppercase tracking-[0.16em] text-af2-ink-3 text-[10px]">
          {role}
        </span>
      ) : null}
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
    <div className="af2-card flex min-h-[220px] flex-col items-center justify-center border-dashed px-6 py-10 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-af2-line bg-af2-paper-2 text-af2-ink-3">
        <Ticket size={22} />
      </div>
      <h2 className="font-af2-serif text-lg text-af2-ink">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-af2-ink-2">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function TicketSourceNotice({
  source,
  warnings = [],
}: {
  source: "api" | "mock" | null;
  warnings?: string[];
}) {
  if (!source || (source === "api" && warnings.length === 0)) return null;

  return (
    <div
      className={clsx(
        "rounded-md border px-4 py-3 text-sm",
        source === "mock"
          ? "border-af2-mustard/30 bg-af2-mustard/10 text-af2-mustard"
          : "border-af2-line bg-af2-paper-2 text-af2-ink-2"
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {source === "mock" ? <AlertCircle size={15} /> : <Link2 size={15} />}
        {source === "mock"
          ? "Showing local ticketing fallback data while the backend branch is still in review."
          : "Live ticket API connected."}
      </div>
      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-af2-ink-3">
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
    <div className="af2-card px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
        {label}
      </p>
      <p className="font-af2-serif mt-2 text-2xl font-semibold text-af2-ink">
        {value}
      </p>
      <p className="mt-2 text-xs text-af2-ink-3">{helper}</p>
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
    <div className="flex flex-wrap items-center gap-2 text-xs text-af2-ink-3">
      <span className="font-af2-mono uppercase tracking-[0.16em]">{ticket.id}</span>
      {owner ? (
        <>
          <span className="text-af2-line-2">&bull;</span>
          <span className="inline-flex items-center gap-1">
            {owner.type === "agent" ? <Bot size={12} /> : <UserRound size={12} />}
            {getTicketActorProfile(owner).name}
          </span>
        </>
      ) : null}
      {ticket.dueDate ? (
        <>
          <span className="text-af2-line-2">&bull;</span>
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
    <article className="af2-card p-4">
      <div className="flex items-start gap-3">
        <div
          className={clsx(
            "mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full border",
            ticketUpdateTone(update)
          )}
        >
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-af2-ink">{profile.name}</span>
            <span className="text-[11px] uppercase tracking-[0.16em] text-af2-ink-3">
              {update.type.replace("_", " ")}
            </span>
            <span className="text-xs text-af2-ink-3">
              {relativeTicketTime(update.createdAt)}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-af2-ink-2">
            {update.content}
          </p>
          {Object.keys(update.metadata ?? {}).length > 0 ? (
            <div className="mt-3 rounded-md border border-af2-line bg-af2-paper-2 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
                Metadata
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-af2-ink-2">
                {Object.entries(update.metadata).map(([key, value]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full border border-af2-line bg-af2-card px-2.5 py-1"
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
