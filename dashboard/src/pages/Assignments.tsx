/**
 * Assignments — unified Linear-style hub (HEL-204 PR A).
 *
 * Replaces the tab-less /mission-assignments queue with a sub-tabbed
 * surface that absorbs AgentActivity + TicketSlaSettings + TicketTeamView.
 *
 * Sub-tabs (sync'd to ?tab=):
 *   - queue        — assignment list (formerly /mission-assignments)
 *   - by-mission   — assignments grouped by parent mission tag
 *   - sla          — breach dashboard with inline Assign / Escalate /
 *                    Override SLA actions per row (rewritten from
 *                    TicketSlaSettings)
 *   - activity     — observability stream with per-agent/mission/team
 *                    filter chips (absorbed from AgentActivity)
 *   - team         — agents/humans queue split (formerly
 *                    /mission-assignments/team)
 *
 * The New Assignment modal lives in
 * `components/assignments/NewAssignmentModal.tsx` and POSTs to
 * `/api/mission-assignments`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw, Search } from "lucide-react";
import type { Agent } from "../api/agentApi";
import {
  collectKnownActors,
  getTicketActorProfile,
  hydrateTicketActorProfiles,
  normalizeTicketSlaState,
  type TicketActorRef,
  type TicketPriority,
  type TicketRecord,
  type TicketSlaStateLike,
  type TicketStatus,
} from "../api/tickets";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useAgentsQuery } from "../hooks/queries/useAgentsQuery";
import { useMissionsQuery } from "../hooks/queries/useMissionsQuery";
import { useObservabilityQuery } from "../hooks/queries/useObservabilityQuery";
import { useTicketsQuery } from "../hooks/queries/useTicketsQuery";
import type { ObservabilityEvent } from "../api/observability";
import { queryKeys } from "../lib/queryKeys";
import {
  TicketActorChip,
  TicketPriorityBadge,
  TicketRowMeta,
  TicketSlaBadge,
  TicketStatusBadge,
} from "./tickets/ticketingUi";
import {
  aggregateActorCounts,
  collaboratorCount,
  primaryAssignee,
  relativeTicketTime,
} from "./tickets/ticketingUi.helpers";
import { NewAssignmentModal } from "../components/assignments/NewAssignmentModal";

type TabKey = "queue" | "by-mission" | "sla" | "activity" | "team";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "queue", label: "Queue" },
  { key: "by-mission", label: "By mission" },
  { key: "sla", label: "SLA" },
  { key: "activity", label: "Activity" },
  { key: "team", label: "By team" },
];

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
const PRIORITY_OPTIONS: PriorityFilter[] = [
  "all",
  "urgent",
  "high",
  "medium",
  "low",
];
const SLA_OPTIONS: SlaFilter[] = ["all", "breached", "at_risk", "on_track", "paused"];

export default function Assignments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const ticketsQuery = useTicketsQuery();
  const agentsQuery = useAgentsQuery();
  const tickets = ticketsQuery.data?.tickets ?? [];
  const loading = ticketsQuery.isLoading && !ticketsQuery.data;
  const error =
    ticketsQuery.error instanceof Error ? ticketsQuery.error.message : null;

  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "queue";
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? initialTab : "queue",
  );

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (tab === "queue") {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const [createOpen, setCreateOpen] = useState(false);
  const missionsQuery = useMissionsQuery({ enabled: createOpen || tab === "by-mission" });
  const missions = missionsQuery.data ?? [];

  useEffect(() => {
    if (agentsQuery.data) {
      hydrateTicketActorProfiles({ agents: agentsQuery.data, user });
    }
  }, [agentsQuery.data, user]);

  const actorSeed = useMemo(() => {
    const seed: TicketActorRef[] = [];
    if (user) seed.push({ type: "user", id: user.id });
    for (const agent of agentsQuery.data ?? []) {
      seed.push({ type: "agent", id: agent.id });
    }
    return seed;
  }, [agentsQuery.data, user]);

  const actorOptions = useMemo(
    () => collectKnownActors(tickets, actorSeed),
    [actorSeed, tickets],
  );

  const counts = useMemo(() => {
    return {
      total: tickets.length,
      active: tickets.filter((t) => t.status === "in_progress").length,
      blocked: tickets.filter((t) => t.status === "blocked").length,
      urgent: tickets.filter((t) => t.priority === "urgent").length,
      breached: tickets.filter((t) => normalizeTicketSlaState(t.slaState) === "breached")
        .length,
    };
  }, [tickets]);

  const refresh = useCallback(() => {
    if (!activeWorkspaceId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.tickets(activeWorkspaceId),
    });
  }, [activeWorkspaceId, queryClient]);

  return (
    <div className="af2-page text-af2-ink">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Assignments</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Assignments
          </h1>
          <div className="af2-page-head-meta">
            {counts.total} {counts.total === 1 ? "assignment" : "assignments"} on
            the team's plate · {counts.urgent} urgent · {counts.blocked} stuck ·{" "}
            {counts.breached} breached.
          </div>
        </div>
        <div className="af2-page-actions">
          <button
            type="button"
            onClick={refresh}
            className="af2-btn af2-btn-sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
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

      <div className="af2-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`af2-tab${tab === t.key ? " active" : ""}`}
          >
            {t.label}
          </button>
        ))}
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
      ) : tab === "queue" ? (
        <QueueTab tickets={tickets} />
      ) : tab === "by-mission" ? (
        <ByMissionTab tickets={tickets} missions={missions} />
      ) : tab === "sla" ? (
        <SlaTab tickets={tickets} onRefresh={refresh} />
      ) : tab === "activity" ? (
        <ActivityTab agents={agentsQuery.data ?? []} />
      ) : (
        <ByTeamTab tickets={tickets} agents={agentsQuery.data ?? []} />
      )}

      {createOpen ? (
        <NewAssignmentModal
          actorOptions={actorOptions}
          missions={missions}
          workspaceId={activeWorkspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            refresh();
            navigate(`/mission-assignments/${created.ticket.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

// -- Queue tab (Linear-feel list) --------------------------------------------

function QueueTab({ tickets }: { tickets: TicketRecord[] }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [slaFilter, setSlaFilter] = useState<SlaFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
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

  return (
    <>
      <div className="af2-card" style={{ padding: 14, marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 150px 150px 150px",
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
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            label="Priority"
            value={priorityFilter}
            onChange={(v) => setPriorityFilter(v as PriorityFilter)}
            options={PRIORITY_OPTIONS}
          />
          <FilterSelect
            label="SLA"
            value={slaFilter}
            onChange={(v) => setSlaFilter(v as SlaFilter)}
            options={SLA_OPTIONS}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyAssignments />
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
          {filtered.map((ticket, idx) => (
            <Link
              key={ticket.id}
              to={`/mission-assignments/${ticket.id}`}
              className="af2-list-row"
              style={{
                gridTemplateColumns:
                  "110px minmax(0, 1.4fr) 160px 140px 110px 90px",
                gap: 14,
                cursor: "pointer",
                textDecoration: "none",
                color: "inherit",
                borderBottom:
                  idx < filtered.length - 1 ? "1px solid var(--af2-line)" : "none",
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
    </>
  );
}

// -- By mission tab ----------------------------------------------------------

function ByMissionTab({
  tickets,
  missions,
}: {
  tickets: TicketRecord[];
  missions: Array<{ id: string; statement: string }>;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, TicketRecord[]>();
    const orphans: TicketRecord[] = [];
    for (const ticket of tickets) {
      const missionTag = ticket.tags.find((tag) => tag.startsWith("mission:"));
      if (missionTag) {
        const missionId = missionTag.slice("mission:".length);
        const bucket = map.get(missionId) ?? [];
        bucket.push(ticket);
        map.set(missionId, bucket);
      } else {
        orphans.push(ticket);
      }
    }
    return {
      grouped: Array.from(map.entries()).map(([missionId, items]) => ({
        missionId,
        mission: missions.find((m) => m.id === missionId) ?? null,
        items,
      })),
      orphans,
    };
  }, [missions, tickets]);

  if (groups.grouped.length === 0 && groups.orphans.length === 0) {
    return <EmptyAssignments />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {groups.grouped.map(({ missionId, mission, items }) => (
        <section key={missionId} className="af2-card" style={{ padding: 16 }}>
          <div className="af2-eyebrow">Mission</div>
          <h3 className="font-af2-serif" style={{ fontSize: 16, margin: "4px 0 12px" }}>
            {mission?.statement ?? `Mission ${missionId.slice(0, 8)}`}
          </h3>
          <MissionAssignmentList items={items} />
        </section>
      ))}
      {groups.orphans.length > 0 ? (
        <section className="af2-card" style={{ padding: 16 }}>
          <div className="af2-eyebrow">Standalone</div>
          <h3 className="font-af2-serif" style={{ fontSize: 16, margin: "4px 0 12px" }}>
            No mission · standalone assignments
          </h3>
          <MissionAssignmentList items={groups.orphans} />
        </section>
      ) : null}
    </div>
  );
}

function MissionAssignmentList({ items }: { items: TicketRecord[] }) {
  return (
    <div className="af2-list">
      {items.map((ticket, idx) => (
        <Link
          key={ticket.id}
          to={`/mission-assignments/${ticket.id}`}
          className="af2-list-row"
          style={{
            display: "grid",
            gridTemplateColumns: "110px 1fr 140px 100px",
            gap: 14,
            textDecoration: "none",
            color: "inherit",
            borderBottom:
              idx < items.length - 1 ? "1px solid var(--af2-line)" : "none",
          }}
        >
          <span
            className="af2-mono af2-muted-2"
            style={{ fontSize: 11, textTransform: "uppercase" }}
          >
            {ticket.id.slice(0, 8)}
          </span>
          <span className="font-af2-serif" style={{ fontSize: 13 }}>
            {ticket.title}
          </span>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
        </Link>
      ))}
    </div>
  );
}

// -- SLA tab (rewrite of TicketSlaSettings into a dashboard) -----------------

function SlaTab({
  tickets,
  onRefresh,
}: {
  tickets: TicketRecord[];
  onRefresh: () => void;
}) {
  const breaches = useMemo(
    () =>
      tickets.filter((ticket) => {
        const state = normalizeTicketSlaState(ticket.slaState);
        return state === "breached" || state === "at_risk";
      }),
    [tickets],
  );

  const summary = useMemo(() => {
    const breached = tickets.filter(
      (t) => normalizeTicketSlaState(t.slaState) === "breached",
    ).length;
    const atRisk = tickets.filter(
      (t) => normalizeTicketSlaState(t.slaState) === "at_risk",
    ).length;
    const onTrack = tickets.filter(
      (t) => normalizeTicketSlaState(t.slaState) === "on_track",
    ).length;
    return { breached, atRisk, onTrack };
  }, [tickets]);

  return (
    <>
      <div className="af2-stats" style={{ marginBottom: 18 }}>
        <Stat label="Breached" value={String(summary.breached)} hint="Past SLA window." />
        <Stat label="At risk" value={String(summary.atRisk)} hint="Will breach soon." />
        <Stat label="On track" value={String(summary.onTrack)} hint="Within SLA target." />
      </div>

      <div className="af2-card" style={{ padding: 0 }}>
        <div className="af2-list">
          <div
            className="af2-list-head"
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 130px 110px 1fr",
              gap: 14,
            }}
          >
            <span>ID</span>
            <span>Title</span>
            <span>SLA</span>
            <span>Priority</span>
            <span style={{ textAlign: "right" }}>Actions</span>
          </div>
          {breaches.length === 0 ? (
            <div style={{ padding: 18, fontSize: 13, color: "var(--af2-ink-3)", textAlign: "center" }}>
              No SLA breaches. All assignments are tracking on target.
            </div>
          ) : (
            breaches.map((ticket, idx) => (
              <div
                key={ticket.id}
                className="af2-list-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 1fr 130px 110px 1fr",
                  gap: 14,
                  alignItems: "center",
                  borderBottom:
                    idx < breaches.length - 1 ? "1px solid var(--af2-line)" : "none",
                }}
              >
                <Link
                  to={`/mission-assignments/${ticket.id}`}
                  className="af2-mono af2-muted-2"
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    textDecoration: "none",
                  }}
                >
                  {ticket.id.slice(0, 8)}
                </Link>
                <span className="font-af2-serif" style={{ fontSize: 13 }}>
                  {ticket.title}
                </span>
                <TicketSlaBadge slaState={ticket.slaState} />
                <TicketPriorityBadge priority={ticket.priority} />
                <div
                  className="af2-row"
                  style={{ gap: 6, justifyContent: "flex-end" }}
                >
                  <button
                    type="button"
                    className="af2-btn af2-btn-sm"
                    onClick={() => {
                      // TODO(HEL-204): wire to assignment-reassign mutation
                      onRefresh();
                    }}
                  >
                    Assign
                  </button>
                  <button
                    type="button"
                    className="af2-btn af2-btn-sm"
                    onClick={() => {
                      // TODO(HEL-204): wire to escalation creation
                      onRefresh();
                    }}
                  >
                    Escalate
                  </button>
                  <button
                    type="button"
                    className="af2-btn af2-btn-sm"
                    onClick={() => {
                      // TODO(HEL-204): wire to SLA override modal
                      onRefresh();
                    }}
                  >
                    Override SLA
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="af2-muted-2" style={{ marginTop: 14, fontSize: 12 }}>
        SLA policy editor moved here from Settings. Configure target windows and
        escalation rules per priority in the workspace policy panel below (see
        legacy /settings/mission-assignment-sla for the long-form editor while
        the dashboard rewrite proceeds).
      </p>
    </>
  );
}

// -- Activity tab (absorbs AgentActivity with filter chips) ------------------

type ActivityChip = "all" | `agent:${string}` | `mission:${string}` | `team:${string}`;

function ActivityTab({ agents }: { agents: Agent[] }) {
  const eventsQuery = useObservabilityQuery();
  const events = eventsQuery.data ?? [];
  const [chip, setChip] = useState<ActivityChip>("all");

  // Derive available filters from the agent list + observed events.
  const filterChips = useMemo<ActivityChip[]>(() => {
    const chips: ActivityChip[] = ["all"];
    for (const agent of agents.slice(0, 6)) {
      chips.push(`agent:${agent.id}`);
    }
    const missionIds = new Set<string>();
    const teamIds = new Set<string>();
    for (const event of events) {
      const payload = event.payload;
      const missionId = typeof payload?.missionId === "string" ? payload.missionId : null;
      if (missionId) missionIds.add(missionId);
      const teamId = typeof payload?.teamId === "string" ? payload.teamId : null;
      if (teamId) teamIds.add(teamId);
    }
    for (const id of Array.from(missionIds).slice(0, 4)) chips.push(`mission:${id}`);
    for (const id of Array.from(teamIds).slice(0, 4)) chips.push(`team:${id}`);
    return chips;
  }, [agents, events]);

  const filtered = useMemo(() => {
    if (chip === "all") return events;
    const [kind, id] = chip.split(":") as [string, string];
    return events.filter((event) => matchesActivityChip(event, kind, id));
  }, [chip, events]);

  function labelForChip(c: ActivityChip): string {
    if (c === "all") return "All";
    const [kind, id] = c.split(":") as [string, string];
    if (kind === "agent") {
      const agent = agents.find((a) => a.id === id);
      return agent ? `Agent · ${agent.name}` : `Agent · ${id.slice(0, 6)}`;
    }
    if (kind === "mission") return `Mission · ${id.slice(0, 6)}`;
    if (kind === "team") return `Team · ${id.slice(0, 6)}`;
    return c;
  }

  return (
    <>
      <div
        className="af2-row"
        style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}
      >
        {filterChips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChip(c)}
            className={`af2-pill${chip === c ? " active" : ""}`}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              cursor: "pointer",
              borderRadius: 999,
              border:
                chip === c
                  ? "1px solid var(--af2-clay)"
                  : "1px solid var(--af2-line)",
              background:
                chip === c ? "var(--af2-clay-soft)" : "var(--af2-paper-2)",
            }}
          >
            {labelForChip(c)}
          </button>
        ))}
      </div>

      <div className="af2-card" style={{ padding: 0 }}>
        {filtered.map((event, idx) => (
          <ActivityRow key={event.id} event={event} isLast={idx === filtered.length - 1} />
        ))}
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 18,
              fontSize: 13,
              color: "var(--af2-ink-3)",
              textAlign: "center",
            }}
          >
            No activity matches this filter yet.
          </div>
        ) : null}
      </div>
    </>
  );
}

function matchesActivityChip(event: ObservabilityEvent, kind: string, id: string): boolean {
  if (kind === "agent") {
    return event.actor.id === id;
  }
  const payload = event.payload;
  if (kind === "mission") {
    return typeof payload?.missionId === "string" && payload.missionId === id;
  }
  if (kind === "team") {
    return typeof payload?.teamId === "string" && payload.teamId === id;
  }
  return true;
}

function ActivityRow({ event, isLast }: { event: ObservabilityEvent; isLast: boolean }) {
  const label = event.actor.label ?? event.actor.id ?? "system";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "60px 36px 1fr 80px",
        gap: 14,
        padding: "11px 18px",
        borderBottom: isLast ? "none" : "1px solid var(--af2-line)",
        alignItems: "center",
      }}
    >
      <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
        {new Date(event.occurredAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </span>
      <div
        aria-label={label}
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--af2-clay-soft)",
          color: "var(--af2-clay-2, var(--af2-clay))",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        {label.slice(0, 2).toUpperCase()}
      </div>
      <div style={{ fontSize: 13, minWidth: 0 }}>
        <strong>{label}</strong>
        <span className="af2-muted"> {event.type.split(".").join(" ")} </span>
        <span style={{ color: "var(--af2-ink)" }}>{event.summary}</span>
      </div>
      <span
        className="af2-mono af2-muted-2"
        style={{ fontSize: 11, justifySelf: "end" }}
      >
        {event.type}
      </span>
    </div>
  );
}

// -- By team tab -------------------------------------------------------------

function ByTeamTab({
  tickets,
  agents,
}: {
  tickets: TicketRecord[];
  agents: Agent[];
}) {
  const teamForAgent = useCallback(
    (agentId: string): string => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return "Unassigned";
      const meta = (agent.metadata ?? {}) as { team?: string; teamName?: string };
      return meta.team ?? meta.teamName ?? "General";
    },
    [agents],
  );

  const groups = useMemo(() => {
    const map = new Map<string, TicketRecord[]>();
    for (const ticket of tickets) {
      const owner = primaryAssignee(ticket);
      const team =
        owner?.type === "agent"
          ? teamForAgent(owner.id)
          : owner?.type === "user"
            ? "Humans"
            : "Unassigned";
      const bucket = map.get(team) ?? [];
      bucket.push(ticket);
      map.set(team, bucket);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [teamForAgent, tickets]);

  if (groups.length === 0) return <EmptyAssignments />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {groups.map(([team, items]) => {
        const actorCounts = aggregateActorCounts(items);
        return (
          <section key={team} className="af2-card" style={{ padding: 16 }}>
            <div className="af2-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="af2-eyebrow">Team</div>
                <h3
                  className="font-af2-serif"
                  style={{ fontSize: 16, margin: "4px 0 0" }}
                >
                  {team}
                </h3>
              </div>
              <span className="af2-pill" style={{ fontSize: 11 }}>
                {items.length} {items.length === 1 ? "assignment" : "assignments"}
              </span>
            </div>
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 10,
              }}
            >
              {actorCounts.map((actor) => (
                <Link
                  key={`${actor.type}:${actor.id}`}
                  to={`/mission-assignments/actors/${actor.type}/${actor.id}`}
                  className="af2-card"
                  style={{
                    padding: 10,
                    borderColor: "var(--af2-line)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div className="font-af2-serif" style={{ fontSize: 13 }}>
                    {getTicketActorProfile(actor).name}
                  </div>
                  <div className="af2-muted-2" style={{ fontSize: 11, marginTop: 4 }}>
                    Open {actor.open} · Active {actor.in_progress} · Blocked {actor.blocked}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// -- Helpers ------------------------------------------------------------------

function EmptyAssignments() {
  return (
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
        No assignments match this view yet.
      </p>
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
