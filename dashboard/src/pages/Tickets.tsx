import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Users2,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  collectKnownActors,
  createTicket,
  getTicketActorProfile,
  listTickets,
  normalizeTicketSlaState,
  type CreateTicketUiPayload,
  type TicketActorRef,
  type TicketPriority,
  type TicketRecord,
  type TicketSlaStateLike,
  type TicketStatus,
} from "../api/tickets";
import { useAuth } from "../context/AuthContext";
import {
  TicketActorChip,
  TicketEmptyState,
  TicketKpiCard,
  TicketPriorityBadge,
  TicketRowMeta,
  TicketSlaBadge,
  TicketSourceNotice,
  TicketStatusBadge,
} from "./tickets/ticketingUi";
import { collaboratorCount, primaryAssignee, relativeTicketTime } from "./tickets/ticketingUtils";

type StatusFilter = TicketStatus | "all";
type PriorityFilter = TicketPriority | "all";
type SlaFilter = TicketSlaStateLike | "all";

const STATUS_OPTIONS: StatusFilter[] = ["all", "open", "in_progress", "blocked", "resolved", "cancelled"];
const PRIORITY_OPTIONS: PriorityFilter[] = ["all", "urgent", "high", "medium", "low"];
const SLA_OPTIONS: SlaFilter[] = ["all", "breached", "at_risk", "on_track", "paused"];

const EMPTY_FORM = {
  title: "",
  description: "",
  priority: "medium" as TicketPriority,
  primaryActorKey: "",
  collaboratorKeys: [] as string[],
  dueDate: "",
  tags: "",
  attachmentNames: [] as string[],
  externalSyncRequested: false,
};

