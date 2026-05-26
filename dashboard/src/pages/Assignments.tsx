/**
 * Assignments — v2 prototype port (consolidation.html lines 479-648).
 *
 * Unified hub merging the old /mission-assignments queue with the
 * /agents/activity feed and /settings/mission-assignment-sla dashboard.
 * Renders inside the `.af2-v2` shell with the prototype's vocabulary
 * (page-head, tabs, filterbar, card-list, row, row-drawer, pills…).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Agent } from "../api/agentApi";
import {
  collectKnownActors,
  getTicketActorProfile,
  hydrateTicketActorProfiles,
  normalizeTicketSlaState,
  transitionTicket,
  type TicketActorRef,
  type TicketRecord,
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
import { primaryAssignee } from "./tickets/ticketingUi.helpers";
import { NewAssignmentModal } from "../components/assignments/NewAssignmentModal";
import { useToast } from "../components/ToastProvider";
import { useListKeyboardNav } from "../hooks/useListKeyboardNav";
import { KeyboardShortcutsOverlay } from "../components/KeyboardShortcutsOverlay";
import type { Mission } from "../api/missionsApi";

type TabKey = "queue" | "board" | "by-mission" | "sla" | "activity" | "by-team";

const TABS: Array<{ key: TabKey; label: string; count?: number | string }> = [
  { key: "queue", label: "Queue" },
  { key: "board", label: "Board" },
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
      <div className="af2-page">
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="h1">Assignments</h1>
          <div className="meta">
            {openCount} open · {awaiting} awaiting reply
          </div>
        </div>
        <div className="page-head-right">
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
      <div className="panel" hidden={tab !== "board"}>
        <BoardTab tickets={tickets} />
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
    </div>
  );
}

// ---- Queue tab -------------------------------------------------------------

type DrawerSubtab = "summary" | "updates" | "memory";

function QueueTab({ tickets }: { tickets: TicketRecord[] }) {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [subtab, setSubtab] = useState<DrawerSubtab>("summary");
  const [search, setSearch] = useState("");
  const [mission, setMission] = useState("any");
  const [agent, setAgent] = useState("any");
  const [priority, setPriority] = useState("any");
  const [openChip, setOpenChip] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function handleCancel(ticketId: string) {
    if (!window.confirm("Cancel this assignment? It will be removed from the open queue.")) {
      return;
    }
    setCancellingId(ticketId);
    try {
      const token = (await getAccessToken()) ?? undefined;
      await transitionTicket(
        ticketId,
        { status: "cancelled", actorType: "user" },
        token,
      );
      toast.success("Assignment cancelled");
      if (activeWorkspaceId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.tickets(activeWorkspaceId),
        });
      }
      setOpenId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel assignment");
    } finally {
      setCancellingId(null);
    }
  }

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
        rawId: t.id,
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

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const { focusedId, helpOpen, setHelpOpen } = useListKeyboardNav({
    ids: filteredIds,
    expandedId: openId,
    setExpandedId: setOpenId,
  });

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
          const isFocused = focusedId === r.id;
          return (
            <div key={r.id} data-keyboard-row-id={r.id}>
              <div
                className={`row${isOpen ? " expanded" : ""}`}
                style={{
                  gridTemplateColumns: "90px 1fr 120px 100px 100px 110px",
                  ...(isFocused
                    ? {
                        outline: "2px solid var(--af2-clay)",
                        outlineOffset: -2,
                      }
                    : null),
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
                  <button
                    type="button"
                    className="btn"
                    style={{ marginLeft: "auto", color: "var(--af2-clay)" }}
                    disabled={cancellingId === r.rawId}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCancel(r.rawId);
                    }}
                  >
                    {cancellingId === r.rawId ? "Cancelling…" : "Cancel"}
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
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: "var(--af2-ink-4)",
        }}
      >
        Tip: <kbd style={KBD_STYLE}>j</kbd>/<kbd style={KBD_STYLE}>k</kbd>{" "}
        to navigate, <kbd style={KBD_STYLE}>enter</kbd> to expand,{" "}
        <kbd style={KBD_STYLE}>?</kbd> for all shortcuts.
      </div>
      <KeyboardShortcutsOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Assignment queue shortcuts"
        shortcuts={[
          { keys: "j / ↓", label: "Next assignment" },
          { keys: "k / ↑", label: "Previous assignment" },
          { keys: "enter / o", label: "Expand focused row" },
          { keys: "esc", label: "Collapse" },
          { keys: "?", label: "Toggle this help" },
        ]}
      />
    </>
  );
}

const KBD_STYLE: CSSProperties = {
  fontFamily: "var(--af2-mono, ui-monospace, SFMono-Regular, monospace)",
  fontSize: 10,
  background: "var(--af2-paper-2)",
  border: "1px solid var(--af2-line-2)",
  borderRadius: 3,
  padding: "0 4px",
  color: "var(--af2-ink-2)",
};

// ---- Board (Kanban) tab ----------------------------------------------------
//
// Drag-between-column status board. Drops call `transitionTicket` on the
// API with an optimistic cache update; if the request fails the cache is
// rolled back and a toast surfaces the error.

interface BoardColumnDef {
  status: TicketStatus;
  label: string;
  tone: "" | "sage" | "mustard" | "clay" | "plum";
  hint: string;
}

const BOARD_COLUMNS: BoardColumnDef[] = [
  { status: "open", label: "Awaiting", tone: "mustard", hint: "needs pickup" },
  { status: "in_progress", label: "In progress", tone: "sage", hint: "agent working" },
  { status: "blocked", label: "Blocked", tone: "clay", hint: "needs human" },
  { status: "resolved", label: "Resolved", tone: "plum", hint: "done" },
];

function BoardTab({ tickets }: { tickets: TicketRecord[] }) {
  const queryClient = useQueryClient();
  const { getAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const toast = useToast();
  const [dragTicketId, setDragTicketId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<TicketStatus | null>(null);
  const [pending, setPending] = useState<Record<string, TicketStatus>>({});

  const grouped = useMemo(() => {
    const map = new Map<TicketStatus, TicketRecord[]>();
    for (const col of BOARD_COLUMNS) map.set(col.status, []);
    for (const t of tickets) {
      // Treat any non-board status (cancelled etc.) as resolved for display.
      const target = (pending[t.id] ?? t.status) as TicketStatus;
      const bucket = map.get(target) ?? map.get("resolved")!;
      bucket.push(t);
    }
    return map;
  }, [tickets, pending]);

  const ticketsKey = useMemo(
    () => queryKeys.tickets(activeWorkspaceId ?? "none"),
    [activeWorkspaceId],
  );

  async function moveTicket(ticketId: string, toStatus: TicketStatus) {
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.status === toStatus) return;
    const fromStatus = ticket.status;

    // Optimistic: tag pending so the card renders in the new column
    // immediately, and patch the react-query cache so other consumers see
    // the new status.
    setPending((p) => ({ ...p, [ticketId]: toStatus }));
    queryClient.setQueryData(ticketsKey, (prev: unknown) => {
      if (!prev || typeof prev !== "object") return prev;
      const payload = prev as { tickets?: TicketRecord[] };
      if (!Array.isArray(payload.tickets)) return prev;
      return {
        ...payload,
        tickets: payload.tickets.map((t) =>
          t.id === ticketId ? { ...t, status: toStatus } : t,
        ),
      };
    });

    try {
      const token = (await getAccessToken()) ?? undefined;
      await transitionTicket(ticketId, { status: toStatus, actorType: "user" }, token);
      toast.success(`Moved to ${columnLabel(toStatus)}`);
    } catch (err) {
      // Roll back optimistic change.
      queryClient.setQueryData(ticketsKey, (prev: unknown) => {
        if (!prev || typeof prev !== "object") return prev;
        const payload = prev as { tickets?: TicketRecord[] };
        if (!Array.isArray(payload.tickets)) return prev;
        return {
          ...payload,
          tickets: payload.tickets.map((t) =>
            t.id === ticketId ? { ...t, status: fromStatus } : t,
          ),
        };
      });
      toast.error(
        err instanceof Error ? err.message : "Failed to move assignment",
      );
    } finally {
      setPending((p) => {
        const { [ticketId]: _omit, ...rest } = p;
        return rest;
      });
      if (activeWorkspaceId) {
        void queryClient.invalidateQueries({ queryKey: ticketsKey });
      }
    }
  }

  if (tickets.length === 0) {
    return (
      <div className="card">
        <p className="desc">No assignments yet — drop one here when you create it.</p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(220px, 1fr))`,
        gap: 12,
        alignItems: "start",
        overflowX: "auto",
        paddingBottom: 4,
      }}
    >
      {BOARD_COLUMNS.map((col) => {
        const items = grouped.get(col.status) ?? [];
        const isHover = hoverColumn === col.status;
        return (
          <div
            key={col.status}
            onDragOver={(e) => {
              if (!dragTicketId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (hoverColumn !== col.status) setHoverColumn(col.status);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setHoverColumn(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id =
                e.dataTransfer.getData("application/x-autoflow-ticket") ||
                dragTicketId;
              setHoverColumn(null);
              setDragTicketId(null);
              if (id) void moveTicket(id, col.status);
            }}
            style={{
              border: "1px solid var(--af2-line)",
              borderColor: isHover ? "var(--af2-clay)" : "var(--af2-line)",
              borderRadius: "var(--af2-radius-lg, 12px)",
              background: isHover
                ? "color-mix(in srgb, var(--af2-clay-soft, var(--af2-paper-2)) 70%, transparent)"
                : "var(--af2-card)",
              transition: "background 0.15s, border-color 0.15s",
              minHeight: 220,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--af2-line)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span className={`pill dot ${col.tone}`}>{col.label}</span>
              <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
                {items.length} · {col.hint}
              </span>
            </div>
            <div
              style={{
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flex: 1,
              }}
            >
              {items.length === 0 ? (
                <div
                  style={{
                    border: "1px dashed var(--af2-line-2)",
                    borderRadius: "var(--af2-radius, 8px)",
                    padding: "18px 10px",
                    textAlign: "center",
                    color: "var(--af2-ink-4)",
                    fontSize: 12,
                  }}
                >
                  drop here
                </div>
              ) : (
                items.map((t) => {
                  const owner = primaryAssignee(t);
                  const assignee = owner
                    ? getTicketActorProfile(owner).name
                    : "—";
                  const prio: "P0" | "P1" | "P2" =
                    t.priority === "urgent"
                      ? "P0"
                      : t.priority === "high"
                        ? "P1"
                        : "P2";
                  const isDragging = dragTicketId === t.id;
                  const isPendingMove = pending[t.id] != null;
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData(
                          "application/x-autoflow-ticket",
                          t.id,
                        );
                        setDragTicketId(t.id);
                      }}
                      onDragEnd={() => {
                        setDragTicketId(null);
                        setHoverColumn(null);
                      }}
                      style={{
                        padding: "10px 12px",
                        border: "1px solid var(--af2-line)",
                        borderRadius: "var(--af2-radius, 8px)",
                        background: "var(--af2-paper)",
                        cursor: "grab",
                        opacity: isDragging ? 0.5 : isPendingMove ? 0.7 : 1,
                        transition: "opacity 0.12s",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 6,
                          alignItems: "baseline",
                        }}
                      >
                        <div
                          className="id"
                          style={{ fontSize: 10.5, color: "var(--af2-ink-4)" }}
                        >
                          {t.id.slice(0, 8).toUpperCase()}
                        </div>
                        <span
                          className={`pill ${prio === "P0" ? "clay" : prio === "P1" ? "mustard" : ""}`}
                          style={{ fontSize: 10 }}
                        >
                          {prio}
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--af2-ink)",
                        }}
                      >
                        {t.title}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: "var(--af2-ink-3)",
                        }}
                      >
                        {assignee}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function columnLabel(status: TicketStatus): string {
  return (
    BOARD_COLUMNS.find((c) => c.status === status)?.label ?? status
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
      <div className="stat-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-num">{s.num}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
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
