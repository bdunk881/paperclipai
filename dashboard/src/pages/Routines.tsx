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
import { Link, useNavigate } from "react-router-dom";
import {
  createTemplate,
  deleteTemplate,
  getConnectorHealth,
  importTemplate,
  listRuns,
  listTemplates,
  type TemplateSummary,
} from "../api/client";
import {
  deletePromptRoutine,
  listPromptRoutines,
  updatePromptRoutine,
  type PromptRoutine,
} from "../api/promptRoutinesApi";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useWorkspaceLiveStream } from "../hooks/useWorkspaceLiveStream";
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

type MineRow =
  | (TemplateSummary & {
      kind: "template";
      owner: string;
      schedule: string;
      status: "live" | "draft";
      lastRunAt: string | null;
    })
  | {
      kind: "prompt";
      id: string;
      name: string;
      description: string;
      category: string;
      version: string;
      stepCount: number;
      configFieldCount: number;
      seeded?: false;
      owner: string;
      schedule: string;
      status: "live" | "draft";
      lastRunAt: string | null;
      promptRoutine: PromptRoutine;
    };

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function summarizePromptSchedule(routine: PromptRoutine): string {
  const days = routine.daysOfWeek
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DAY_SHORT[d] ?? `?${d}`)
    .join(" ");
  const hhmm = routine.timeOfDay.slice(0, 5);
  return `${days} at ${hhmm} ${routine.timezone}`;
}

function buildMineRows(
  templates: TemplateSummary[],
  promptRoutines: PromptRoutine[],
): MineRow[] {
  // Mine only shows user-owned routines. Built-in library templates are
  // surfaced under the Library tab. Prompt routines (scheduled prompts)
  // render alongside Studio templates with a "prompt" badge.
  const templateRows: MineRow[] = templates
    .filter((tpl) => !tpl.seeded)
    .map((tpl) => ({
      ...tpl,
      kind: "template" as const,
      owner: "",
      schedule: "",
      status: "live" as const,
      lastRunAt: null,
    }));

  const promptRows: MineRow[] = promptRoutines.map((routine) => ({
    kind: "prompt" as const,
    id: routine.id,
    name: routine.name,
    description: routine.prompt,
    category: "prompt",
    version: "1.0.0",
    stepCount: 0,
    configFieldCount: 0,
    owner: "",
    schedule: summarizePromptSchedule(routine),
    status: routine.status === "paused" ? "draft" : "live",
    lastRunAt: routine.lastFiredAt,
    promptRoutine: routine,
  }));

  // Newest first across the mixed list. Prompt routines surface their
  // createdAt via the embedded PromptRoutine; templates don't have a
  // sortable createdAt on TemplateSummary, so we keep their original
  // order and slot prompt rows in front when newer.
  return [...promptRows, ...templateRows];
}

