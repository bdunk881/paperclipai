import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  getTicketActorProfile,
  listTicketQueue,
  type TicketPriority,
  type TicketRecord,
  type TicketStatus,
  type TicketSlaState,
} from "../api/tickets";
import { useAuth } from "../context/AuthContext";
import {
  TicketActorChip,
  TicketEmptyState,
  TicketPriorityBadge,
  TicketSlaBadge,
  TicketSourceNotice,
  TicketStatusBadge,
  primaryAssignee,
  relativeTicketTime,
} from "./tickets/ticketingUi";

type StatusFilter = TicketStatus | "all";
type PriorityFilter = TicketPriority | "all";
type SlaFilter = TicketSlaState | "all";

export default function TicketActorView() {
  const { actorType, actorId } = useParams<{ actorType: "agent" | "user"; actorId: string }>();
  const { getAccessToken } = useAuth();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock">("mock");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [slaFilter, setSlaFilter] = useState<SlaFilter>("all");

  const actor = actorType && actorId ? { type: actorType, id: actorId } : null;
  const profile = actor ? getTicketActorProfile(actor) : null;

  const load = useCallback(async () => {
    if (!actor) return;
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const response = await listTicketQueue(actor, accessToken);
      setTickets(response.tickets);
      setSource(response.source);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load actor queue");
    } finally {
      setLoading(false);
    }
  }, [actor, getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return tickets.filter((ticket) => {
      if (statusFilter !== "all" && ticket.status !== statusFilter) return false;
      if (priorityFilter !== "all" && ticket.priority !== priorityFilter) return false;
      if (slaFilter !== "all" && ticket.slaState !== slaFilter) return false;
      return true;
    });
  }, [priorityFilter, slaFilter, statusFilter, tickets]);

  if (!actor || !profile) {
    return (
      <div className="min-h-full bg-[#0b1120] p-8">
        <TicketEmptyState title="Actor not found" body="The queue owner could not be resolved." />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#0b1120] text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <section className="rounded-[30px] border border-slate-800/80 bg-slate-950/85 px-6 py-6 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link
                to="/tickets/team"
                className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-100"
              >
                <ArrowLeft size={14} />
                Back to team view
              </Link>
              <div className="mt-4">
                <TicketActorChip actor={actor} role="Queue owner" />
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-100">{profile.name}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Filter this actor's queue by status, priority, and SLA state without leaving the ticketing context.
              </p>
            </div>

            <button
              onClick={() => {
                void load();
              }}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-indigo-500/30 hover:text-slate-100"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          <div className="mt-5">
            <TicketSourceNotice source={source} />
          </div>
        </section>

        <section className="rounded-[30px] border border-slate-800 bg-slate-950/80 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <QueueSelect
              label="Status"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={["all", "open", "in_progress", "blocked", "resolved", "cancelled"]}
            />
            <QueueSelect
              label="Priority"
              value={priorityFilter}
              onChange={(value) => setPriorityFilter(value as PriorityFilter)}
              options={["all", "urgent", "high", "medium", "low"]}
            />
            <QueueSelect
              label="SLA"
              value={slaFilter}
              onChange={(value) => setSlaFilter(value as SlaFilter)}
              options={["all", "breached", "warning", "on_track", "paused"]}
            />
          </div>
        </section>

        {loading ? (
          <div className="scanline-skeleton min-h-[360px] rounded-[28px]" />
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <TicketEmptyState
            title="No tickets match these filters"
            body="This actor queue is clear for the selected slice."
          />
        ) : (
          <div className="space-y-4">
            {filtered.map((ticket) => (
              <Link
                key={ticket.id}
                to={`/tickets/${ticket.id}`}
                className="block rounded-[28px] border border-slate-800 bg-slate-950/80 px-5 py-5 transition hover:border-teal-500/30 hover:bg-slate-900/80"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-ticket-mono text-xs uppercase tracking-[0.18em] text-slate-400">
                        {ticket.id}
                      </span>
                      <TicketStatusBadge status={ticket.status} />
                      <TicketPriorityBadge priority={ticket.priority} />
                      <TicketSlaBadge slaState={ticket.slaState} />
                    </div>
                    <h2 className="mt-3 text-lg font-semibold text-slate-100">{ticket.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {ticket.description || "No description provided."}
                    </p>
                  </div>

                  {primaryAssignee(ticket) ? (
                    <TicketActorChip actor={primaryAssignee(ticket)!} role="Primary" compact />
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span>Updated {relativeTicketTime(ticket.updatedAt)}</span>
                  <span>•</span>
                  <span>{ticket.tags.length ? ticket.tags.join(", ") : "No tags"}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? `All ${label}` : option.replace("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
