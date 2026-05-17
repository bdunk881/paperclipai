/**
 * Mission Assignments — V2 editorial rebuild (DASH-10 / HEL-129).
 *
 * Replaces the V1 indigo/teal "Operational Clarity" glass-card design
 * with the same af2-page chrome the rest of the dashboard uses:
 *   - eyebrow ("Run · Assignments") + serif h1 + meta line
 *   - af2-stats strip (Queue / Executing / Blocked / Urgent)
 *   - af2-list with a 6-column grid (ID / Summary / Owner / Status /
 *     Priority / SLA)
 *
 * The data layer (loader, action, listTickets/createTicket API, KPI
 * counts, filtering, search) is unchanged from the V1 page — this
 * is a visual + IA refresh, not a data refactor.
 *
 * DASH-11: the create-assignment modal now embeds a Mission picker
 * (populated via listMissions) so an owner can scope each assignment
 * to a specific mission. Missions are stored as a `mission:<id>` tag
 * on the ticket; the rest of the surface continues to filter by tag.
 * No backend change required.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import {
  collectKnownActors,
  createTicket,
  getTicketActorProfile,
  listTickets,
  normalizeTicketSlaState,
  registerTicketActorProfile,
  type TicketActorRef,
  type TicketPriority,
  type TicketRecord,
  type TicketSlaStateLike,
  type TicketStatus,
} from "../api/tickets";
import { listAgents } from "../api/agentApi";
import { listMissions, type Mission } from "../api/missionsApi";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import {
  buildCreateTicketPayload,
  type CreateTicketRouteActionData,
  type CreateTicketRouteActionPayload,
  type TicketsRouteData,
} from "../routes/ticketRouteData";
import {
  TicketActorChip,
  TicketPriorityBadge,
  TicketRowMeta,
  TicketSlaBadge,
  TicketSourceNotice,
  TicketStatusBadge,
} from "./tickets/ticketingUi";
import {
  collaboratorCount,
  primaryAssignee,
  relativeTicketTime,
} from "./tickets/ticketingUi.helpers";

type StatusFilter = TicketStatus | "all";
type PriorityFilter = TicketPriority | "all";
type SlaFilter = TicketSlaStateLike | "all";

const STATUS_OPTIONS: StatusFilter[] = [
  "all",
  "open",
  "in_progress",
  "blocked",
  "resolved",
  "cancelled",
];
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
  missionId: "",
  externalSyncRequested: false,
};

type TicketsProps = {
  initialData?: TicketsRouteData;
  routeAction?: {
    data?: CreateTicketRouteActionData;
    state: "idle" | "submitting" | "loading";
    submit: (payload: CreateTicketRouteActionPayload) => void;
  };
};

export default function Tickets({ initialData, routeAction }: TicketsProps = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { getAccessToken, user } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [tickets, setTickets] = useState<TicketRecord[]>(
    () => initialData?.tickets ?? [],
  );
  const [availableActors, setAvailableActors] = useState<TicketActorRef[]>(() =>
    initialData ? collectKnownActors(initialData.tickets) : [],
  );
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(() => initialData == null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock" | null>(
    () => initialData?.source ?? null,
  );
  const [integrationWarnings, setIntegrationWarnings] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const value = searchParams.get("status");
    return STATUS_OPTIONS.includes(value as StatusFilter)
      ? (value as StatusFilter)
      : "all";
  });
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(() => {
    const value = searchParams.get("priority");
    return PRIORITY_OPTIONS.includes(value as PriorityFilter)
      ? (value as PriorityFilter)
      : "all";
  });
  const [slaFilter, setSlaFilter] = useState<SlaFilter>(() => {
    const value = searchParams.get("sla");
    return SLA_OPTIONS.includes(value as SlaFilter)
      ? (value as SlaFilter)
      : "all";
  });
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [formState, setFormState] = useState(EMPTY_FORM);
  const [validationError, setValidationError] = useState<string | null>(null);
  const submitting = routeAction ? routeAction.state !== "idle" : false;

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const [response, agents, missionsList] = await Promise.all([
        listTickets({ workspaceId: activeWorkspaceId ?? undefined }, accessToken),
        accessToken ? listAgents(accessToken).catch(() => []) : Promise.resolve([]),
        accessToken ? listMissions(accessToken).catch(() => []) : Promise.resolve([]),
      ]);

      const actorSeed: TicketActorRef[] = [];
      if (user) {
        const initials =
          user.name
            .split(/\s+/)
            .map((part) => part[0] ?? "")
            .join("")
            .slice(0, 3)
            .toUpperCase() || "U";
        registerTicketActorProfile(
          { type: "user", id: user.id },
          {
            name: user.name,
            initials,
            title: "Workspace member",
            tone: "slate",
          },
        );
        actorSeed.push({ type: "user", id: user.id });
      }

      for (const agent of agents) {
        const initials =
          agent.name
            .split(/\s+/)
            .map((part) => part[0] ?? "")
            .join("")
            .slice(0, 3)
            .toUpperCase() || "AG";
        registerTicketActorProfile(
          { type: "agent", id: agent.id },
          {
            name: agent.name,
            initials,
            title:
              typeof agent.metadata?.teamName === "string"
                ? agent.metadata.teamName
                : agent.roleKey ?? "Agent",
            tone: "indigo",
          },
        );
        actorSeed.push({ type: "agent", id: agent.id });
      }

      setTickets(response.tickets);
      setAvailableActors(collectKnownActors(response.tickets, actorSeed));
      setMissions(missionsList);
      setSource(response.source);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load assignments");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, getAccessToken, user]);

  useEffect(() => {
    if (!initialData) {
      void loadTickets();
    } else {
      // initialData seeds tickets+actors; we still want the mission
      // list for the create modal picker.
      void (async () => {
        const accessToken = (await getAccessToken()) ?? undefined;
        if (!accessToken) return;
        try {
          const m = await listMissions(accessToken);
          setMissions(m);
        } catch {
          // Soft-fail — mission picker stays empty rather than breaking the page.
        }
      })();
    }
  }, [getAccessToken, initialData, loadTickets]);

  useEffect(() => {
    const actionData = routeAction?.data;
    if (!actionData) return;

    if (!actionData.ok) {
      setValidationError(actionData.error);
      return;
    }

    setIntegrationWarnings(actionData.integrationWarnings);
    setSource(actionData.source);
    setTickets((current) => [actionData.aggregate.ticket, ...current]);
    setCreateOpen(false);
    setFormState(EMPTY_FORM);
    setValidationError(null);
    navigate(`/tickets/${actionData.aggregate.ticket.id}`);
  }, [navigate, routeAction?.data]);

  // Note: we *don't* sync URL → state on every searchParams change.
  // Earlier this effect read `?status=`/`?priority=`/`?sla=` from
  // the URL and reset filter state — which clobbered the user's
  // dropdown choices on every render (since `searchParams` is a
  // fresh URLSearchParams object reference React-Router emits per
  // call), making the filters feel "broken". State is now seeded
  // once from URL via the useState() initializers above and updated
  // imperatively when the user picks a filter (which writes back to
  // the URL via setSearchParams in writeFilter below).

  const writeFilter = useCallback(
    (key: "status" | "priority" | "sla", value: string) => {
      const next = new URLSearchParams(searchParams);
      if (!value || value === "all") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const actorOptions = useMemo(
    () => collectKnownActors(tickets, availableActors),
    [availableActors, tickets],
  );

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (statusFilter !== "all" && ticket.status !== statusFilter) return false;
      if (priorityFilter !== "all" && ticket.priority !== priorityFilter) return false;
      if (
        slaFilter !== "all" &&
        normalizeTicketSlaState(ticket.slaState) !== slaFilter
      )
        return false;
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

    // DASH-11: when the owner picks a mission, attach `mission:<id>`
    // to the tag list so the existing tag-search/filter surface
    // groups this assignment with the rest of the mission.
    const composedTags = formState.missionId
      ? formState.tags.trim()
        ? `${formState.tags},mission:${formState.missionId}`
        : `mission:${formState.missionId}`
      : formState.tags;

    if (routeAction) {
      routeAction.submit({
        title: formState.title,
        description: formState.description,
        priority: formState.priority,
        primaryActorKey: formState.primaryActorKey,
        collaboratorKeys: formState.collaboratorKeys,
        dueDate: formState.dueDate,
        tags: composedTags,
        workspaceId: activeWorkspaceId ?? undefined,
        externalSyncRequested: formState.externalSyncRequested,
      });
      return;
    }

    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const created = await createTicket(
        buildCreateTicketPayload({
          ...formState,
          tags: composedTags,
          workspaceId: activeWorkspaceId ?? undefined,
        }),
        accessToken,
      );
      setIntegrationWarnings(created.integrationWarnings);
      setSource(created.source);
      setTickets((current) => [created.ticket, ...current]);
      setCreateOpen(false);
      setFormState(EMPTY_FORM);
      navigate(`/tickets/${created.ticket.id}`);
    } catch (submitError) {
      setValidationError(
        submitError instanceof Error ? submitError.message : "Unable to create assignment.",
      );
    }
  }

  return (
    <div className="af2-page text-af2-ink">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Assignments</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Mission assignments
          </h1>
          <div className="af2-page-head-meta">
            {counts.total} {counts.total === 1 ? "assignment" : "assignments"} in
            the queue · {counts.urgent} urgent · {counts.blocked} blocked.
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/mission-assignments/team"
            className="af2-btn"
            style={{ textDecoration: "none" }}
          >
            Team view
          </Link>
          <Link
            to="/mission-assignments/sla"
            className="af2-btn"
            style={{ textDecoration: "none" }}
          >
            SLA monitor
          </Link>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="af2-btn af2-btn-clay"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Plus size={14} />
            New assignment
          </button>
        </div>
      </div>

      <div className="af2-stats" style={{ marginBottom: 22 }}>
        <Stat label="Queue" value={String(counts.total)} hint="Open scope across the workspace." />
        <Stat label="Executing" value={String(counts.active)} hint="In flight right now." />
        <Stat label="Blocked" value={String(counts.blocked)} hint="Needs external action." />
        <Stat label="Urgent" value={String(counts.urgent)} hint="Priority assignments at risk." />
      </div>

      <TicketSourceNotice source={source} warnings={integrationWarnings} />

      {/* Filter row */}
      <div className="af2-card" style={{ padding: 14, marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 150px 150px 150px auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <label style={{ display: "block", position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--af2-ink-3)",
                pointerEvents: "none",
              }}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, ID, tag, or owner"
              className="af2-input"
              style={{ width: "100%", paddingLeft: 32 }}
              aria-label="Search assignments"
            />
          </label>

          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value as StatusFilter);
              writeFilter("status", value);
            }}
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            label="Priority"
            value={priorityFilter}
            onChange={(value) => {
              setPriorityFilter(value as PriorityFilter);
              writeFilter("priority", value);
            }}
            options={PRIORITY_OPTIONS}
          />
          <FilterSelect
            label="SLA"
            value={slaFilter}
            onChange={(value) => {
              setSlaFilter(value as SlaFilter);
              writeFilter("sla", value);
            }}
            options={SLA_OPTIONS}
          />

          <button
            type="button"
            onClick={() => {
              void loadTickets();
            }}
            className="af2-btn af2-btn-sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            aria-label="Refresh assignments"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <Loader2 className="animate-spin" style={{ margin: "0 auto 12px", opacity: 0.5 }} />
          <p className="af2-muted">Loading assignments…</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--af2-radius)",
            border: "1px solid rgba(192,84,76,0.30)",
            background: "rgba(192,84,76,0.10)",
            color: "var(--af2-clay)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : filteredTickets.length === 0 ? (
        <div
          className="af2-card"
          style={{
            padding: "32px 24px",
            textAlign: "center",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p
            className="font-af2-serif"
            style={{ fontSize: 15, color: "var(--af2-ink-2)", margin: 0 }}
          >
            {tickets.length === 0
              ? "No assignments yet. Hand off work to an agent to start the queue."
              : "No assignments match those filters."}
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="af2-btn af2-btn-clay af2-btn-sm"
            style={{
              marginTop: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Plus size={13} />
            New assignment
          </button>
        </div>
      ) : (
        <div className="af2-list">
          <div
            className="af2-list-head"
            style={{
              display: "grid",
              gridTemplateColumns:
                "110px minmax(0, 1.4fr) 160px 140px 110px 90px",
              gap: 14,
            }}
          >
            <span>ID</span>
            <span>Summary</span>
            <span>Owner</span>
            <span>Status</span>
            <span>Priority</span>
            <span>SLA</span>
          </div>
          {filteredTickets.map((ticket, idx) => (
            <Link
              key={ticket.id}
              to={`/tickets/${ticket.id}`}
              className="af2-list-row"
              style={{
                gridTemplateColumns:
                  "110px minmax(0, 1.4fr) 160px 140px 110px 90px",
                gap: 14,
                cursor: "pointer",
                textDecoration: "none",
                color: "inherit",
                borderBottom:
                  idx < filteredTickets.length - 1
                    ? "1px solid var(--af2-line)"
                    : "none",
              }}
            >
              <div>
                <div
                  className="af2-mono af2-muted-2"
                  style={{ fontSize: 11, textTransform: "uppercase" }}
                >
                  {ticket.id.slice(0, 8)}
                </div>
                <div className="af2-muted-2" style={{ fontSize: 11, marginTop: 4 }}>
                  Upd. {relativeTicketTime(ticket.updatedAt)}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <p
                  className="font-af2-serif"
                  style={{
                    fontSize: 14,
                    lineHeight: 1.35,
                    margin: 0,
                    color: "var(--af2-ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ticket.title}
                </p>
                <p
                  className="af2-muted"
                  style={{
                    fontSize: 12,
                    margin: "4px 0 0",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ticket.description || "No description provided."}
                </p>
                <div style={{ marginTop: 6 }}>
                  <TicketRowMeta ticket={ticket} />
                </div>
              </div>
              <div>
                {primaryAssignee(ticket) ? (
                  <TicketActorChip actor={primaryAssignee(ticket)!} compact />
                ) : (
                  <span className="af2-muted" style={{ fontSize: 12 }}>
                    No owner
                  </span>
                )}
                {collaboratorCount(ticket) > 0 ? (
                  <div className="af2-muted-2" style={{ fontSize: 11, marginTop: 4 }}>
                    + {collaboratorCount(ticket)}{" "}
                    collaborator{collaboratorCount(ticket) === 1 ? "" : "s"}
                  </div>
                ) : null}
              </div>
              <div>
                <TicketStatusBadge status={ticket.status} />
              </div>
              <div>
                <TicketPriorityBadge priority={ticket.priority} />
              </div>
              <div>
                <TicketSlaBadge slaState={ticket.slaState} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {createOpen ? (
        <NewAssignmentModal
          actorOptions={actorOptions}
          missions={missions}
          formState={formState}
          setFormState={setFormState}
          submitting={submitting}
          validationError={validationError}
          onClose={() => {
            setCreateOpen(false);
            setValidationError(null);
          }}
          onSubmit={(event) => {
            void handleCreateTicket(event);
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="af2-stat">
      <div className="af2-stat-label">{label}</div>
      <div className="af2-stat-value">{value}</div>
      <div className="af2-stat-delta af2-muted-2">{hint}</div>
    </div>
  );
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
    <label style={{ display: "grid", gap: 4 }}>
      <span className="af2-eyebrow">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="af2-input"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? `All ${label.toLowerCase()}` : option.replace("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

interface NewAssignmentModalProps {
  actorOptions: TicketActorRef[];
  missions: Mission[];
  formState: typeof EMPTY_FORM;
  setFormState: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  submitting: boolean;
  validationError: string | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * DASH-11: V2 New Assignment modal.
 *
 * Fields: title, description, mission (optional picker), primary
 * assignee (agent or user), priority, tags, due date.
 *
 * Mission selection composes a `mission:<missionId>` tag onto the
 * ticket so existing tag-based filtering "just works" without a
 * schema change.
 */
function NewAssignmentModal({
  actorOptions,
  missions,
  formState,
  setFormState,
  submitting,
  validationError,
  onClose,
  onSubmit,
}: NewAssignmentModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-assignment-heading"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(20, 22, 24, 0.55)",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "transparent",
          border: "none",
          cursor: "default",
        }}
      />
      <form
        onSubmit={onSubmit}
        className="af2-card"
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          background: "var(--af2-card)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div>
            <div className="af2-eyebrow">Run · Assignments · New</div>
            <h2
              id="new-assignment-heading"
              className="af2-h2 font-af2-serif"
              style={{ marginTop: 6 }}
            >
              Hand off work to an agent
            </h2>
            <p className="af2-muted" style={{ fontSize: 13, marginTop: 4 }}>
              Scope to a mission, pick the agent, set priority. The ticket
              shows up in their queue immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="af2-btn af2-btn-sm"
            aria-label="Close modal"
            style={{
              padding: 6,
              minWidth: 32,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="af2-eyebrow">Title</span>
            <input
              autoFocus
              aria-label="Assignment title"
              value={formState.title}
              onChange={(event) =>
                setFormState((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Describe the outcome you need"
              className="af2-input"
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span className="af2-eyebrow">Description</span>
            <textarea
              rows={4}
              aria-label="Assignment description"
              value={formState.description}
              onChange={(event) =>
                setFormState((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Context, expected artifacts, blockers, customer impact…"
              className="af2-input"
              style={{ resize: "vertical" }}
            />
          </label>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Mission</span>
              <select
                aria-label="Assignment mission"
                value={formState.missionId}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    missionId: event.target.value,
                  }))
                }
                className="af2-input"
              >
                <option value="">No mission · standalone</option>
                {missions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.statement.length > 60
                      ? `${m.statement.slice(0, 60)}…`
                      : m.statement}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Primary assignee</span>
              <select
                aria-label="Assignment primary assignee"
                value={formState.primaryActorKey}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    primaryActorKey: event.target.value,
                    collaboratorKeys: current.collaboratorKeys.filter(
                      (entry) => entry !== event.target.value,
                    ),
                  }))
                }
                className="af2-input"
              >
                <option value="">
                  {actorOptions.length === 0 ? "No assignees available" : "Choose an owner"}
                </option>
                {actorOptions.map((actor) => {
                  const key = `${actor.type}:${actor.id}`;
                  return (
                    <option key={key} value={key}>
                      {getTicketActorProfile(actor).name} ({actor.type})
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Priority</span>
              <select
                aria-label="Assignment priority"
                value={formState.priority}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    priority: event.target.value as TicketPriority,
                  }))
                }
                className="af2-input"
              >
                {PRIORITY_OPTIONS.filter((entry) => entry !== "all").map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Due date</span>
              <input
                type="datetime-local"
                aria-label="Assignment due date"
                value={formState.dueDate}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, dueDate: event.target.value }))
                }
                className="af2-input"
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Tags</span>
              <input
                aria-label="Assignment tags"
                value={formState.tags}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, tags: event.target.value }))
                }
                placeholder="launch, escalation"
                className="af2-input"
              />
            </label>
          </div>

          <label style={{ display: "grid", gap: 4 }}>
            <span className="af2-eyebrow">Collaborators</span>
            <select
              aria-label="Assignment collaborators"
              multiple
              value={formState.collaboratorKeys}
              onChange={(event) => {
                const nextValues = Array.from(
                  event.target.selectedOptions,
                  (option) => option.value,
                );
                setFormState((current) => ({
                  ...current,
                  collaboratorKeys: nextValues.filter(
                    (value) => value !== current.primaryActorKey,
                  ),
                }));
              }}
              className="af2-input"
              style={{ minHeight: 96 }}
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
            <span className="af2-muted-2" style={{ fontSize: 11 }}>
              Hold Cmd/Ctrl to pick multiple collaborators.
            </span>
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: 12,
              border: "1px solid var(--af2-line)",
              borderRadius: "var(--af2-radius)",
              fontSize: 12.5,
              color: "var(--af2-ink-2)",
            }}
          >
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
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>Request external sync.</strong> Forward this assignment
              to the integration sync queue (Linear, Slack, etc.) once it's
              created.
            </span>
          </label>
        </div>

        {validationError ? (
          <div
            role="alert"
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: "var(--af2-radius)",
              border: "1px solid rgba(192,84,76,0.30)",
              background: "rgba(192,84,76,0.10)",
              color: "var(--af2-clay)",
              fontSize: 13,
            }}
          >
            {validationError}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            borderTop: "1px solid var(--af2-line)",
            paddingTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="af2-btn af2-btn-ghost af2-btn-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="af2-btn af2-btn-clay"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create assignment
          </button>
        </div>
      </form>
    </div>
  );
}
