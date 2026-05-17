/**
 * Per-actor queue view — V2 editorial rebuild (DASH-19).
 *
 * Sub-route at /mission-assignments/actors/:actorType/:actorId.
 * Drilling in from the Team view or SLA dashboard shows one actor's
 * full queue with status / priority / SLA filters.
 *
 * Same af2-page chrome as the rest of /mission-assignments. Sub-page
 * link targets repointed off the legacy /tickets/* redirects.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import {
  getTicketActorProfile,
  listTicketQueue,
  normalizeTicketSlaState,
  type TicketPriority,
  type TicketRecord,
  type TicketStatus,
  type TicketSlaStateLike,
} from "../api/tickets";
import { useAuth } from "../context/AuthContext";
import {
  TicketActorChip,
  TicketEmptyState,
  TicketSourceNotice,
  TicketPriorityBadge,
  TicketSlaBadge,
  TicketStatusBadge,
} from "./tickets/ticketingUi";
import { primaryAssignee, relativeTicketTime } from "./tickets/ticketingUi.helpers";

type StatusFilter = TicketStatus | "all";
type PriorityFilter = TicketPriority | "all";
type SlaFilter = TicketSlaStateLike | "all";

export default function TicketActorView() {
  const { actorType, actorId } = useParams<{
    actorType: "agent" | "user";
    actorId: string;
  }>();
  const { getAccessToken } = useAuth();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock" | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [slaFilter, setSlaFilter] = useState<SlaFilter>("all");

  const actor = useMemo(
    () => (actorType && actorId ? { type: actorType, id: actorId } : null),
    [actorId, actorType],
  );
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
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load actor queue",
      );
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
      if (
        slaFilter !== "all" &&
        normalizeTicketSlaState(ticket.slaState) !== slaFilter
      )
        return false;
      return true;
    });
  }, [priorityFilter, slaFilter, statusFilter, tickets]);

  if (!actor || !profile) {
    return (
      <div className="af2-page text-af2-ink">
        <TicketEmptyState
          title="Actor not found"
          body="The queue owner could not be resolved."
        />
      </div>
    );
  }

  return (
    <div className="af2-page text-af2-ink">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Assignments · {profile.title}</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            {profile.name}
          </h1>
          <div className="af2-page-head-meta">
            Filter this {actor.type === "agent" ? "agent's" : "person's"} queue by
            status, priority, and SLA state.
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/mission-assignments/team"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← Back to team view
          </Link>
          <Link
            to="/mission-assignments"
            className="af2-btn af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            All assignments
          </Link>
          <button
            type="button"
            onClick={() => {
              void load();
            }}
            className="af2-btn af2-btn-sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            aria-label="Refresh queue"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <TicketSourceNotice source={source} />

      <div className="af2-card" style={{ padding: 14, marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 10,
          }}
        >
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
            options={["all", "breached", "at_risk", "on_track", "paused"]}
          />
        </div>
      </div>

      {loading ? (
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <Loader2
            className="animate-spin"
            style={{ margin: "0 auto 12px", opacity: 0.5 }}
          />
          <p className="af2-muted">Loading queue…</p>
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
      ) : filtered.length === 0 ? (
        <TicketEmptyState
          title="No assignments match these filters"
          body="This actor's queue is clear for the selected slice."
        />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((ticket) => (
            <Link
              key={ticket.id}
              to={`/mission-assignments/${ticket.id}`}
              className="af2-card"
              style={{
                padding: 16,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 6,
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
                  <h2
                    className="font-af2-serif"
                    style={{
                      marginTop: 10,
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--af2-ink)",
                    }}
                  >
                    {ticket.title}
                  </h2>
                  <p
                    className="af2-muted"
                    style={{
                      marginTop: 6,
                      fontSize: 13,
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {ticket.description || "No description provided."}
                  </p>
                </div>
                {primaryAssignee(ticket) ? (
                  <TicketActorChip
                    actor={primaryAssignee(ticket)!}
                    role="Primary"
                    compact
                  />
                ) : null}
              </div>
              <div
                className="af2-muted-2"
                style={{
                  marginTop: 12,
                  fontSize: 11.5,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <span>Updated {relativeTicketTime(ticket.updatedAt)}</span>
                <span>·</span>
                <span>{ticket.tags.length ? ticket.tags.join(", ") : "No tags"}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
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
