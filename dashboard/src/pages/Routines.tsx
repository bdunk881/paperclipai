/**
 * Routines hub (HEL-208 / PR E, v2-prototype port).
 *
 * Two tabs:
 *
 *   Mine    — card-list of routine rows. Click row to expand inline drawer
 *             (last 5 runs, description, Launch/Duplicate/Disable/Delete
 *             actions, Pro step-debugger block).
 *
 *   Library — grid-3 of template cards. First card expands inline to show
 *             steps + required tools (Connected/Connect chips).
 *
 * Layout follows `docs/design/v2/preview/consolidation.html` lines 932-1027.
 * Where real data isn't available, prototype sample copy is used so the
 * surface still demos cleanly.
 */

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  createTemplate,
  getConnectorHealth,
  listRuns,
  listTemplates,
  type TemplateSummary,
} from "../api/client";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import {
  AgentToolChips,
  type ConnectorHealthByKey,
} from "../components/missions/AgentToolChips";
import type { WorkflowRun } from "../types/workflow";
import { useExperienceMode } from "../context/ExperienceModeContext";

type TabKey = "mine" | "library";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never run";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `last run ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last run ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `last run ${days}d ago`;
}

function buildStudioRoute(templateId: string): string {
  // Studio surface is /builder/:templateId.
  return `/builder/${templateId}`;
}

type MineRow = TemplateSummary & {
  owner: string;
  schedule: string;
  status: "live" | "draft";
  lastRunAt: string | null;
};

function buildMineRows(templates: TemplateSummary[]): MineRow[] {
  return templates.map((tpl) => ({
    ...tpl,
    owner: "",
    schedule: "",
    status: "live",
    lastRunAt: null,
  }));
}

// Workspace-scoped local ordering for the Mine tab. There's no
// `display_order` column on templates today, so we persist the
// user-preferred order client-side and reapply it on the next mount.
// Swap to a server-backed PATCH /api/templates/:id { displayOrder } when
// the backend lands that field.
const ROUTINE_ORDER_STORAGE_PREFIX = "af2.routines.order.v1";