export default function Tickets() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { getAccessToken } = useAuth();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock">("mock");
  const [integrationWarnings, setIntegrationWarnings] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const value = searchParams.get("status");
    return STATUS_OPTIONS.includes(value as StatusFilter) ? (value as StatusFilter) : "all";
  });
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(() => {
    const value = searchParams.get("priority");
    return PRIORITY_OPTIONS.includes(value as PriorityFilter) ? (value as PriorityFilter) : "all";
  });
  const [slaFilter, setSlaFilter] = useState<SlaFilter>(() => {
    const value = searchParams.get("sla");
    return SLA_OPTIONS.includes(value as SlaFilter) ? (value as SlaFilter) : "all";
  });
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [formState, setFormState] = useState(EMPTY_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const response = await listTickets({}, accessToken);
      setTickets(response.tickets);
      setSource(response.source);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    const sla = searchParams.get("sla");
    setStatusFilter(STATUS_OPTIONS.includes(status as StatusFilter) ? (status as StatusFilter) : "all");
    setPriorityFilter(
      PRIORITY_OPTIONS.includes(priority as PriorityFilter) ? (priority as PriorityFilter) : "all"
    );
    setSlaFilter(SLA_OPTIONS.includes(sla as SlaFilter) ? (sla as SlaFilter) : "all");
  }, [searchParams]);

  const actorOptions = useMemo(() => collectKnownActors(tickets), [tickets]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (statusFilter !== "all" && ticket.status !== statusFilter) return false;
      if (priorityFilter !== "all" && ticket.priority !== priorityFilter) return false;
      if (slaFilter !== "all" && normalizeTicketSlaState(ticket.slaState) !== slaFilter) return false;
      if (!query.trim()) return true;
      const normalized = query.trim().toLowerCase();
      const owner = primaryAssignee(ticket);
      return (
        ticket.title.toLowerCase().includes(normalized) ||
        ticket.id.toLowerCase().includes(normalized) ||
        ticket.description.toLowerCase().includes(normalized) ||
        ticket.tags.some((tag) => tag.toLowerCase().includes(normalized)) ||
        (owner ? getTicketActorProfile(owner).name.toLowerCase().includes(normalized) : false)
      );
    });
  }, [priorityFilter, query, slaFilter, statusFilter, tickets]);

  const counts = useMemo(() => {
    return {
      total: tickets.length,
      active: tickets.filter((ticket) => ticket.status === "in_progress").length,
      blocked: tickets.filter((ticket) => ticket.status === "blocked").length,
      urgent: tickets.filter((ticket) => ticket.priority === "urgent").length,
    };
  }, [tickets]);

  async function handleCreateTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    if (!formState.title.trim()) {
      setValidationError("Title is required.");
      return;
    }

    if (!formState.primaryActorKey) {
      setValidationError("Choose a primary assignee.");
      return;
    }

    const assignees = buildAssignees(formState.primaryActorKey, formState.collaboratorKeys);
    const payload: CreateTicketUiPayload = {
      title: formState.title.trim(),
      description: formState.description.trim(),
      priority: formState.priority,
      dueDate: formState.dueDate ? new Date(formState.dueDate).toISOString() : undefined,
      tags: formState.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      assignees,
      attachmentNames: formState.attachmentNames,
      externalSyncRequested: formState.externalSyncRequested,
    };

    setSubmitting(true);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const created = await createTicket(payload, accessToken);
      setIntegrationWarnings(created.integrationWarnings);
      setSource(created.source);
      setTickets((current) => [created.ticket, ...current]);
      setCreateOpen(false);
      setFormState(EMPTY_FORM);
      navigate(`/tickets/${created.ticket.id}`);
    } catch (submitError) {
      setValidationError(
        submitError instanceof Error ? submitError.message : "Unable to create ticket."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full bg-[#0b1120] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <section className="glass-card noise-overlay overflow-hidden rounded-[30px] border border-slate-800/80 bg-slate-950/80">
          <div className="relative border-b border-slate-800/80 px-6 py-6 md:px-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(20,184,166,0.14),transparent_30%)]" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-200">
                  <Filter size={12} />
                  Operational Clarity
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-100">
                  Ticketing Command Surface
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Monitor execution, triage blocked work, and launch new tickets with a view that
                  keeps humans and agents in the same operating lane.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/tickets/sla"
                  className="inline-flex items-center gap-2 rounded-full border border-[#FFD93D]/30 bg-[#FFD93D]/10 px-4 py-2 text-sm font-medium text-[#fde68a] transition hover:border-[#FFD93D]/50 hover:text-[#fff1a6]"
                >
                  SLA monitor
                </Link>
                <Link
                  to="/settings/ticketing-sla"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-indigo-500/40 hover:text-indigo-100"
                >
                  SLA settings
                </Link>
                <Link
                  to="/tickets/team"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-teal-500/40 hover:text-teal-200"
                >
                  <Users2 size={15} />
                  Team view
                </Link>
                <button
                  onClick={() => setCreateOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-400"
                >
                  <Plus size={15} />
                  Create ticket
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-b border-slate-800/70 px-6 py-6 md:grid-cols-4 md:px-8">
            <TicketKpiCard label="Queue" value={String(counts.total)} helper="Open scope across the workspace." />
            <TicketKpiCard label="Executing" value={String(counts.active)} helper="Tickets currently in flight." />
            <TicketKpiCard label="Blocked" value={String(counts.blocked)} helper="Needs external action or dependency." />
            <TicketKpiCard label="Urgent" value={String(counts.urgent)} helper="Coral priority tickets at risk." />
          </div>

          <div className="space-y-5 px-6 py-6 md:px-8">
            <TicketSourceNotice source={source} warnings={integrationWarnings} />

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_repeat(3,180px)_auto]">
              <label className="relative block">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by title, ID, tag, or owner"
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 py-3 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </label>

              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={(value) => setStatusFilter(value as StatusFilter)}
                options={STATUS_OPTIONS}
              />
              <FilterSelect
                label="Priority"
                value={priorityFilter}
                onChange={(value) => setPriorityFilter(value as PriorityFilter)}
                options={PRIORITY_OPTIONS}
              />
              <FilterSelect
                label="SLA"
                value={slaFilter}
                onChange={(value) => setSlaFilter(value as SlaFilter)}
                options={SLA_OPTIONS}
              />

              <button
                onClick={() => {
                  void loadTickets();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm font-medium text-slate-300 transition hover:border-indigo-500/30 hover:text-slate-100"
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            </div>

            {loading ? (
              <TicketListSkeleton />
            ) : error ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : filteredTickets.length === 0 ? (
              <TicketEmptyState
                title="No tickets found"
                body="Adjust filters or create a new ticket to start the queue."
                action={
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400"
                  >
                    <Plus size={15} />
                    Start a ticket
                  </button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950/80">
                <div className="hidden grid-cols-[120px_minmax(0,1.4fr)_180px_170px_150px_110px] gap-4 border-b border-slate-800 bg-slate-900/85 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid">
                  <span>Ticket</span>
                  <span>Summary</span>
                  <span>Owner</span>
                  <span>Status</span>
                  <span>Priority</span>
                  <span>SLA</span>
                </div>
                <div className="divide-y divide-slate-800/80">
                  {filteredTickets.map((ticket) => (
                    <Link
                      key={ticket.id}
                      to={`/tickets/${ticket.id}`}
                      className="group grid gap-4 border-l-[2px] border-transparent bg-[#0f172a] px-5 py-4 transition hover:border-indigo-500 hover:bg-slate-800/50 lg:grid-cols-[120px_minmax(0,1.4fr)_180px_170px_150px_110px]"
                    >
                      <div className="space-y-2">
                        <p className="font-ticket-mono text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
                          {ticket.id}
                        </p>
                        <p className="text-[11px] text-slate-500">Updated {relativeTicketTime(ticket.updatedAt)}</p>
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold text-slate-100 group-hover:text-white">
                              {ticket.title}
                            </h2>
                            <p className="mt-1 line-clamp-2 text-sm text-slate-400">
                              {ticket.description || "No description provided."}
                            </p>
                          </div>
                          <ArrowRight
                            size={16}
                            className="mt-0.5 hidden shrink-0 text-slate-600 transition group-hover:translate-x-1 group-hover:text-indigo-300 lg:block"
                          />
                        </div>
                        <div className="mt-3">
                          <TicketRowMeta ticket={ticket} />
                        </div>
                      </div>

                      <div className="flex items-center">
                        {primaryAssignee(ticket) ? (
                          <TicketActorChip actor={primaryAssignee(ticket)!} compact />
                        ) : (
                          <span className="text-xs text-slate-500">No owner</span>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <TicketStatusBadge status={ticket.status} />
                        <span className="text-xs text-slate-500">
                          {collaboratorCount(ticket)} collaborator{collaboratorCount(ticket) === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="flex items-center">
                        <TicketPriorityBadge priority={ticket.priority} />
                      </div>

                      <div className="flex items-center">
                        <TicketSlaBadge slaState={ticket.slaState} />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 px-4 py-6 md:items-center">
          <button
            className="absolute inset-0"
            onClick={() => {
              setCreateOpen(false);
              setValidationError(null);
            }}
            aria-label="Close create ticket modal"
          />
          <form
            onSubmit={(event) => {
              void handleCreateTicket(event);
            }}
            className="animate-ticket-modal relative z-10 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[30px] border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(7,12,24,0.98))] p-6 shadow-2xl md:p-7"
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-300">
                  Create Ticket
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-100">Capture work with full operating context</h2>
                <p className="mt-2 text-sm text-slate-400">
                  The M1 backend supports core ticket creation, assignment, and activity. Attachments and external sync stay staged in the UI until later milestones land.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-full border border-slate-700 p-2 text-slate-400 transition hover:border-slate-500 hover:text-slate-100"
                aria-label="Close create modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid gap-5">
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Title</span>
                <input
                  autoFocus
                  aria-label="Ticket title"
                  value={formState.title}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="Describe the task outcome"
                  className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Description</span>
                <textarea
                  rows={5}
                  aria-label="Ticket description"
                  value={formState.description}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Markdown-ready execution context, expected artifacts, blockers, and customer impact."
                  className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SelectField
                  label="Primary assignee"
                  value={formState.primaryActorKey}
                  onChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      primaryActorKey: value,
                      collaboratorKeys: current.collaboratorKeys.filter((entry) => entry !== value),
                    }))
                  }
                  options={actorOptions.map((actor) => ({
                    value: `${actor.type}:${actor.id}`,
                    label: `${getTicketActorProfile(actor).name} (${actor.type})`,
                  }))}
                  placeholder="Choose an owner"
                />
                <SelectField
                  label="Priority"
                  value={formState.priority}
                  onChange={(value) =>
                    setFormState((current) => ({ ...current, priority: value as TicketPriority }))
                  }
                  options={PRIORITY_OPTIONS.filter((entry) => entry !== "all").map((priority) => ({
                    value: priority,
                    label: priority,
                  }))}
                />
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Due date</span>
                  <input
                    type="datetime-local"
                    aria-label="Ticket due date"
                    value={formState.dueDate}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, dueDate: event.target.value }))
                    }
                    className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tags</span>
                  <input
                    aria-label="Ticket tags"
                    value={formState.tags}
                    onChange={(event) =>
                      setFormState((current) => ({ ...current, tags: event.target.value }))
                    }
                    placeholder="launch, ui, escalation"
                    className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </label>
              </div>

              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Collaborators</span>
                <select
                  aria-label="Ticket collaborators"
                  multiple
                  value={formState.collaboratorKeys}
                  onChange={(event) => {
                    const nextValues = Array.from(event.target.selectedOptions, (option) => option.value);
                    setFormState((current) => ({
                      ...current,
                      collaboratorKeys: nextValues.filter((value) => value !== current.primaryActorKey),
                    }));
                  }}
                  className="min-h-[124px] rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
                >
                  {actorOptions.map((actor) => {
                    const value = `${actor.type}:${actor.id}`;
                    return (
                      <option key={value} value={value}>
                        {getTicketActorProfile(actor).name} ({actor.type})
                      </option>
                    );
                  })}
                </select>
                <span className="text-xs text-slate-500">
                  Hold Cmd/Ctrl to select multiple collaborators.
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Attachments</span>
                  <input
                    type="file"
                    aria-label="Ticket attachments"
                    multiple
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        attachmentNames: Array.from(event.target.files ?? []).map((file) => file.name),
                      }))
                    }
                    className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-400 file:mr-3 file:rounded-full file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-100 hover:border-slate-600"
                  />
                  {formState.attachmentNames.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {formState.attachmentNames.map((name) => (
                        <span
                          key={name}
                          className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </label>

                <label className="flex items-center gap-3 rounded-[24px] border border-slate-800 bg-slate-950/60 px-4 py-4">
                  <input
                    type="checkbox"
                    aria-label="Request external sync"
                    checked={formState.externalSyncRequested}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        externalSyncRequested: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-teal-400 focus:ring-teal-400"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-200">Request external sync</p>
                    <p className="text-xs text-slate-500">UI ready now, integration wiring in M4.</p>
                  </div>
                </label>
              </div>
            </div>

            {validationError ? (
              <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {validationError}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 border-t border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Ticket IDs, assignees, and activity stream map to the live backend contract. Attachments and sync preferences are preserved for later milestones.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={clsx(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                    submitting
                      ? "cursor-not-allowed bg-slate-700 text-slate-400"
                      : "bg-teal-500 text-slate-950 hover:bg-teal-400"
                  )}
                >
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  Create ticket
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function buildAssignees(
  primaryActorKey: string,
  collaboratorKeys: string[]
): CreateTicketUiPayload["assignees"] {
  const deduped = [primaryActorKey, ...collaboratorKeys.filter((entry) => entry !== primaryActorKey)];
  return deduped.map((key, index) => {
    const [type, ...idParts] = key.split(":");
    return {
      type: type as TicketActorRef["type"],
      id: idParts.join(":"),
      role: index === 0 ? "primary" : "collaborator",
    };
  });
}

function FilterSelect({
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

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
      >
        <option value="">{placeholder ?? "Select an option"}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TicketListSkeleton() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950/80">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="grid gap-4 border-b border-slate-800/70 px-5 py-4 lg:grid-cols-[120px_minmax(0,1.4fr)_180px_170px_150px_110px]"
        >
          {Array.from({ length: 6 }).map((__, cell) => (
            <div key={cell} className="scanline-skeleton h-12 rounded-2xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
