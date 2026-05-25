/**
 * Assignments — v2 prototype port (consolidation.html lines 479-648).
 *
 * Unified hub merging the old /mission-assignments queue with the
 * /agents/activity feed and /settings/mission-assignment-sla dashboard.
 * Renders inside the `.af2-v2` shell with the prototype's vocabulary
 * (page-head, tabs, filterbar, card-list, row, row-drawer, pills…).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Agent } from "../api/agentApi";
import {
  collectKnownActors,
  getTicketActorProfile,
  hydrateTicketActorProfiles,
  normalizeTicketSlaState,
  type TicketActorRef,
  type TicketRecord,
} from "../api/tickets";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useAgentsQuery } from "../hooks/queries/useAgentsQuery";
import { useMissionsQuery } from "../hooks/queries/useMissionsQuery";
import { useObservabilityQuery } from "../hooks/queries/useObservabilityQuery";
import { useTicketsQuery } from "../hooks/queries/useTicketsQuery";
import type { ObservabilityEvent } from "../api/observability";
import { queryKeys } from "../lib/queryKeys";
import { primaryAssignee } from "./tickets/ticketingUi.helpers";
import { NewAssignmentModal } from "../components/assignments/NewAssignmentModal";
import type { Mission } from "../api/missionsApi";

type TabKey = "queue" | "by-mission" | "sla" | "activity" | "by-team";

const TABS: Array<{ key: TabKey; label: string; count?: number | string }> = [
  { key: "queue", label: "Queue" },
  { key: "by-mission", label: "By mission" },
  { key: "sla", label: "SLA" },
  { key: "activity", label: "Activity" },
  { key: "by-team", label: "By team" },
];

export default function Assignments() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const ticketsQuery = useTicketsQuery();
  const agentsQuery = useAgentsQuery();
  const tickets = ticketsQuery.data?.tickets ?? [];

  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "queue";
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? initialTab : "queue",
  );

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (tab === "queue") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const [createOpen, setCreateOpen] = useState(false);
  const missionsQuery = useMissionsQuery({
    enabled: createOpen || tab === "by-mission",
  });
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

  const refresh = useCallback(() => {
    if (!activeWorkspaceId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.tickets(activeWorkspaceId),
    });
  }, [activeWorkspaceId, queryClient]);

  const queueCount = tickets.length;
  const openCount = tickets.filter(
    (t) => t.status === "open" || t.status === "in_progress",
  ).length;
  const awaiting = tickets.filter((t) => t.status === "open").length;

  return (
    <div className="af2-v2">
      <div className="page-head">
        <div className="page-head-left">
          <div className="eyebrow">Run · Work</div>
          <h1 className="h1">Assignments</h1>
          <div className="meta">
            {openCount} open · {awaiting} awaiting reply · merges /agents/activity +
            /settings/mission-assignment-sla
          </div>
        </div>
        <div className="page-head-right">
          <button type="button" className="btn">
            Filters
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreateOpen(true)}
          >
            + New assignment
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="tab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "queue" ? (
              <span className="pill" style={{ marginLeft: 6 }}>
                {queueCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="panel" hidden={tab !== "queue"}>
        <QueueTab tickets={tickets} />
      </div>
      <div className="panel" hidden={tab !== "by-mission"}>
        <ByMissionTab tickets={tickets} missions={missions} />
      </div>
      <div className="panel" hidden={tab !== "sla"}>
        <SlaTab tickets={tickets} />
      </div>
      <div className="panel" hidden={tab !== "activity"}>
        <ActivityTab agents={agentsQuery.data ?? []} />
      </div>
      <div className="panel" hidden={tab !== "by-team"}>
        <ByTeamTab tickets={tickets} agents={agentsQuery.data ?? []} />
      </div>

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

// ---- Queue tab -------------------------------------------------------------

type DrawerSubtab = "summary" | "updates" | "memory";

function QueueTab({ tickets }: { tickets: TicketRecord[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [subtab, setSubtab] = useState<DrawerSubtab>("summary");
  const [search, setSearch] = useState("");
  const [mission, setMission] = useState("any");
  const [agent, setAgent] = useState("any");
  const [priority, setPriority] = useState("any");
  const [openChip, setOpenChip] = useState(true);

  const rows = useMemo(() => {
    return tickets.map((t) => {
      const owner = primaryAssignee(t);
      const assignee = owner ? getTicketActorProfile(owner).name : "—";
      const missionTag = t.tags.find((tag) => tag.startsWith("mission:"));
      const missionId = missionTag ? missionTag.slice(8) : "";
      const status: "awaiting" | "in_progress" =
        t.status === "in_progress" ? "in_progress" : "awaiting";
      const prio: "P0" | "P1" | "P2" =
        t.priority === "urgent"
          ? "P0"
          : t.priority === "high"
            ? "P1"
            : "P2";
      return {
        id: t.id.slice(0, 8).toUpperCase(),
        title: t.title,
        desc: t.description || "",
        status,
        priority: prio,
        assignee,
        missionId,
      };
    });
  }, [tickets]);

  const missionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.missionId) set.add(r.missionId);
    }
    return Array.from(set).sort();
  }, [rows]);

  const assigneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.assignee && r.assignee !== "—") set.add(r.assignee);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (openChip && r.status !== "awaiting" && r.status !== "in_progress")
      return false;
    if (mission !== "any" && r.missionId !== mission) return false;
    if (agent !== "any" && r.assignee !== agent) return false;
    if (priority !== "any" && r.priority !== priority) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      r.title.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.desc.toLowerCase().includes(q)
    );
  });

  function toggleRow(id: string) {
    if (openId === id) setOpenId(null);
    else {
      setOpenId(id);
      setSubtab("summary");
    }
  }

  return (
    <>
      <div className="filterbar">
        <input
          type="search"
          placeholder="Search title or body…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={mission} onChange={(e) => setMission(e.target.value)}>
          <option value="any">Any mission</option>
          {missionOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="any">Any agent</option>
          {assigneeOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="any">Any priority</option>
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
        </select>
        {openChip ? (
          <span className="chip">
            open
            <button
              type="button"
              className="x"
              onClick={() => setOpenChip(false)}
              aria-label="Remove open filter"
            >
              ×
            </button>
          </span>
        ) : null}
        <div className="grow" />
      </div>

      <div className="card card-list" style={{ padding: 0 }}>
        {filtered.map((r) => {
          const isOpen = openId === r.id;
          return (
            <div key={r.id}>
              <div
                className={`row${isOpen ? " expanded" : ""}`}
                style={{
                  gridTemplateColumns: "90px 1fr 120px 100px 100px 110px",
                }}
                onClick={() => toggleRow(r.id)}
              >
                <div className="id">{r.id}</div>
                <div>
                  <b>{r.title}</b>
                  {r.desc ? (
                    <>
                      <br />
                      <span
                        style={{ color: "var(--af2-ink-3)", fontSize: 12 }}
                      >
                        {r.desc}
                      </span>
                    </>
                  ) : null}
                </div>
                <div>
                  <span
                    className={`pill dot ${r.status === "awaiting" ? "mustard" : "sage"}`}
                  >
                    {r.status === "awaiting" ? "awaiting" : "in progress"}
                  </span>
                </div>
                <div>
                  <span
                    className={`pill ${r.priority === "P0" ? "clay" : r.priority === "P1" ? "mustard" : ""}`}
                  >
                    {r.priority}
                  </span>
                </div>
                <div>{r.assignee}</div>
                <div className="actions">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRow(r.id);
                    }}
                  >
                    Open
                  </button>
                </div>
              </div>
              <div className={`row-drawer${isOpen ? " open" : ""}`}>
                <div className="row-drawer-head">
                  <div>
                    {r.missionId ? (
                      <div
                        className="eyebrow"
                        style={{ marginBottom: 4 }}
                      >
                        Mission: {r.missionId}
                      </div>
                    ) : null}
                    <h3>{r.title}</h3>
                  </div>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenId(null);
                    }}
                  >
                    Collapse ↑
                  </button>
                </div>
                <div className="subtabs">
                  {(
                    [
                      { key: "summary", label: "Summary" },
                      { key: "updates", label: "Updates" },
                      { key: "memory", label: "Memory" },
                    ] as Array<{ key: DrawerSubtab; label: string }>
                  ).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="subtab"
                      aria-selected={subtab === t.key}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSubtab(t.key);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {subtab === "summary" ? (
                  <p style={{ fontSize: 13 }}>
                    {r.assignee} owns this assignment. {r.desc}
                  </p>
                ) : subtab === "updates" ? (
                  <p style={{ fontSize: 13, color: "var(--af2-ink-3)" }}>
                    No updates posted yet.
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--af2-ink-3)" }}>
                    No memory entries written for this assignment.
                  </p>
                )}
                <div
                  style={{ display: "flex", gap: 8, marginTop: 10 }}
                >
                  <button type="button" className="btn primary">
                    Approve
                  </button>
                  <button type="button" className="btn">
                    Edit draft
                  </button>
                  <button type="button" className="btn">
                    Reassign
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--af2-ink-3)" }}>
            {rows.length === 0
              ? "No assignments in the queue."
              : "No assignments match the current filters."}
          </div>
        ) : null}
      </div>
    </>
  );
}

// ---- By mission tab --------------------------------------------------------

function ByMissionTab({
  tickets,
  missions,
}: {
  tickets: TicketRecord[];
  missions: Mission[];
}) {
  if (tickets.length === 0) {
    return (
      <div className="card">
        <p className="desc">No assignments tied to missions yet.</p>
      </div>
    );
  }

  const map = new Map<string, TicketRecord[]>();
  const orphans: TicketRecord[] = [];
  for (const t of tickets) {
    const tag = t.tags.find((x) => x.startsWith("mission:"));
    if (tag) {
      const id = tag.slice(8);
      const bucket = map.get(id) ?? [];
      bucket.push(t);
      map.set(id, bucket);
    } else {
      orphans.push(t);
    }
  }

  return (
    <>
      {Array.from(map.entries()).map(([missionId, items]) => {
        const mission = missions.find((m) => m.id === missionId);
        return (
          <div key={missionId} className="card" style={{ padding: 0 }}>
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--af2-line)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <b>Mission {missionId.slice(0, 8).toUpperCase()}</b> ·{" "}
                {mission?.statement ?? "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
                {items.length} assignments
              </div>
            </div>
            {items.map((t) => {
              const owner = primaryAssignee(t);
              return (
                <div
                  key={t.id}
                  className="row"
                  style={{
                    gridTemplateColumns: "90px 1fr 100px 90px 100px",
                  }}
                >
                  <div className="id">{t.id.slice(0, 8).toUpperCase()}</div>
                  <div>{t.title}</div>
                  <div>
                    <span
                      className={`pill dot ${t.status === "in_progress" ? "sage" : "mustard"}`}
                    >
                      {t.status === "in_progress" ? "running" : "awaiting"}
                    </span>
                  </div>
                  <div>{owner ? getTicketActorProfile(owner).name : "—"}</div>
                  <div className="actions">
                    <button type="button" className="btn sm">
                      Open
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {orphans.length > 0 ? (
        <div className="card" style={{ padding: 0, marginTop: 14 }}>
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--af2-line)",
            }}
          >
            <b>Standalone</b> · no mission
          </div>
          {orphans.map((t) => (
            <div
              key={t.id}
              className="row"
              style={{ gridTemplateColumns: "90px 1fr 100px 90px 100px" }}
            >
              <div className="id">{t.id.slice(0, 8).toUpperCase()}</div>
              <div>{t.title}</div>
              <div>
                <span className="pill">{t.status}</span>
              </div>
              <div>—</div>
              <div className="actions">
                <button type="button" className="btn sm">
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ---- SLA tab ---------------------------------------------------------------

function SlaTab({ tickets }: { tickets: TicketRecord[] }) {
  const breached = tickets.filter(
    (t) => normalizeTicketSlaState(t.slaState) === "breached",
  );
  const atRisk = tickets.filter(
    (t) => normalizeTicketSlaState(t.slaState) === "at_risk",
  );

  const stats = [
    { num: breached.length, label: "breached today" },
    { num: atRisk.length, label: "at risk (within 1h)" },
    { num: "—", label: "median time-to-resolution" },
    { num: "—", label: "SLA met (last 7d)" },
  ];

  const rows = [...breached, ...atRisk].slice(0, 6).map((t) => {
    const owner = primaryAssignee(t);
    const state = normalizeTicketSlaState(t.slaState);
    return {
      id: t.id.slice(0, 8).toUpperCase(),
      title: t.title,
      sla: {
        tone: (state === "breached" ? "clay" : "mustard") as
          | "clay"
          | "mustard",
        text: state === "breached" ? "breached" : "at risk",
      },
      who: owner ? getTicketActorProfile(owner).name : "—",
      cta: state === "breached" ? "Escalate" : "Approve now",
    };
  });

  return (
    <>
      <div className="info-strip">
        v2 SLA dashboard · was the boring /settings/mission-assignment-sla page
        · every row is actionable now
      </div>
      <div className="stat-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-num">{s.num}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="chart-wrap">
        <div className="chart-legend">
          <span className="lg">
            <span className="sw" style={{ background: "var(--af2-sage)" }} /> Met
          </span>
          <span className="lg">
            <span
              className="sw"
              style={{ background: "var(--af2-mustard)" }}
            />{" "}
            At risk
          </span>
          <span className="lg">
            <span className="sw" style={{ background: "var(--af2-clay)" }} />{" "}
            Breached
          </span>
        </div>
        <svg viewBox="0 0 600 140" style={{ width: "100%", height: 140 }}>
          <g>
            <rect x={20} y={60} width={60} height={60} fill="var(--af2-sage)" />
            <rect x={20} y={40} width={60} height={20} fill="var(--af2-mustard)" />
            <rect x={20} y={30} width={60} height={10} fill="var(--af2-clay)" />
            <rect x={100} y={50} width={60} height={70} fill="var(--af2-sage)" />
            <rect x={100} y={35} width={60} height={15} fill="var(--af2-mustard)" />
            <rect x={180} y={45} width={60} height={75} fill="var(--af2-sage)" />
            <rect x={180} y={30} width={60} height={15} fill="var(--af2-mustard)" />
            <rect x={180} y={20} width={60} height={10} fill="var(--af2-clay)" />
            <rect x={260} y={40} width={60} height={80} fill="var(--af2-sage)" />
            <rect x={260} y={30} width={60} height={10} fill="var(--af2-mustard)" />
            <rect x={340} y={35} width={60} height={85} fill="var(--af2-sage)" />
            <rect x={340} y={25} width={60} height={10} fill="var(--af2-mustard)" />
            <rect x={420} y={30} width={60} height={90} fill="var(--af2-sage)" />
            <rect x={420} y={20} width={60} height={10} fill="var(--af2-clay)" />
            <rect x={500} y={38} width={60} height={82} fill="var(--af2-sage)" />
            <rect x={500} y={28} width={60} height={10} fill="var(--af2-mustard)" />
          </g>
          <g fontFamily="JetBrains Mono" fontSize={9} fill="#6b5a48">
            <text x={48} y={135}>
              Mon
            </text>
            <text x={128} y={135}>
              Tue
            </text>
            <text x={208} y={135}>
              Wed
            </text>
            <text x={288} y={135}>
              Thu
            </text>
            <text x={368} y={135}>
              Fri
            </text>
            <text x={448} y={135}>
              Sat
            </text>
            <text x={528} y={135}>
              Sun
            </text>
          </g>
        </svg>
      </div>
      <div className="card card-list" style={{ padding: 0 }}>
        <h3>Breached / at risk · take action</h3>
        {rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--af2-ink-3)", fontSize: 13 }}>
            No SLA breaches in the last 24h.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="row"
              style={{ gridTemplateColumns: "90px 1fr 130px 110px 200px" }}
            >
              <div className="id">{r.id}</div>
              <div>
                <b>{r.title}</b>
              </div>
              <div>
                <span className={`pill ${r.sla.tone} dot`}>{r.sla.text}</span>
              </div>
              <div>{r.who}</div>
              <div className="actions">
                <button type="button" className="btn sm">
                  Reassign
                </button>
                <button type="button" className="btn sm">
                  Override
                </button>
                <button type="button" className="btn primary sm">
                  {r.cta}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ---- Activity tab ----------------------------------------------------------

function ActivityTab({ agents }: { agents: Agent[] }) {
  const eventsQuery = useObservabilityQuery();
  const events = eventsQuery.data ?? [];

  const items = events.slice(0, 30).map((e: ObservabilityEvent) => ({
    id: e.id,
    time: new Date(e.occurredAt).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    body: (
      <>
        <b>{e.actor.label ?? e.actor.id ?? "system"}</b> · {e.summary}
      </>
    ),
  }));

  return (
    <>
      <div className="info-strip">
        Activity feed moved here from /agents/activity · filterable by
        agent/mission/team
      </div>
      <div className="filterbar">
        <select>
          <option>Any event</option>
          <option>tool.call</option>
          <option>memory.write</option>
          <option>approval.resolved</option>
          <option>routine.completed</option>
        </select>
        <input type="date" />
        <div className="grow" />
        <button type="button" className="btn sm">
          Live ●
        </button>
        {agents.length > 0 ? (
          <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
            {agents.length} agents tracked
          </span>
        ) : null}
      </div>
      <div className="card">
        {items.length === 0 ? (
          <p className="desc">No activity recorded yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="feed-item">
              <div className="feed-time">{item.time}</div>
              <div className="feed-msg">{item.body}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ---- By team tab -----------------------------------------------------------

function ByTeamTab({
  tickets,
  agents,
}: {
  tickets: TicketRecord[];
  agents: Agent[];
}) {
  if (tickets.length === 0 || agents.length === 0) {
    return (
      <div className="card">
        <p className="desc">No team breakdown to show yet.</p>
      </div>
    );
  }

  const byTeam = new Map<string, { count: number; members: Set<string> }>();
  for (const t of tickets) {
    const owner = primaryAssignee(t);
    const agent =
      owner?.type === "agent"
        ? agents.find((a) => a.id === owner.id)
        : undefined;
    const meta = (agent?.metadata ?? {}) as {
      team?: string;
      teamName?: string;
    };
    const team = meta.team ?? meta.teamName ?? "General";
    const bucket = byTeam.get(team) ?? { count: 0, members: new Set<string>() };
    bucket.count += 1;
    if (owner) bucket.members.add(getTicketActorProfile(owner).name);
    byTeam.set(team, bucket);
  }

  return (
    <div className="grid-3">
      {Array.from(byTeam.entries()).map(([team, bucket]) => (
        <div key={team} className="card">
          <h3>{team}</h3>
          <div className="desc">{bucket.count} assignments</div>
          <div
            style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}
          >
            {Array.from(bucket.members).map((m) => (
              <span key={m} className="pill">
                {m}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