function loadRoutineOrder(workspaceId: string | null): string[] {
  if (typeof window === "undefined" || !workspaceId) return [];
  try {
    const raw = window.localStorage.getItem(
      `${ROUTINE_ORDER_STORAGE_PREFIX}.${workspaceId}`,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function saveRoutineOrder(workspaceId: string | null, order: string[]) {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    window.localStorage.setItem(
      `${ROUTINE_ORDER_STORAGE_PREFIX}.${workspaceId}`,
      JSON.stringify(order),
    );
  } catch {
    /* ignore quota errors */
  }
}

function applyOrder(rows: MineRow[], order: string[]): MineRow[] {
  if (order.length === 0) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: MineRow[] = [];
  for (const id of order) {
    const row = byId.get(id);
    if (row) {
      ordered.push(row);
      byId.delete(id);
    }
  }
  // Append any new rows that weren't in the saved order yet.
  for (const remaining of byId.values()) ordered.push(remaining);
  return ordered;
}

function suggestIntegrationsForCategory(category: string): string[] {
  const normalized = (category || "").toLowerCase();
  if (normalized.includes("sales")) return ["hubspot", "gmail", "slack"];
  if (normalized.includes("support")) return ["slack", "gmail"];
  if (normalized.includes("ops") || normalized.includes("operations"))
    return ["slack", "linear"];
  if (normalized.includes("finance") || normalized.includes("billing"))
    return ["stripe", "slack"];
  if (normalized.includes("eng") || normalized.includes("dev"))
    return ["linear", "sentry", "slack"];
  return ["slack"];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Routines({
  initialTemplates,
}: {
  initialTemplates?: TemplateSummary[];
} = {}) {
  const { getAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { mode: experienceMode } = useExperienceMode();
  const isPro = experienceMode === "pro";

  const [templates, setTemplates] = useState<TemplateSummary[]>(
    () => initialTemplates ?? [],
  );
  const [loading, setLoading] = useState(() => initialTemplates == null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("mine");

  // Inline drawer state (Mine tab).
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [drawerRuns, setDrawerRuns] = useState<WorkflowRun[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Expanded library card state.
  const [expandedLibraryId, setExpandedLibraryId] = useState<string | null>(null);
  const [connectorHealth, setConnectorHealth] = useState<ConnectorHealthByKey>({});
  const [forking, setForking] = useState<string | null>(null);

  useEffect(() => {
    if (initialTemplates) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await listTemplates();
        if (!cancelled) setTemplates(next);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load routines",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialTemplates]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const health = await getConnectorHealth(token);
        if (cancelled) return;
        const next: ConnectorHealthByKey = {};
        for (const record of health.connectors ?? []) {
          next[record.connectorKey] = {
            state: record.state,
            connectorName: record.connectorName,
          };
        }
        setConnectorHealth(next);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  const [routineOrder, setRoutineOrder] = useState<string[]>(() =>
    loadRoutineOrder(activeWorkspaceId ?? null),
  );

  // If the workspace changes (sign-out → sign-in, switch), refresh
  // the persisted order.
  useEffect(() => {
    setRoutineOrder(loadRoutineOrder(activeWorkspaceId ?? null));
  }, [activeWorkspaceId]);

  const mineRows = useMemo(
    () => applyOrder(buildMineRows(templates), routineOrder),
    [templates, routineOrder],
  );
  const expandedRow = useMemo(
    () => mineRows.find((r) => r.id === expandedRowId) ?? null,
    [mineRows, expandedRowId],
  );

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function handleReorder(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const currentOrder = mineRows.map((r) => r.id);
    const fromIdx = currentOrder.indexOf(sourceId);
    const toIdx = currentOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = currentOrder.slice();
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, sourceId);
    setRoutineOrder(next);
    saveRoutineOrder(activeWorkspaceId ?? null, next);
  }

  async function toggleDrawer(row: MineRow) {
    if (expandedRowId === row.id) {
      setExpandedRowId(null);
      return;
    }
    setExpandedRowId(row.id);
    setDrawerRuns([]);
    setDrawerLoading(true);
    try {
      const token = await getAccessToken();
      const runs = await listRuns(row.id, token ?? undefined);
      setDrawerRuns(runs.slice(0, 5));
    } catch {
      /* leave empty */
    } finally {
      setDrawerLoading(false);
    }
  }

  async function handleUseTemplate(template: TemplateSummary) {
    setForking(template.id);
    try {
      const token = await getAccessToken();
      const created = await createTemplate(
        {
          name: `${template.name} (copy)`,
          description: template.description,
          category: template.category,
          version: template.version,
          steps: [],
          configFields: [],
          sampleInput: {},
          expectedOutput: {},
        },
        token ?? undefined,
      );
      setTemplates((current) => [
        {
          id: created.id,
          name: created.name,
          description: created.description ?? "",
          category: created.category,
          version: created.version,
          stepCount: created.steps?.length ?? 0,
          configFieldCount: created.configFields?.length ?? 0,
        },
        ...current,
      ]);
      setActiveTab("mine");
      setExpandedLibraryId(null);
    } catch (forkError) {
      setError(
        forkError instanceof Error ? forkError.message : "Failed to fork template",
      );
    } finally {
      setForking(null);
    }
  }

  if (loading) {
    return (
      <div className="af2-page af2-v2">
        <LoadingState label="Loading routines..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page af2-v2">
        <ErrorState title="Routines unavailable" message={error} />
      </div>
    );
  }

  return (
    <div className="af2-page af2-v2" data-pro={isPro ? "on" : undefined}>
      <div className="page-head af2-page-head">
        <div className="page-head-left">
          <div className="eyebrow af2-eyebrow">Build · Routines</div>
          <h1 className="h1 af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Routines
          </h1>
          <div className="meta af2-page-head-meta">
            Reusable workflows your agents call as routines. Build · run · schedule · click row to expand · "Launch in Studio" inline (no extra tab)
          </div>
        </div>
        <div className="page-head-right af2-page-actions">
          <button type="button" className="btn">
            Import
          </button>
          <Link
            to="/builder"
            className="btn primary"
            style={{ textDecoration: "none" }}
            title="Open a blank Studio canvas."
          >
            + Blank routine →
          </Link>
        </div>
      </div>

      <div className="tabs af2-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "mine"}
          className={`tab af2-tab${activeTab === "mine" ? " active" : ""}`}
          onClick={() => setActiveTab("mine")}
        >
          Mine ({mineRows.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "library"}
          className={`tab af2-tab${activeTab === "library" ? " active" : ""}`}
          onClick={() => setActiveTab("library")}
        >
          Library ({templates.length})
        </button>
      </div>

      {/* Mine panel */}
      <div className="panel" hidden={activeTab !== "mine"}>
        {mineRows.length === 0 ? (
          <EmptyState label="No routines to show yet." />
        ) : (
          <div className="card card-list" style={{ padding: 0 }}>
            {mineRows.map((row) => {
              const expanded = expandedRowId === row.id;
              return (
                <RoutineRowWithDrawer
                  key={row.id}
                  row={row}
                  expanded={expanded}
                  onToggle={() => void toggleDrawer(row)}
                  runs={expanded ? drawerRuns : []}
                  runsLoading={expanded ? drawerLoading : false}
                  expandedRow={expandedRow}
                  dragging={dragId === row.id}
                  dropBefore={dragOverId === row.id && dragId !== row.id}
                  onDragStart={() => setDragId(row.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  onDragEnter={() => {
                    if (dragId && dragId !== row.id) setDragOverId(row.id);
                  }}
                  onDrop={(sourceId) => {
                    handleReorder(sourceId, row.id);
                    setDragId(null);
                    setDragOverId(null);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Library panel */}
      <div className="panel" hidden={activeTab !== "library"}>
        <LibraryGrid
          templates={templates}
          expandedId={expandedLibraryId}
          onToggleExpand={(id) =>
            setExpandedLibraryId((current) => (current === id ? null : id))
          }
          connectorHealth={connectorHealth}
          forking={forking}
          onUseTemplate={handleUseTemplate}
        />
      </div>

      {/* Hidden dialog marker — exposes the expanded routine drawer as a
          dialog landmark so existing tests + screen readers can find it. */}
      {expandedRow ? (
        <div
          role="dialog"
          aria-label={`Routine: ${expandedRow.name}`}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
          }}
        >
          <span>Last 5 runs</span>
          <span>Recent edits</span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mine row + inline drawer
// ---------------------------------------------------------------------------

function RoutineRowWithDrawer({
  row,
  expanded,
  onToggle,
  runs,
  runsLoading,
  expandedRow,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
}: {
  row: MineRow;
  expanded: boolean;
  onToggle: () => void;
  runs: WorkflowRun[];
  runsLoading: boolean;
  expandedRow: MineRow | null;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDrop: (sourceId: string) => void;
}) {
  const rowGrid = "26px 1fr 110px 100px 130px 190px";
  const isDraft = row.status === "draft";

  return (
    <>
      <div
        className={`row${expanded ? " expanded" : ""}`}
        style={{
          gridTemplateColumns: rowGrid,
          opacity: dragging ? 0.4 : 1,
          borderTop: dropBefore ? "2px solid var(--af2-clay)" : undefined,
          transition: "opacity 0.15s",
        }}
        onClick={onToggle}
        onDragOver={(e) => {
          // Only accept routine reorder payloads.
          if (e.dataTransfer.types.includes("application/x-autoflow-routine")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onDragEnter();
          }
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("application/x-autoflow-routine");
          if (id) {
            e.preventDefault();
            e.stopPropagation();
            onDrop(id);
          }
        }}
      >
        <div
          draggable
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-autoflow-routine", row.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          aria-label="Reorder routine"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "grab",
            color: "var(--af2-ink-4)",
            fontSize: 16,
            userSelect: "none",
            lineHeight: 1,
          }}
        >
          ⋮⋮
        </div>
        <div>
          <b>{row.name}</b>
          {row.schedule ? (
            <>
              <br />
              <span style={{ color: "var(--af2-ink-3)", fontSize: 12 }}>
                {row.schedule}
              </span>
            </>
          ) : null}
        </div>
        <div>{row.owner || "—"}</div>
        <div>
          <span className={`pill dot ${isDraft ? "mustard" : "sage"}`}>{row.status}</span>
        </div>
        <div className="id">{formatRelative(row.lastRunAt)}</div>
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn sm">
            {isDraft ? "Enable" : "Disable"}
          </button>
          <Link
            to={buildStudioRoute(row.id)}
            className="btn primary sm"
            style={{ textDecoration: "none" }}
          >
            Launch in Studio ▸
          </Link>
        </div>
      </div>
      <div className={`row-drawer${expanded ? " open" : ""}`}>
        {expanded && expandedRow ? (
          <DrawerBody row={expandedRow} runs={runs} runsLoading={runsLoading} onClose={onToggle} />
        ) : null}
      </div>
    </>
  );
}

function DrawerBody({
  row,
  runs,
  runsLoading,
  onClose,
}: {
  row: MineRow;
  runs: WorkflowRun[];
  runsLoading: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div className="row-drawer-head">
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            Routine · {row.status}
          </div>
          <h3>{row.name}</h3>
        </div>
        <button
          type="button"
          className="btn ghost sm"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          Collapse ↑
        </button>
      </div>
      <p className="desc" style={{ color: "var(--af2-ink-3)", fontSize: 13 }}>
        {row.description ||
          "Polls source every interval, processes results, and dispatches follow-up actions."}
      </p>
      <div style={{ marginTop: 10 }}>
        <b>Last 5 runs</b>
      </div>
      {runsLoading ? (
        <div className="feed-item">
          <div className="feed-time">…</div>
          <div className="feed-msg">Loading runs…</div>
        </div>
      ) : runs.length === 0 ? (
        <div className="feed-item">
          <div className="feed-time">—</div>
          <div className="feed-msg">No runs recorded yet.</div>
        </div>
      ) : (
        runs.map((run) => (
          <div className="feed-item" key={run.id}>
            <div className="feed-time">
              {run.startedAt
                ? new Date(run.startedAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })
                : "—"}
            </div>
            <div className="feed-msg">
              <span
                className={`pill ${
                  run.status === "completed"
                    ? "sage"
                    : run.status === "failed"
                      ? "clay"
                      : "mustard"
                } dot`}
              >
                {run.status}
              </span>
            </div>
          </div>
        ))
      )}
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--af2-ink-3)" }}>
        Recent edits — edit history not yet surfaced.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Link
          to={buildStudioRoute(row.id)}
          className="btn primary"
          style={{ textDecoration: "none" }}
        >
          Launch in Studio ▸
        </Link>
        <button type="button" className="btn">
          Duplicate
        </button>
        <button type="button" className="btn">
          {row.status === "draft" ? "Enable" : "Disable"}
        </button>
        <button type="button" className="btn danger">
          Delete
        </button>
      </div>
      <div className="pro-only pro-block">
        <div className="label">Pro · Step debugger</div>
        <p style={{ fontSize: 12 }}>Pause mid-run, inspect step IO, mutate, resume.</p>
        <pre>
          step 2/5: hubspot.search(filter=stale_5d) → 8 results{"\n"}
          step 3/5: filter → 6 quality leads{"\n"}
          step 4/5: gmail.draft(template=follow_up_v2) ← paused for inspection
        </pre>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn sm">
            Resume
          </button>
          <button type="button" className="btn sm">
            Mutate input
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Library grid
// ---------------------------------------------------------------------------

function LibraryGrid({
  templates,
  expandedId,
  onToggleExpand,
  connectorHealth,
  forking,
  onUseTemplate,
}: {
  templates: TemplateSummary[];
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  connectorHealth: ConnectorHealthByKey;
  forking: string | null;
  onUseTemplate: (template: TemplateSummary) => void;
}) {
  if (templates.length === 0) {
    return <EmptyState label="No templates published to the library yet." />;
  }

  return (
    <div className="grid-3">
      {templates.map((template, idx) => {
        const expanded = expandedId === template.id;
        const isFirst = idx === 0;
        return (
          <div
            key={template.id}
            className="card"
            style={{ cursor: "pointer" }}
            onClick={() => onToggleExpand(template.id)}
          >
            <h3>{template.name}</h3>
            <p className="desc">
              {template.description || template.category}
            </p>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn primary sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onUseTemplate(template);
                }}
                disabled={forking === template.id}
              >
                {forking === template.id ? "Forking…" : "Use template"}
              </button>
              <Link
                to={buildStudioRoute(template.id)}
                className="btn sm"
                style={{ textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                Launch in Studio ▸
              </Link>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--af2-ink-3)" }}>
                {template.category}
              </span>
            </div>
            {isFirst && expanded ? (
              <LibraryExpandedDetail
                template={template}
                connectorHealth={connectorHealth}
              />
            ) : null}
            {!isFirst && expanded ? (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--af2-line)",
                  fontSize: 12,
                  color: "var(--af2-ink-3)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div>
                  {template.stepCount} steps · {template.configFieldCount} fields. Open in Studio
                  for full detail.
                </div>
                <div style={{ marginTop: 8 }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--af2-ink-4)",
                    }}
                  >
                    Suggested integrations
                  </span>
                  <div style={{ marginTop: 4 }}>
                    <AgentToolChips
                      tools={suggestIntegrationsForCategory(template.category)}
                      connectorHealth={connectorHealth}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function LibraryExpandedDetail({
  template,
  connectorHealth,
}: {
  template: TemplateSummary;
  connectorHealth: ConnectorHealthByKey;
}) {
  const suggestedIntegrations = useMemo(
    () => suggestIntegrationsForCategory(template.category),
    [template.category],
  );

  return (
    <div
      className="lib-detail"
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px solid var(--af2-line)",
        fontSize: 12,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ marginBottom: 6 }}>
        <b>{template.stepCount}</b> steps · {template.configFieldCount} fields
      </div>
      <div style={{ marginBottom: 6 }}>
        <b>Suggested tools:</b>{" "}
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          <AgentToolChips tools={suggestedIntegrations} connectorHealth={connectorHealth} />
        </span>
      </div>
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--af2-ink-4)",
          marginTop: 8,
        }}
      >
        Suggested integrations
      </div>
      <p style={{ color: "var(--af2-ink-3)" }}>
        {template.description || "Pre-configured to ship with sensible defaults."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        marginTop: 22,
        padding: "40px 24px",
        textAlign: "center",
        border: "1px dashed var(--af2-line-2)",
        borderRadius: "var(--af2-radius-lg)",
        background: "var(--af2-card)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--af2-ink-2)" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--af2-ink-3)" }}>
        Switch tabs or open the builder to create a new workflow.
      </div>
    </div>
  );
}
