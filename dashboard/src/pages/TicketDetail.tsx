import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  Brain,
  BrainCircuit,
  CheckCheck,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Sparkles,
  UserRound,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { listAgents, type Agent } from "../api/agentApi";
import {
  addTicketUpdate,
  getTicket,
  getTicketActorProfile,
  searchTicketMemories,
  transitionTicket,
  type TicketActorRef,
  type TicketAggregate,
  type TicketCloseRequest,
  type TicketMemoryEntry,
  type TicketStatus,
} from "../api/tickets";
import { useAuth } from "../context/AuthContext";
import {
  TicketActorChip,
  TicketEmptyState,
  TicketPriorityBadge,
  TicketSourceNotice,
  TicketSlaBadge,
  TicketStatusBadge,
  TicketUpdateCard,
} from "./tickets/ticketingUi";
import { formatTicketTimestamp, primaryAssignee, relativeTicketTime } from "./tickets/ticketingUtils";

const TRANSITIONS: Array<{ status: TicketStatus; label: string }> = [
  { status: "in_progress", label: "Start" },
  { status: "blocked", label: "Block" },
  { status: "cancelled", label: "Cancel" },
];

const HOLD_TO_CONFIRM_MS = 1500;

type MentionCandidate = TicketActorRef & {
  label: string;
  subtitle: string;
  initials: string;
  tone: "indigo" | "teal" | "orange" | "slate";
};

type MentionContext = {
  start: number;
  end: number;
  query: string;
};

type MentionSelection = {
  actor: TicketActorRef;
  label: string;
};

type MemoryLoadState =
  | { status: "idle" | "loading"; entries: TicketMemoryEntry[]; error: null }
  | { status: "ready"; entries: TicketMemoryEntry[]; error: null }
  | { status: "error"; entries: TicketMemoryEntry[]; error: string };