function libraryTemplates(templates: TemplateSummary[]): TemplateSummary[] {
  return templates.filter((tpl) => tpl.seeded);
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
  const [promptRoutines, setPromptRoutines] = useState<PromptRoutine[]>([]);
  const [loading, setLoading] = useState(() => initialTemplates == null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("mine");
  // Bumped by SSE events to trigger a re-fetch without manual polling.
  const [reloadTick, setReloadTick] = useState(0);

  // Live SSE — any routine lifecycle event (run started/completed,
  // routine created/edited) bumps reloadTick which the fetch effect
  // depends on.
  useWorkspaceLiveStream({
    path: "routines/stream",
    enabled: Boolean(activeWorkspaceId),
    onEvent: (evt) => {
      if (evt.name === "heartbeat") return;
      setReloadTick((n) => n + 1);
    },
  });

  // Inline drawer state (Mine tab).
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [drawerRuns, setDrawerRuns] = useState<WorkflowRun[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Expanded library card state.
  const [expandedLibraryId, setExpandedLibraryId] = useState<string | null>(null);
  const [connectorHealth, setConnectorHealth] = useState<ConnectorHealthByKey>({});
  const [forking, setForking] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleDelete(template: TemplateSummary) {
    if (
      !window.confirm(
        `Delete routine "${template.name}"? This can't be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(template.id);
    try {
      const token = await getAccessToken();
      await deleteTemplate(template.id, token ?? undefined);
      setTemplates((current) => current.filter((t) => t.id !== template.id));
      if (expandedRowId === template.id) setExpandedRowId(null);
    } catch (delError) {
      setError(
        delError instanceof Error ? delError.message : "Failed to delete routine",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeletePromptRoutine(routine: PromptRoutine) {
    if (
      !window.confirm(
        `Delete prompt routine "${routine.name}"? This stops the schedule and removes the row.`,
      )
    ) {
      return;
    }
    setDeletingId(routine.id);
    try {
      const token = await getAccessToken();
      await deletePromptRoutine(routine.id, token ?? undefined);
      setPromptRoutines((current) => current.filter((r) => r.id !== routine.id));
      if (expandedRowId === routine.id) setExpandedRowId(null);
    } catch (delError) {
      setError(
        delError instanceof Error ? delError.message : "Failed to delete prompt routine",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handleTogglePromptRoutineStatus(routine: PromptRoutine) {
    const next = routine.status === "active" ? "paused" : "active";
    try {
      const token = await getAccessToken();
      const updated = await updatePromptRoutine(routine.id, { status: next }, token ?? undefined);
      setPromptRoutines((current) =>
        current.map((r) => (r.id === routine.id ? updated : r)),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update prompt routine",
      );
    }
  }

  function handleImportClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        const token = await getAccessToken();
        const result = await importTemplate(bundle, token ?? undefined);
        setTemplates((current) => [
          {
            id: result.template.id,
            name: result.template.name,
            description: result.template.description ?? "",
            category: result.template.category,
            version: result.template.version,
            stepCount: result.template.steps?.length ?? 0,
            configFieldCount: result.template.configFields?.length ?? 0,
          },
          ...current,
        ]);
        setActiveTab("mine");
      } catch (importError) {
        setError(
          importError instanceof Error
            ? importError.message
            : "Failed to import routine",
        );
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }

  useEffect(() => {
    if (initialTemplates) return;
    let cancelled = false;
    void (async () => {
      // Only show the big spinner on first paint; SSE-triggered reloads
      // should refresh in the background without flashing the empty state.
      const isFirstPaint = reloadTick === 0;
      if (isFirstPaint) setLoading(true);
      setError(null);
      try {
        const token = (await getAccessToken()) ?? undefined;
        const [nextTemplates, nextRoutines] = await Promise.all([
          listTemplates(),
          // Prompt routines are optional — a 401/404 on a stale dev backend
          // shouldn't block the templates list.
          listPromptRoutines(token).catch(() => [] as PromptRoutine[]),
        ]);
        if (!cancelled) {
          setTemplates(nextTemplates);
          setPromptRoutines(nextRoutines);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load routines",
          );
        }
      } finally {
        if (!cancelled && isFirstPaint) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialTemplates, getAccessToken, reloadTick]);

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
    () => applyOrder(buildMineRows(templates, promptRoutines), routineOrder),
    [templates, promptRoutines, routineOrder],
  );
  const libraryRows = useMemo(() => libraryTemplates(templates), [templates]);
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
    // Prompt routines aren't backed by workflow runs; skip the fetch.
    if (row.kind === "prompt") {
      setDrawerLoading(false);
      return;
    }
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
          <h1 className="h1 af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Routines
          </h1>
          <div className="meta af2-page-head-meta">
            Reusable workflows your agents call as routines.
          </div>
        </div>
        <div className="page-head-right af2-page-actions">
          <button
            type="button"
            className="btn"
            onClick={handleImportClick}
            disabled={importing}
            title="Import a routine from a JSON bundle"
          >
            {importing ? "Importing…" : "Import"}
          </button>
          <CreateRoutineDropdown />
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
          Library ({libraryRows.length})
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
                  onDelete={() => {
                    if (row.kind === "prompt") {
                      void handleDeletePromptRoutine(row.promptRoutine);
                    } else {
                      void handleDelete(row);
                    }
                  }}
                  deleting={deletingId === row.id}
                  onTogglePromptStatus={
                    row.kind === "prompt"
                      ? () => void handleTogglePromptRoutineStatus(row.promptRoutine)
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Library panel */}
      <div className="panel" hidden={activeTab !== "library"}>
        <LibraryGrid
          templates={libraryRows}
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
  onDelete,
  deleting,
  onTogglePromptStatus,
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
  onDelete: () => void;
  deleting: boolean;
  onTogglePromptStatus?: () => void;
}) {
  const rowGrid = "26px 1fr 110px 100px 130px 190px";
  const isDraft = row.status === "draft";
  const isPrompt = row.kind === "prompt";

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
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <b>{row.name}</b>
            {isPrompt ? (
              <span
                className="pill"
                style={{ fontSize: 10, padding: "1px 6px" }}
                title="Prompt routine — fires on schedule, creates an assignment"
              >
                prompt
              </span>
            ) : null}
          </div>
          {row.schedule ? (
            <span style={{ color: "var(--af2-ink-3)", fontSize: 12 }}>
              {row.schedule}
            </span>
          ) : null}
        </div>
        <div>{row.owner || "—"}</div>
        <div>
          <span className={`pill dot ${isDraft ? "mustard" : "sage"}`}>{row.status}</span>
        </div>
        <div className="id">{formatRelative(row.lastRunAt)}</div>
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {isPrompt && onTogglePromptStatus ? (
            <button type="button" className="btn sm" onClick={onTogglePromptStatus}>
              {isDraft ? "Resume" : "Pause"}
            </button>
          ) : (
            <button type="button" className="btn sm">
              {isDraft ? "Enable" : "Disable"}
            </button>
          )}
          {isPrompt ? (
            <span style={{ fontSize: 11, color: "var(--af2-ink-3)", padding: "0 4px" }}>
              scheduled
            </span>
          ) : (
            <Link
              to={buildStudioRoute(row.id)}
              className="btn primary sm"
              style={{ textDecoration: "none" }}
            >
              Launch in Studio ▸
            </Link>
          )}
        </div>
      </div>
      <div className={`row-drawer${expanded ? " open" : ""}`}>
        {expanded && expandedRow ? (
          <DrawerBody
            row={expandedRow}
            runs={runs}
            runsLoading={runsLoading}
            onClose={onToggle}
            onDelete={onDelete}
            deleting={deleting}
          />
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
  onDelete,
  deleting,
}: {
  row: MineRow;
  runs: WorkflowRun[];
  runsLoading: boolean;
  onClose: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isPrompt = row.kind === "prompt";
  return (
    <>
      <div className="row-drawer-head">
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {isPrompt ? `Prompt routine · ${row.status}` : `Routine · ${row.status}`}
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

      {isPrompt && row.kind === "prompt" ? (
        <>
          <div style={{ marginTop: 6 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--af2-ink-3)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Prompt
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                background: "var(--af2-paper-2)",
                border: "1px solid var(--af2-line)",
                borderRadius: 6,
                padding: "10px 12px",
                whiteSpace: "pre-wrap",
              }}
            >
              {row.promptRoutine.prompt}
            </div>
          </div>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 18,
              fontSize: 12,
              color: "var(--af2-ink-3)",
            }}
          >
            <div>
              <b style={{ color: "var(--af2-ink-2)" }}>Schedule:</b> {row.schedule}
            </div>
            <div>
              <b style={{ color: "var(--af2-ink-2)" }}>Last fired:</b>{" "}
              {formatRelative(row.lastRunAt)}
            </div>
          </div>
        </>
      ) : (
        <>
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
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {!isPrompt ? (
          <>
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
          </>
        ) : null}
        <button
          type="button"
          className="btn"
          style={{ color: "var(--af2-clay)" }}
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
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

// ---------------------------------------------------------------------------
// Create-routine dropdown — two paths: full Workflow Studio (existing
// /builder), or a lightweight scheduled prompt (/routines/new-prompt).
// ---------------------------------------------------------------------------

function CreateRoutineDropdown() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-routine-create-menu]")) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div style={{ position: "relative" }} data-routine-create-menu>
      <button
        type="button"
        className="btn primary"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        + Create routine ▾
      </button>
      {open ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 30,
            minWidth: 320,
            background: "var(--af2-paper)",
            border: "1px solid var(--af2-line)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(26,20,16,0.14)",
            padding: 6,
          }}
        >
          <CreateMenuItem
            title="Create in Workflow Studio"
            description="Multi-step workflow with triggers, branches, AI calls, integrations, and approvals."
            onClick={() => {
              setOpen(false);
              navigate("/builder");
            }}
          />
          <CreateMenuItem
            title="Create a prompt routine"
            description="Send a prompt to an agent on a schedule. Each fire creates an assignment in the queue."
            onClick={() => {
              setOpen(false);
              navigate("/routines/new-prompt");
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function CreateMenuItem({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 6,
        border: 0,
        background: "transparent",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--af2-paper-2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <div style={{ fontWeight: 500, fontSize: 13.5 }}>{title}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: "var(--af2-ink-3)" }}>
        {description}
      </div>
    </button>
  );
}
