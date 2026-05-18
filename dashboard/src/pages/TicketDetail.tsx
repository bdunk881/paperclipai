import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
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
import type { TicketDetailRouteData } from "../routes/ticketRouteData";
import {
  TicketActorChip,
  TicketEmptyState,
  TicketPriorityBadge,
  TicketSourceNotice,
  TicketSlaBadge,
  TicketStatusBadge,
  TicketUpdateCard,
} from "./tickets/ticketingUi";
import { formatTicketTimestamp, primaryAssignee, relativeTicketTime } from "./tickets/ticketingUi.helpers";

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

export default function TicketDetail({
  initialData,
}: {
  initialData?: TicketDetailRouteData;
} = {}) {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { user, getAccessToken } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);

  const [aggregate, setAggregate] = useState<TicketAggregate | null>(() => initialData ?? null);
  const [loading, setLoading] = useState(() => initialData == null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock" | null>(initialData ? "api" : null);
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
  const [timerNow, setTimerNow] = useState(() => Date.now());

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
        try {
          const fallback = await getTicket(ticketId);
          setAggregate(fallback);
          setSource("mock");
          void loadMemoryEntries(fallback, undefined, setMemoryState);
          setAgentDirectory([]);
        } catch {
          setAggregate(null);
          setSource(null);
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
    if (!initialData) {
      void loadTicket();
    }
  }, [initialData, loadTicket]);

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

  useEffect(() => {
    const interval = window.setInterval(() => setTimerNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

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
      <div className="af2-page text-af2-ink">
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <Loader2
            className="animate-spin"
            style={{ margin: "0 auto 12px", opacity: 0.5 }}
          />
          <p className="af2-muted">Loading assignment…</p>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="af2-page text-af2-ink">
        <TicketEmptyState
          title="Assignment not found"
          body={error ?? "The requested assignment could not be loaded."}
          action={
            <Link
              to="/mission-assignments"
              className="af2-btn af2-btn-clay af2-btn-sm"
              style={{
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ArrowLeft size={13} />
              Back to queue
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="af2-page text-af2-ink">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Assignments · Detail</div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
              marginTop: 6,
            }}
          >
            <span
              className="af2-mono af2-muted-2"
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {ticket.id.slice(0, 8)}
            </span>
            <TicketStatusBadge status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
            <TicketSlaBadge slaState={ticket.slaState} />
          </div>
          <h1
            className="af2-h1 font-af2-serif"
            style={{ marginTop: 10, marginBottom: 6 }}
          >
            {ticket.title}
          </h1>
          <div
            className="af2-page-head-meta"
            style={{ maxWidth: 720 }}
          >
            {ticket.description || "No description provided."}
          </div>
        </div>
        <div className="af2-page-actions" style={{ flexWrap: "wrap" }}>
          <Link
            to="/mission-assignments"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← Back to queue
          </Link>
          <Link
            to="/mission-assignments/sla"
            className="af2-btn af2-btn-sm"
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            SLA monitor
            <ArrowUpRight size={12} />
          </Link>
          <Link
            to="/settings/ticketing-sla"
            className="af2-btn af2-btn-sm"
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Policy editor
            <ArrowUpRight size={12} />
          </Link>
          {TRANSITIONS.map((transition) => (
            <button
              key={transition.status}
              type="button"
              onClick={() => {
                void handleStatusChange(transition.status);
              }}
              disabled={submitting || transition.status === ticket.status}
              className="af2-btn af2-btn-sm"
              style={{
                opacity: submitting || transition.status === ticket.status ? 0.5 : 1,
                cursor:
                  submitting || transition.status === ticket.status
                    ? "not-allowed"
                    : "pointer",
                color:
                  transition.status === "blocked"
                    ? "var(--af2-mustard)"
                    : transition.status === "cancelled"
                      ? "var(--af2-clay)"
                      : undefined,
              }}
            >
              {transition.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              void loadTicket();
            }}
            className="af2-btn af2-btn-sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            aria-label="Refresh assignment"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <TicketSourceNotice source={source} />

        {error ? (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              borderRadius: "var(--af2-radius)",
              border: "1px solid rgba(192,84,76,0.30)",
              background: "rgba(192,84,76,0.10)",
              color: "var(--af2-clay)",
              fontSize: 13,
            }}
          >
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
              <section className="af2-card p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
                      Linked Tasks
                    </p>
                    <h2 className="mt-2 font-af2-serif text-lg text-af2-ink">
                      Collaboration dependencies and child execution threads
                    </h2>
                  </div>
                  <span className="rounded-full border border-af2-line px-3 py-1 text-xs text-af2-ink-3">
                    {aggregate.childTickets.length} linked
                  </span>
                </div>

                <div className="space-y-2">
                  {aggregate.childTickets.map((childTicket) => (
                    <Link
                      key={childTicket.id}
                      to={`/tickets/${childTicket.id}`}
                      className="flex items-center gap-3 rounded-md px-3 py-3 transition hover:bg-af2-paper-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-af2-ink">{childTicket.title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-af2-ink-3">
                          <span className="font-af2-mono uppercase tracking-[0.16em]">{childTicket.id}</span>
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

            <div className="af2-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
                    Activity Stream
                  </p>
                  <h2 className="mt-2 font-af2-serif text-lg text-af2-ink">
                    Timeline of comments, structured updates, and close proposals
                  </h2>
                </div>
                <span className="rounded-full border border-af2-line px-3 py-1 text-xs text-af2-ink-3">
                  {updates.length} entries
                </span>
              </div>

              <form onSubmit={(event) => void handleUpdateSubmit(event)} className="mb-5 space-y-3">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
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
                      className="af2-input w-full"
                    />

                    {mentionContext ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-2xl border border-af2-line bg-af2-card shadow-glow-lg">
                        <div className="h-0.5 bg-af2-clay/80" />
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
                                    ? "bg-af2-clay text-white"
                                    : "text-af2-ink-2 hover:bg-af2-paper-2"
                                )}
                              >
                                <span
                                  className={clsx(
                                    "inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
                                    index === activeMentionIndex
                                      ? "bg-white/15 text-white"
                                      : candidate.tone === "teal"
                                        ? "bg-af2-sage/15 text-af2-sage"
                                        : candidate.tone === "orange"
                                          ? "bg-af2-mustard/15 text-af2-mustard"
                                          : candidate.tone === "indigo"
                                            ? "bg-af2-clay/15 text-af2-clay"
                                            : "bg-af2-paper-2 text-af2-ink-2"
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
                                        : "text-af2-ink-3"
                                    )}
                                  >
                                    {candidate.subtitle}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 text-sm text-af2-ink-3">
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
                          className="inline-flex items-center gap-2 rounded-full border border-af2-clay/40 bg-af2-clay-soft px-3 py-1 text-xs font-medium text-af2-clay"
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
                            ? "cursor-not-allowed border-af2-line bg-af2-paper-2 text-af2-ink-3"
                            : "border-af2-clay/40 bg-af2-clay/10 text-af2-clay hover:bg-af2-clay/15"
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
                          ? "cursor-not-allowed bg-af2-paper-2 text-af2-ink-3"
                          : "bg-af2-clay text-white hover:bg-af2-clay-2"
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

            <SlaTimerPanel ticket={ticket} nowMs={timerNow} />

            <section className="af2-card p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">Ownership</p>
              <div className="mt-4 space-y-3">
                {owner ? <TicketActorChip actor={owner} role="Primary" /> : null}
                {collaborators.map((assignee) => (
                  <TicketActorChip key={`${assignee.type}:${assignee.id}`} actor={assignee} role="Collaborator" />
                ))}
              </div>
            </section>

            <section className="af2-card p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">Metadata</p>
              <div className="mt-4 grid gap-3">
                <MetadataRow
                  label="SLA deadline"
                  value={ticket.slaDeadlineAt ? formatTicketTimestamp(ticket.slaDeadlineAt) : "Not set"}
                />
                <MetadataRow
                  label="First response"
                  value={
                    ticket.slaFirstResponseDeadlineAt
                      ? formatTicketTimestamp(ticket.slaFirstResponseDeadlineAt)
                      : "Not set"
                  }
                />
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

            <section className="af2-card p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">Suggested actor views</p>
              <div className="mt-4 space-y-2">
                {[owner, ...collaborators].filter(Boolean).map((assignee) => {
                  const actor = assignee!;
                  const profile = getTicketActorProfile(actor);
                  const Icon = actor.type === "agent" ? Bot : UserRound;
                  return (
                    <Link
                      key={`${actor.type}:${actor.id}`}
                      to={`/tickets/actors/${actor.type}/${actor.id}`}
                      className="flex items-center justify-between rounded-md border border-af2-line bg-af2-card px-4 py-3 text-sm transition hover:border-af2-sage/30 hover:bg-af2-paper-2"
                    >
                      <span className="inline-flex items-center gap-2 text-af2-ink">
                        <Icon size={14} />
                        {profile.name}
                      </span>
                      <ArrowLeft size={14} className="rotate-180 text-af2-ink-3" />
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
    <section className="relative overflow-hidden rounded-md border border-af2-clay/40 bg-af2-clay/10 px-5 py-5">
      <div className="absolute inset-x-0 top-0 h-px bg-af2-clay/80 shadow-glow" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-clay">Ready to close</p>
          <h2 className="mt-2 font-af2-serif text-lg text-af2-ink">
            {getTicketActorProfile(closeRequest.requestedBy).name} requested closure review
          </h2>
          <p className="mt-2 text-sm leading-6 text-af2-ink-2">
            {closeRequest.note || "A collaborator proposed this ticket for final confirmation."}
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-af2-ink-3">
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
                "inline-flex items-center gap-2 rounded-full border border-af2-line bg-af2-card px-4 py-2 text-sm font-semibold text-af2-ink transition hover:border-af2-clay/40 hover:text-af2-clay",
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
                "relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-af2-clay-2 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:bg-af2-clay",
                submitting && "cursor-not-allowed opacity-60"
              )}
            >
              <span
                className="absolute inset-y-0 left-0 bg-white/15 transition-[width]"
                style={{ width: `${holdProgress}%` }}
              />
              {showResolveBurst ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="h-12 w-12 rounded-full bg-gradient-to-r from-af2-clay/40 to-af2-sage/40 blur-xl" />
                </span>
              ) : null}
              <span className="relative inline-flex items-center gap-2">
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCheck size={15} />}
                {holdActive ? "Keep holding to confirm" : "Confirm close"}
              </span>
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-af2-line bg-af2-card px-4 py-3 text-sm text-af2-ink-2">
            Primary confirmation is restricted to the primary assignee.
          </div>
        )}
      </div>
    </section>
  );
}

function MemorySidebar({ memoryState }: { memoryState: MemoryLoadState }) {
  return (
    <section className="animate-slide-in-right af2-card overflow-hidden">
      <div className="sticky top-0 flex h-14 items-center gap-2 border-b border-af2-line px-5 text-af2-ink-4 backdrop-blur">
        <Brain size={16} />
        <span className="text-sm font-semibold">Memory</span>
        {memoryState.status === "error" ? (
          <span className="ml-auto text-xs font-medium text-af2-clay">Memory sync failed.</span>
        ) : null}
      </div>

      <div className="max-h-[32rem] space-y-3 overflow-y-auto px-4 py-4">
        {memoryState.status === "loading" && memoryState.entries.length === 0 ? (
          <>
            <div className="h-24 animate-pulse rounded-md bg-af2-paper-2" />
            <div className="h-24 animate-pulse rounded-md bg-af2-paper-2" />
            <div className="h-24 animate-pulse rounded-md bg-af2-paper-2" />
          </>
        ) : memoryState.entries.length ? (
          memoryState.entries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-2xl border border-af2-line bg-af2-card p-4"
            >
              <p
                className="text-sm leading-6 text-af2-ink-4"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {entry.text}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-af2-sage">
                <span>{entry.agentId ? actorLabelFromId(entry.agentId) : entry.key}</span>
                <span>•</span>
                <span>{entry.updatedAt ? relativeTicketTime(entry.updatedAt) : entry.workflowName ?? "Memory"}</span>
              </div>
            </article>
          ))
        ) : (
          <div className="flex min-h-[220px] flex-col items-center justify-center px-4 text-center">
            <BrainCircuit size={40} className="text-af2-ink-3" />
            <p className="mt-4 text-sm font-medium text-af2-ink-4">
              No relevant memories found.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function SlaTimerPanel({
  ticket,
  nowMs,
}: {
  ticket: TicketAggregate["ticket"];
  nowMs: number;
}) {
  const deadline = ticket.slaDeadlineAt ?? ticket.dueDate;
  const countdown = formatSlaCountdown(ticket.status, ticket.slaState, deadline, nowMs);

  return (
    <section className="af2-card p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">SLA Clock</p>
      <div className="mt-4 rounded-md border border-af2-line bg-af2-paper-2 p-4">
        <p className="font-af2-mono text-[11px] uppercase tracking-[0.18em] text-af2-ink-3">
          Resolution timer
        </p>
        <p className="mt-3 font-af2-mono tabular-nums text-3xl font-bold text-af2-ink">
          {countdown.primary}
        </p>
        <p className="mt-2 text-sm text-af2-ink-3">{countdown.secondary}</p>
      </div>
    </section>
  );
}

function ChildTicketStatusPill({ status }: { status: TicketStatus }) {
  const tone =
    status === "resolved"
      ? "bg-af2-sage/10 text-af2-sage"
      : status === "in_progress"
        ? "bg-af2-clay-soft text-af2-clay-2"
        : status === "blocked"
          ? "bg-af2-clay/10 text-af2-clay"
          : "bg-af2-paper-2 text-af2-ink-4";

  return (
    <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold capitalize", tone)}>
      {status.replace("_", " ")}
    </span>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-af2-line bg-af2-paper-2 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">{label}</p>
      <p className="mt-2 text-sm text-af2-ink">{value}</p>
    </div>
  );
}

function formatSlaCountdown(
  status: TicketAggregate["ticket"]["status"],
  slaState: string,
  deadline: string | undefined,
  nowMs: number
): { primary: string; secondary: string } {
  if (status === "resolved" || status === "cancelled") {
    return { primary: "Stopped", secondary: "Ticket is already closed." };
  }
  if (slaState === "paused" || status === "blocked") {
    return { primary: "Paused", secondary: "SLA timer is currently suspended." };
  }
  if (!deadline) {
    return { primary: "--", secondary: "No SLA deadline is available on this ticket." };
  }

  const diffMs = new Date(deadline).getTime() - nowMs;
  const absoluteMinutes = Math.max(1, Math.ceil(Math.abs(diffMs) / 60000));
  const unit =
    absoluteMinutes >= 1440
      ? `${Math.ceil(absoluteMinutes / 1440)}d`
      : absoluteMinutes >= 60
        ? `${Math.ceil(absoluteMinutes / 60)}h`
        : `${absoluteMinutes}m`;

  if (diffMs < 0) {
    return {
      primary: `+${unit}`,
      secondary: `Ticket breached its SLA deadline at ${formatTicketTimestamp(deadline)}.`,
    };
  }

  return {
    primary: unit,
    secondary: `Time remaining until the SLA deadline at ${formatTicketTimestamp(deadline)}.`,
  };
}

function actorLabelFromId(id: string): string {
  return id
    .split(/[:._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