export default function TicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { user, getAccessToken } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);

  const [aggregate, setAggregate] = useState<TicketAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock">("mock");
  const [updateDraft, setUpdateDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [memoryState, setMemoryState] = useState<MemoryLoadState>({
    status: "idle",
    entries: [],
    error: null,
  });
  const [agentDirectory, setAgentDirectory] = useState<Agent[]>([]);
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [selectedMentions, setSelectedMentions] = useState<MentionSelection[]>([]);
  const [showResolveBurst, setShowResolveBurst] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [holdActive, setHoldActive] = useState(false);

  const ticket = aggregate?.ticket ?? null;
  const updates = useMemo(() => aggregate?.updates ?? [], [aggregate]);
  const owner = ticket ? primaryAssignee(ticket) : undefined;
  const collaborators = ticket?.assignees.filter((assignee) => assignee.role === "collaborator") ?? [];
  const closeRequest = useMemo(
    () => aggregate?.closeRequest ?? deriveCloseRequest(updates),
    [aggregate?.closeRequest, updates]
  );
  const currentUserId = user?.id?.toLowerCase() ?? null;
  const isPrimaryActor =
    owner?.type === "user" && Boolean(currentUserId) && owner.id.toLowerCase() === currentUserId;
  const canProposeClose =
    Boolean(ticket) &&
    !isPrimaryActor &&
    ticket?.status !== "resolved" &&
    ticket?.status !== "cancelled" &&
    ticket?.status !== "blocked";

  const mentionCandidates = useMemo(() => {
    if (!ticket) return [];
    const directory = buildMentionCandidates(ticket, updates, agentDirectory, user);
    if (!mentionContext) {
      return directory;
    }

    const normalized = mentionContext.query.trim().toLowerCase();
    if (!normalized) {
      return directory;
    }

    return directory
      .filter((candidate) => {
        const haystack = `${candidate.label} ${candidate.subtitle}`.toLowerCase();
        return haystack.includes(normalized) || candidate.id.toLowerCase().includes(normalized);
      })
      .sort((left, right) => {
        const leftStarts = left.label.toLowerCase().startsWith(normalized) ? 0 : 1;
        const rightStarts = right.label.toLowerCase().startsWith(normalized) ? 0 : 1;
        if (leftStarts !== rightStarts) return leftStarts - rightStarts;
        return left.label.localeCompare(right.label);
      });
  }, [agentDirectory, mentionContext, ticket, updates, user]);

  const loadTicket = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!ticketId) return;
      if (!options.silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const accessToken = (await getAccessToken()) ?? undefined;
        const nextAggregate = await getTicket(ticketId, accessToken);
        setAggregate(nextAggregate);
        setSource("api");
        void loadMemoryEntries(nextAggregate, accessToken, setMemoryState);
        void loadAgentDirectory(accessToken, setAgentDirectory);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load ticket");
        setSource("mock");
        try {
          const fallback = await getTicket(ticketId);
          setAggregate(fallback);
          void loadMemoryEntries(fallback, undefined, setMemoryState);
          setAgentDirectory([]);
        } catch {
          setAggregate(null);
        }
      } finally {
        if (!options.silent) {
          setLoading(false);
        }
      }
    },
    [getAccessToken, ticketId]
  );

  useEffect(() => {
    void loadTicket();
  }, [loadTicket]);

  useEffect(() => {
    if (!ticketId) return undefined;
    const interval = window.setInterval(() => {
      void loadTicket({ silent: true });
    }, 30000);
    return () => window.clearInterval(interval);
  }, [loadTicket, ticketId]);

  useEffect(
    () => () => {
      clearHoldTimers(holdTimeoutRef, holdIntervalRef);
    },
    []
  );

  useEffect(() => {
    if (!showResolveBurst) return undefined;
    const timeout = window.setTimeout(() => setShowResolveBurst(false), 1000);
    return () => window.clearTimeout(timeout);
  }, [showResolveBurst]);

  async function handleStatusChange(status: TicketStatus) {
    if (!ticketId) return;
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const next = await transitionTicket(
        ticketId,
        {
          status,
          reason: `Ticket moved to ${status.replace("_", " ")} from the collaboration detail view.`,
        },
        accessToken
      );
      setAggregate(next);
      setSource(next.source);
      if (status === "resolved") {
        setShowResolveBurst(true);
      }
    } catch (transitionError) {
      setError(
        transitionError instanceof Error ? transitionError.message : "Failed to change ticket status"
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticketId || !updateDraft.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const visibleMentions = selectedMentions
        .filter((mention) => updateDraft.includes(mention.label))
        .map((mention) => mention.actor);
      const result = await addTicketUpdate(
        ticketId,
        {
          type: "structured_update",
          content: updateDraft.trim(),
          metadata: visibleMentions.length ? { mentions: visibleMentions } : undefined,
        },
        accessToken
      );
      setAggregate((current) => {
        if (!current) return current;
        return {
          ...current,
          ticket: { ...current.ticket, updatedAt: result.update.createdAt },
          updates: [...current.updates, result.update],
        };
      });
      setSource(result.source);
      setUpdateDraft("");
      setSelectedMentions([]);
      setMentionContext(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to publish update");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProposeClose() {
    if (!ticketId || !ticket || !user) return;

    const requestId = `close-request-${crypto.randomUUID()}`;
    const requestedAt = new Date().toISOString();
    const note = updateDraft.trim() || "Requesting primary confirmation to close this ticket.";

    setSubmitting(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const result = await addTicketUpdate(
        ticketId,
        {
          type: "structured_update",
          content: note,
          metadata: {
            closeRequest: {
              id: requestId,
              status: "pending",
              requestedBy: { type: "user", id: user.id },
              requestedAt,
              note,
            },
          },
        },
        accessToken
      );
      setAggregate((current) => {
        if (!current) return current;
        return {
          ...current,
          ticket: { ...current.ticket, updatedAt: result.update.createdAt },
          updates: [...current.updates, result.update],
          closeRequest: {
            id: requestId,
            status: "pending",
            requestedBy: { type: "user", id: user.id },
            requestedAt,
            note,
          },
        };
      });
      setSource(result.source);
      setUpdateDraft("");
      setMentionContext(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to propose close");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRejectClose() {
    if (!ticketId || !closeRequest || !user) return;

    setSubmitting(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const result = await addTicketUpdate(
        ticketId,
        {
          type: "structured_update",
          content: "Primary assignee rejected the close request and requested more work before resolution.",
          metadata: {
            closeRequest: {
              ...closeRequest,
              status: "rejected",
              decidedBy: { type: "user", id: user.id },
              decidedAt: new Date().toISOString(),
            },
          },
        },
        accessToken
      );
      setAggregate((current) => {
        if (!current) return current;
        return {
          ...current,
          ticket: { ...current.ticket, updatedAt: result.update.createdAt },
          updates: [...current.updates, result.update],
          closeRequest: {
            ...closeRequest,
            status: "rejected",
            decidedBy: { type: "user", id: user.id },
            decidedAt: result.update.createdAt,
          },
        };
      });
      setSource(result.source);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to reject close request");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmClose() {
    clearHoldTimers(holdTimeoutRef, holdIntervalRef);
    setHoldActive(false);
    setHoldProgress(0);

    if (!ticketId || !ticket) return;
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const next = await transitionTicket(
        ticketId,
        {
          status: "resolved",
          reason: closeRequest?.note ?? "Closed from the collaboration detail view after primary confirmation.",
        },
        accessToken
      );
      setAggregate({
        ...next,
        closeRequest: closeRequest
          ? {
              ...closeRequest,
              status: "approved",
              decidedBy: { type: "user", id: user?.id ?? "current-user" },
              decidedAt: new Date().toISOString(),
            }
          : next.closeRequest,
      });
      setSource(next.source);
      setShowResolveBurst(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to confirm close");
    } finally {
      setSubmitting(false);
    }
  }

  function beginHoldToConfirm() {
    if (!isPrimaryActor || submitting || ticket?.status === "resolved") return;
    clearHoldTimers(holdTimeoutRef, holdIntervalRef);
    setHoldActive(true);
    setHoldProgress(0);
    const startedAt = performance.now();

    holdIntervalRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      setHoldProgress(Math.min(100, (elapsed / HOLD_TO_CONFIRM_MS) * 100));
    }, 16);

    holdTimeoutRef.current = window.setTimeout(() => {
      void handleConfirmClose();
    }, HOLD_TO_CONFIRM_MS);
  }

  function cancelHoldToConfirm() {
    clearHoldTimers(holdTimeoutRef, holdIntervalRef);
    setHoldActive(false);
    setHoldProgress(0);
  }

  function handleDraftChange(value: string, selectionStart: number | null) {
    setUpdateDraft(value);
    syncMentionContext(value, selectionStart, setMentionContext, setActiveMentionIndex);
  }

  function insertMention(candidate: MentionCandidate) {
    const textarea = textareaRef.current;
    if (!textarea || !mentionContext) return;

    const nextValue = `${updateDraft.slice(0, mentionContext.start)}@${candidate.label} ${updateDraft.slice(
      mentionContext.end
    )}`;
    const cursorPosition = mentionContext.start + candidate.label.length + 2;

    setUpdateDraft(nextValue);
    setSelectedMentions((current) => {
      const key = `${candidate.type}:${candidate.id}`;
      if (current.some((entry) => `${entry.actor.type}:${entry.actor.id}` === key)) {
        return current;
      }
      return [...current, { actor: { type: candidate.type, id: candidate.id }, label: `@${candidate.label}` }];
    });
    setMentionContext(null);
    setActiveMentionIndex(0);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionContext || mentionCandidates.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveMentionIndex((current) => (current + 1) % mentionCandidates.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      insertMention(mentionCandidates[activeMentionIndex] ?? mentionCandidates[0]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMentionContext(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-full bg-[#0b1120] p-8">
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="scanline-skeleton h-24 rounded-[28px]" />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="scanline-skeleton min-h-[520px] rounded-[28px]" />
            <div className="scanline-skeleton min-h-[520px] rounded-[28px]" />
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-full bg-[#0b1120] p-8">
        <div className="mx-auto max-w-5xl">
          <TicketEmptyState
            title="Ticket not found"
            body={error ?? "The requested ticket could not be loaded."}
            action={
              <Link
                to="/tickets"
                className="inline-flex items-center gap-2 rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400"
              >
                <ArrowLeft size={14} />
                Back to queue
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#0b1120] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <section className="sticky top-0 z-20 rounded-[30px] border border-slate-800/80 bg-slate-950/85 px-6 py-6 shadow-lg backdrop-blur md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <Link
                to="/tickets"
                className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-100"
              >
                <ArrowLeft size={14} />
                Back to queue
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="font-ticket-mono text-xs uppercase tracking-[0.2em] text-slate-400">
                  {ticket.id}
                </span>
                <TicketStatusBadge status={ticket.status} />
                <TicketPriorityBadge priority={ticket.priority} />
                <TicketSlaBadge slaState={ticket.slaState} />
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-100">{ticket.title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                {ticket.description || "No description provided."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {TRANSITIONS.map((transition) => (
                <button
                  key={transition.status}
                  onClick={() => {
                    void handleStatusChange(transition.status);
                  }}
                  disabled={submitting || transition.status === ticket.status}
                  className={clsx(
                    "rounded-full border px-3.5 py-2 text-sm font-medium transition",
                    transition.status === "blocked"
                      ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
                      : transition.status === "cancelled"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                        : "border-slate-700 bg-slate-900/80 text-slate-200",
                    (submitting || transition.status === ticket.status) && "cursor-not-allowed opacity-50"
                  )}
                >
                  {transition.label}
                </button>
              ))}
              <button
                onClick={() => {
                  void loadTicket();
                }}
                className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm font-medium text-slate-300 transition hover:border-indigo-500/30 hover:text-slate-100"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-5">
            <TicketSourceNotice source={source} />
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {closeRequest?.status === "pending" ? (
          <CloseRequestBanner
            closeRequest={closeRequest}
            isPrimaryActor={isPrimaryActor}
            submitting={submitting}
            holdActive={holdActive}
            holdProgress={holdProgress}
            showResolveBurst={showResolveBurst}
            onBeginHold={beginHoldToConfirm}
            onCancelHold={cancelHoldToConfirm}
            onDoubleConfirm={() => {
              void handleConfirmClose();
            }}
            onReject={() => {
              void handleRejectClose();
            }}
          />
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-5">
            {aggregate?.childTickets?.length ? (
              <section className="rounded-[30px] border border-slate-800 bg-slate-950/80 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Linked Tasks
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-slate-100">
                      Collaboration dependencies and child execution threads
                    </h2>
                  </div>
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
                    {aggregate.childTickets.length} linked
                  </span>
                </div>

                <div className="space-y-2">
                  {aggregate.childTickets.map((childTicket) => (
                    <Link
                      key={childTicket.id}
                      to={`/tickets/${childTicket.id}`}
                      className="flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-surface-100/10 dark:hover:bg-surface-850"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-100">{childTicket.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-ticket-mono uppercase tracking-[0.16em]">{childTicket.id}</span>
                          {childTicket.owner ? (
                            <>
                              <span>•</span>
                              <span>{getTicketActorProfile(childTicket.owner).name}</span>
                            </>
                          ) : null}
                          <span>•</span>
                          <span>{relativeTicketTime(childTicket.updatedAt)}</span>
                        </div>
                      </div>
                      <ChildTicketStatusPill status={childTicket.status} />
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="rounded-[30px] border border-slate-800 bg-slate-950/80 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Activity Stream
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-100">
                    Timeline of comments, structured updates, and close proposals
                  </h2>
                </div>
                <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
                  {updates.length} entries
                </span>
              </div>

              <form onSubmit={(event) => void handleUpdateSubmit(event)} className="mb-5 space-y-3">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Publish structured update
                  </span>
                  <div className="relative">
                    <textarea
                      ref={textareaRef}
                      rows={5}
                      value={updateDraft}
                      onChange={(event) =>
                        handleDraftChange(event.target.value, event.currentTarget.selectionStart)
                      }
                      onClick={(event) =>
                        handleDraftChange(event.currentTarget.value, event.currentTarget.selectionStart)
                      }
                      onKeyDown={handleComposerKeyDown}
                      placeholder="Summarize progress, blockers, or handoff notes. Use @ to mention agents or human teammates."
                      className="w-full rounded-[24px] border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                    />

                    {mentionContext ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-2xl border border-surface-200 bg-surface-0 shadow-glow-lg dark:border-surface-800 dark:bg-surface-900">
                        <div className="h-0.5 bg-brand-500/80" />
                        {mentionCandidates.length ? (
                          <div className="animate-scale-in p-2">
                            {mentionCandidates.map((candidate, index) => (
                              <button
                                key={`${candidate.type}:${candidate.id}`}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => insertMention(candidate)}
                                className={clsx(
                                  "flex w-full items-center gap-3 rounded-2xl px-4 py-2 text-left text-sm transition",
                                  index === activeMentionIndex
                                    ? "bg-brand-500 text-white"
                                    : "text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-800"
                                )}
                              >
                                <span
                                  className={clsx(
                                    "inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
                                    index === activeMentionIndex
                                      ? "bg-white/15 text-white"
                                      : candidate.tone === "teal"
                                        ? "bg-teal-500/15 text-teal-500"
                                        : candidate.tone === "orange"
                                          ? "bg-orange-500/15 text-orange-500"
                                          : candidate.tone === "indigo"
                                            ? "bg-brand-500/15 text-brand-500"
                                            : "bg-slate-700/40 text-slate-300"
                                  )}
                                >
                                  {candidate.initials}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-semibold">{candidate.label}</span>
                                  <span
                                    className={clsx(
                                      "block truncate text-xs",
                                      index === activeMentionIndex
                                        ? "text-white/80"
                                        : "text-surface-500 dark:text-surface-400"
                                    )}
                                  >
                                    {candidate.subtitle}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 text-sm text-surface-500 dark:text-surface-400">
                            No agents found.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {selectedMentions
                      .filter((mention) => updateDraft.includes(mention.label))
                      .map((mention) => (
                        <span
                          key={`${mention.actor.type}:${mention.actor.id}`}
                          className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-100"
                        >
                          {mention.label}
                        </span>
                      ))}
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    {canProposeClose ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleProposeClose();
                        }}
                        disabled={submitting}
                        className={clsx(
                          "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition",
                          submitting
                            ? "cursor-not-allowed border-slate-700 bg-slate-800 text-slate-500"
                            : "border-brand-500/30 bg-brand-500/10 text-brand-100 hover:border-brand-400/50 hover:bg-brand-500/20"
                        )}
                      >
                        <Sparkles size={15} />
                        Propose close
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={submitting || !updateDraft.trim()}
                      className={clsx(
                        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                        submitting || !updateDraft.trim()
                          ? "cursor-not-allowed bg-slate-700 text-slate-400"
                          : "bg-indigo-500 text-white hover:bg-indigo-400"
                      )}
                    >
                      {submitting ? <Loader2 size={15} className="animate-spin" /> : <MessageSquarePlus size={15} />}
                      Post update
                    </button>
                  </div>
                </div>
              </form>

              <div className="space-y-4">
                {updates.map((update) => (
                  <TicketUpdateCard key={update.id} update={update} />
                ))}
              </div>
            </div>
          </section>

          <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
            <MemorySidebar memoryState={memoryState} />

            <section className="rounded-[30px] border border-slate-800 bg-slate-950/80 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Ownership</p>
              <div className="mt-4 space-y-3">
                {owner ? <TicketActorChip actor={owner} role="Primary" /> : null}
                {collaborators.map((assignee) => (
                  <TicketActorChip key={`${assignee.type}:${assignee.id}`} actor={assignee} role="Collaborator" />
                ))}
              </div>
            </section>

            <section className="rounded-[30px] border border-slate-800 bg-slate-950/80 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Metadata</p>
              <div className="mt-4 grid gap-3">
                <MetadataRow label="Created" value={formatTicketTimestamp(ticket.createdAt)} />
                <MetadataRow label="Last activity" value={relativeTicketTime(ticket.updatedAt)} />
                <MetadataRow label="Due" value={ticket.dueDate ? formatTicketTimestamp(ticket.dueDate) : "Not set"} />
                <MetadataRow
                  label="Resolved"
                  value={ticket.resolvedAt ? formatTicketTimestamp(ticket.resolvedAt) : "Not resolved"}
                />
                <MetadataRow label="Tags" value={ticket.tags.length ? ticket.tags.join(", ") : "No tags"} />
              </div>
            </section>

            <section className="rounded-[30px] border border-slate-800 bg-slate-950/80 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Suggested actor views</p>
              <div className="mt-4 space-y-2">
                {[owner, ...collaborators].filter(Boolean).map((assignee) => {
                  const actor = assignee!;
                  const profile = getTicketActorProfile(actor);
                  const Icon = actor.type === "agent" ? Bot : UserRound;
                  return (
                    <Link
                      key={`${actor.type}:${actor.id}`}
                      to={`/tickets/actors/${actor.type}/${actor.id}`}
                      className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm transition hover:border-teal-500/30 hover:bg-slate-900"
                    >
                      <span className="inline-flex items-center gap-2 text-slate-200">
                        <Icon size={14} />
                        {profile.name}
                      </span>
                      <ArrowLeft size={14} className="rotate-180 text-slate-500" />
                    </Link>
                  );
                })}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function loadAgentDirectory(
  accessToken: string | undefined,
  setAgentDirectory: React.Dispatch<React.SetStateAction<Agent[]>>
) {
  if (!accessToken) {
    setAgentDirectory([]);
    return Promise.resolve();
  }

  return listAgents(accessToken)
    .then((agents) => setAgentDirectory(agents))
    .catch(() => setAgentDirectory([]));
}

function loadMemoryEntries(
  aggregate: TicketAggregate,
  accessToken: string | undefined,
  setMemoryState: React.Dispatch<React.SetStateAction<MemoryLoadState>>
) {
  const query = [aggregate.ticket.title, ...aggregate.ticket.tags].join(" ").trim();
  setMemoryState({ status: "loading", entries: aggregate.relevantMemories ?? [], error: null });

  return searchTicketMemories(query, accessToken, { limit: 5 })
    .then((response) => {
      setMemoryState({ status: "ready", entries: response.results, error: null });
    })
    .catch((memoryError) => {
      setMemoryState({
        status: "error",
        entries: aggregate.relevantMemories ?? [],
        error: memoryError instanceof Error ? memoryError.message : "Memory sync failed.",
      });
    });
}

function buildMentionCandidates(
  ticket: TicketAggregate["ticket"],
  updates: TicketAggregate["updates"],
  agents: Agent[],
  user: { id: string; email: string; name: string } | null
): MentionCandidate[] {
  const directory = new Map<string, MentionCandidate>();

  for (const agent of agents) {
    directory.set(`agent:${agent.id}`, {
      type: "agent",
      id: agent.id,
      label: agent.name,
      subtitle: agent.roleKey ? `${agent.roleKey} agent` : agent.description || "Agent teammate",
      initials: agent.name
        .split(" ")
        .map((part) => part[0] ?? "")
        .join("")
        .slice(0, 3)
        .toUpperCase(),
      tone: "indigo",
    });
  }

  for (const assignee of ticket.assignees) {
    const profile = getTicketActorProfile(assignee);
    directory.set(`${assignee.type}:${assignee.id}`, {
      type: assignee.type,
      id: assignee.id,
      label: profile.name,
      subtitle: assignee.type === "agent" ? "Assigned agent" : "Assigned teammate",
      initials: profile.initials,
      tone: profile.tone,
    });
  }

  for (const update of updates) {
    const profile = getTicketActorProfile(update.actor);
    directory.set(`${update.actor.type}:${update.actor.id}`, {
      type: update.actor.type,
      id: update.actor.id,
      label: profile.name,
      subtitle: update.actor.type === "agent" ? "Recent agent contributor" : "Recent human contributor",
      initials: profile.initials,
      tone: profile.tone,
    });
  }

  if (user) {
    directory.set(`user:${user.id}`, {
      type: "user",
      id: user.id,
      label: user.name,
      subtitle: "Current teammate",
      initials: user.name
        .split(" ")
        .map((part) => part[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      tone: "slate",
    });
  }

  return [...directory.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function deriveCloseRequest(updates: TicketAggregate["updates"]): TicketCloseRequest | null {
  const closeRequestUpdate = [...updates]
    .reverse()
    .find((update) => isCloseRequestPayload(update.metadata?.closeRequest));
  return closeRequestUpdate ? (closeRequestUpdate.metadata.closeRequest as TicketCloseRequest) : null;
}

function isCloseRequestPayload(value: unknown): value is TicketCloseRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.id === "string" &&
    (request.status === "pending" || request.status === "rejected" || request.status === "approved") &&
    request.requestedBy !== null
  );
}

function syncMentionContext(
  value: string,
  selectionStart: number | null,
  setMentionContext: React.Dispatch<React.SetStateAction<MentionContext | null>>,
  setActiveMentionIndex: React.Dispatch<React.SetStateAction<number>>
) {
  const nextContext = findMentionContext(value, selectionStart ?? value.length);
  setMentionContext(nextContext);
  setActiveMentionIndex(0);
}

function findMentionContext(value: string, cursor: number): MentionContext | null {
  const textBeforeCursor = value.slice(0, cursor);
  const match = textBeforeCursor.match(/(^|\s)@([\w.-]*)$/);
  if (!match) return null;
  return {
    start: cursor - match[2].length - 1,
    end: cursor,
    query: match[2],
  };
}

function clearHoldTimers(
  holdTimeoutRef: React.MutableRefObject<number | null>,
  holdIntervalRef: React.MutableRefObject<number | null>
) {
  if (holdTimeoutRef.current) {
    window.clearTimeout(holdTimeoutRef.current);
    holdTimeoutRef.current = null;
  }
  if (holdIntervalRef.current) {
    window.clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = null;
  }
}

function CloseRequestBanner({
  closeRequest,
  isPrimaryActor,
  submitting,
  holdActive,
  holdProgress,
  showResolveBurst,
  onBeginHold,
  onCancelHold,
  onDoubleConfirm,
  onReject,
}: {
  closeRequest: TicketCloseRequest;
  isPrimaryActor: boolean;
  submitting: boolean;
  holdActive: boolean;
  holdProgress: number;
  showResolveBurst: boolean;
  onBeginHold: () => void;
  onCancelHold: () => void;
  onDoubleConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-[28px] border border-brand-500/20 bg-brand-50/10 px-5 py-5 dark:bg-brand-950/20">
      <div className="absolute inset-x-0 top-0 h-px bg-brand-400/80 shadow-glow" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-200">Ready to close</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-100">
            {getTicketActorProfile(closeRequest.requestedBy).name} requested closure review
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {closeRequest.note || "A collaborator proposed this ticket for final confirmation."}
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
            Requested {relativeTicketTime(closeRequest.requestedAt)}
          </p>
        </div>

        {isPrimaryActor ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onReject}
              disabled={submitting}
              className={clsx(
                "inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-rose-500/40 hover:text-rose-200",
                submitting && "cursor-not-allowed opacity-60"
              )}
            >
              <XCircle size={15} />
              Reject
            </button>

            <button
              type="button"
              onMouseDown={onBeginHold}
              onMouseUp={onCancelHold}
              onMouseLeave={onCancelHold}
              onTouchStart={onBeginHold}
              onTouchEnd={onCancelHold}
              onDoubleClick={onDoubleConfirm}
              disabled={submitting}
              className={clsx(
                "relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-500",
                submitting && "cursor-not-allowed opacity-60"
              )}
            >
              <span
                className="absolute inset-y-0 left-0 bg-white/15 transition-[width]"
                style={{ width: `${holdProgress}%` }}
              />
              {showResolveBurst ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="h-12 w-12 rounded-full bg-gradient-to-r from-brand-400/40 to-teal-400/40 blur-xl" />
                </span>
              ) : null}
              <span className="relative inline-flex items-center gap-2">
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCheck size={15} />}
                {holdActive ? "Keep holding to confirm" : "Confirm close"}
              </span>
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-300">
            Primary confirmation is restricted to the primary assignee.
          </div>
        )}
      </div>
    </section>
  );
}

function MemorySidebar({ memoryState }: { memoryState: MemoryLoadState }) {
  return (
    <section className="animate-slide-in-right overflow-hidden rounded-[30px] border border-surface-200 bg-surface-50 shadow-card dark:border-surface-800 dark:bg-surface-900">
      <div className="sticky top-0 flex h-14 items-center gap-2 border-b border-surface-200 px-5 text-surface-700 backdrop-blur dark:border-surface-800 dark:text-surface-100">
        <Brain size={16} />
        <span className="text-sm font-semibold">Memory</span>
        {memoryState.status === "error" ? (
          <span className="ml-auto text-xs font-medium text-red-400">Memory sync failed.</span>
        ) : null}
      </div>

      <div className="max-h-[32rem] space-y-3 overflow-y-auto px-4 py-4">
        {memoryState.status === "loading" && memoryState.entries.length === 0 ? (
          <>
            <div className="scanline-skeleton h-24 rounded-2xl" />
            <div className="scanline-skeleton h-24 rounded-2xl" />
            <div className="scanline-skeleton h-24 rounded-2xl" />
          </>
        ) : memoryState.entries.length ? (
          memoryState.entries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-2xl border border-surface-200/50 bg-surface-0 p-4 dark:border-surface-800/50 dark:bg-surface-950"
            >
              <p
                className="text-sm leading-6 text-surface-600 dark:text-surface-400"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {entry.text}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-teal-400">
                <span>{entry.agentId ? actorLabelFromId(entry.agentId) : entry.key}</span>
                <span>•</span>
                <span>{entry.updatedAt ? relativeTicketTime(entry.updatedAt) : entry.workflowName ?? "Memory"}</span>
              </div>
            </article>
          ))
        ) : (
          <div className="flex min-h-[220px] flex-col items-center justify-center px-4 text-center">
            <BrainCircuit size={40} className="text-surface-400" />
            <p className="mt-4 text-sm font-medium text-surface-500 dark:text-surface-400">
              No relevant memories found.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function ChildTicketStatusPill({ status }: { status: TicketStatus }) {
  const tone =
    status === "resolved"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
      : status === "in_progress"
        ? "bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-400"
        : status === "blocked"
          ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
          : "bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-300";

  return (
    <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold capitalize", tone)}>
      {status.replace("_", " ")}
    </span>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-slate-800 bg-slate-900/65 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-200">{value}</p>
    </div>
  );
}

function actorLabelFromId(id: string): string {
  return id
    .split(/[:._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
