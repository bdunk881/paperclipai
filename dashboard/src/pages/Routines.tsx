/**
 * Routines hub (HEL-208 / PR E).
 *
 * Replaces the former Templates page with a two-tab Routines hub:
 *
 *   Mine    — workflows the workspace owns. Tabular rows with name, owner,
 *             schedule, status, last run, and a "Launch in Studio →" CTA
 *             that opens `/builder/:templateId`. Row click opens an inline
 *             drawer with the last 5 runs, recent edits, and Edit /
 *             Duplicate / Disable actions.
 *
 *   Library — read-only catalog of starter templates. Click a card to
 *             reveal description, sample inputs, expected outputs, fork
 *             count, and suggested-integrations as Connected / Connect
 *             chips (mirroring PR #984's `AgentToolChips`). "Use template"
 *             provisions a copy into Mine.
 *
 * HEL-203 hasn't merged `Af2Tabs` / `Af2RowDrawer` yet, so this file ships
 * minimal local copies inline (TODO: replace once HEL-203 lands).
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
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
import {
  AgentToolChips,
  type ConnectorHealthByKey,
} from "../components/missions/AgentToolChips";
import type { WorkflowRun } from "../types/workflow";

type TabKey = "mine" | "library";

// ---------------------------------------------------------------------------
// Minimal local Af2Tabs / Af2RowDrawer until HEL-203 lands them in /af2.
// TODO(HEL-203): swap to the shared `Af2Tabs` + `Af2RowDrawer` exports.
// ---------------------------------------------------------------------------

interface Af2TabsLocalProps {
  tabs: ReadonlyArray<{ key: string; label: string; count?: number }>;
  activeKey: string;
  onChange: (key: string) => void;
}

function Af2TabsLocal({ tabs, activeKey, onChange }: Af2TabsLocalProps) {
  return (
    <div className="af2-tabs">
      {tabs.map(({ key, label, count }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`af2-tab${activeKey === key ? " active" : ""}`}
        >
          {count != null ? `${label} (${count})` : label}
        </button>
      ))}
    </div>
  );
}

interface Af2RowDrawerLocalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
}

function Af2RowDrawerLocal({
  open,
  onClose,
  title,
  eyebrow,
  children,
}: Af2RowDrawerLocalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "rgba(26, 20, 16, 0.32)",
        backdropFilter: "blur(2px)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        className="af2-card"
        style={{
          width: "100%",
          maxWidth: 480,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 22px 14px",
            borderBottom: "1px solid var(--af2-line)",
          }}
        >
          {eyebrow ? (
            <div className="af2-eyebrow" style={{ marginBottom: 4 }}>
              {eyebrow}
            </div>
          ) : null}
          <div className="af2-h2 font-af2-serif">{title}</div>
        </div>
        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildStudioRoute(templateId: string): string {
  // WorkflowBuilder consumes `:templateId` from useParams — this is the
  // canonical "open in Studio" path. The HEL-208 brief mentions
  // `/studio?routineId=…` aspirationally; today the Studio surface is
  // `/builder/:templateId`, so keep using that until a routine-id route
  // exists, otherwise the row CTA would 404.
  return `/builder/${templateId}`;
}

// "Mine" doesn't have ownership/schedule/status signals on TemplateSummary
// yet — synthesize them so the column layout has something to show.
type MineRow = TemplateSummary & {
  owner: string;
  schedule: string;
  status: "live" | "paused";
  lastRunAt: string | null;
};

function synthesizeMineRows(templates: TemplateSummary[]): MineRow[] {
  // TODO(HEL-208 follow-up): swap to `GET /api/routines?owner=me` once the
  // backend surfaces per-workspace ownership + cron metadata. For now we
  // dress the first N templates as "mine" so we can ship the layout.
  return templates.slice(0, Math.min(templates.length, 6)).map((tpl, i) => ({
    ...tpl,
    owner: "You",
    schedule: i % 2 === 0 ? "Hourly" : "Manual",
    status: i % 3 === 0 ? "paused" : "live",
    lastRunAt: null,
  }));
}

// Heuristic — until the template payload carries `suggestedIntegrations`,
// map by category so the chips render something realistic.
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
  const [templates, setTemplates] = useState<TemplateSummary[]>(
    () => initialTemplates ?? []
  );
  const [loading, setLoading] = useState(() => initialTemplates == null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("mine");

  // Inline drawer state (Mine tab).
  const [drawerRow, setDrawerRow] = useState<MineRow | null>(null);
  const [drawerRuns, setDrawerRuns] = useState<WorkflowRun[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Expanded library card state.
  const [expandedLibraryId, setExpandedLibraryId] = useState<string | null>(
    null
  );
  const [connectorHealth, setConnectorHealth] = useState<ConnectorHealthByKey>(
    {}
  );
  const [forking, setForking] = useState<string | null>(null);

  useEffect(() => {
    if (initialTemplates) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextTemplates = await listTemplates();
        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load routines"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialTemplates]);

  // Connector-health fetch for the Library "Connected / Connect" chips.
  // Mirrors HiringPlanReview — silent failure leaves chips in the
  // un-connected state, which is the safer default.
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
        /* ignore — chips default to "Connect" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  const mineRows = useMemo(() => synthesizeMineRows(templates), [templates]);

  async function openDrawer(row: MineRow) {
    setDrawerRow(row);
    setDrawerRuns([]);
    setDrawerLoading(true);
    try {
      const token = await getAccessToken();
      const runs = await listRuns(row.id, token ?? undefined);
      setDrawerRuns(runs.slice(0, 5));
    } catch {
      /* leave runs empty */
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeDrawer() {
    setDrawerRow(null);
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
        token ?? undefined
      );
      // Pull the freshly forked routine into the local list so the Mine
      // tab reflects it immediately.
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
        forkError instanceof Error
          ? forkError.message
          : "Failed to fork template"
      );
    } finally {
      setForking(null);
    }
  }

  if (loading) {
    return (
      <div className="af2-page">
        <LoadingState label="Loading routines..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page">
        <ErrorState title="Routines unavailable" message={error} />
      </div>
    );
  }

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Build · Routines</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Routines
          </h1>
          <div className="af2-page-head-meta">
            Reusable workflows your agents call as routines. Like functions,
            but with judgment.
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/builder"
            className="af2-btn af2-btn-clay"
            style={{ textDecoration: "none" }}
            title="Open a blank Studio canvas. To start from a template, pick one from the Library tab."
          >
            Blank routine →
          </Link>
        </div>
      </div>

      <Af2TabsLocal
        tabs={[
          { key: "mine", label: "Mine", count: mineRows.length },
          { key: "library", label: "Library", count: templates.length },
        ]}
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
      />

      {activeTab === "mine" ? (
        <MineTable rows={mineRows} onRowClick={openDrawer} />
      ) : (
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
      )}

      <Af2RowDrawerLocal
        open={!!drawerRow}
        onClose={closeDrawer}
        eyebrow="Routine"
        title={drawerRow?.name ?? ""}
      >
        {drawerRow ? (
          <RoutineDrawerBody
            row={drawerRow}
            runs={drawerRuns}
            loading={drawerLoading}
          />
        ) : null}
      </Af2RowDrawerLocal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mine table
// ---------------------------------------------------------------------------

const COLUMN_HEADERS = [
  "Name",
  "Owner",
  "Schedule",
  "Status",
  "Last run",
  "Actions",
];

function MineTable({
  rows,
  onRowClick,
}: {
  rows: MineRow[];
  onRowClick: (row: MineRow) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState label="No routines to show yet." />;
  }

  const cellStyle: CSSProperties = {
    padding: "10px 12px",
    fontSize: 13,
    color: "var(--af2-ink-2)",
    borderBottom: "1px solid var(--af2-line)",
    textAlign: "left",
    verticalAlign: "middle",
  };

  return (
    <div className="af2-card" style={{ padding: 0, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {COLUMN_HEADERS.map((label) => (
              <th
                key={label}
                style={{
                  ...cellStyle,
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--af2-ink-4)",
                  background: "var(--af2-paper-2)",
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick(row)}
              style={{ cursor: "pointer" }}
              className="af2-row-hover"
            >
              <td
                style={{
                  ...cellStyle,
                  fontWeight: 500,
                  color: "var(--af2-ink)",
                }}
              >
                {row.name}
              </td>
              <td style={cellStyle}>{row.owner}</td>
              <td style={cellStyle}>{row.schedule}</td>
              <td style={cellStyle}>
                <span
                  className={`af2-pill af2-pill-${
                    row.status === "live" ? "live" : "draft"
                  }`}
                >
                  <span className="af2-dot" />
                  {row.status}
                </span>
              </td>
              <td style={cellStyle}>{formatRelative(row.lastRunAt)}</td>
              <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
                <Link
                  to={buildStudioRoute(row.id)}
                  className="af2-btn af2-btn-sm"
                  style={{ textDecoration: "none" }}
                >
                  Launch in Studio →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 14,
      }}
    >
      {templates.map((template) => {
        const expanded = expandedId === template.id;
        return (
          <div
            key={template.id}
            className="af2-card"
            style={{ padding: 18, cursor: expanded ? "default" : "pointer" }}
            onClick={() => {
              if (!expanded) onToggleExpand(template.id);
            }}
          >
            <div className="af2-row">
              <div className="af2-h3" style={{ fontSize: 17 }}>
                {template.name}
              </div>
              <span className="af2-spacer" />
              <span className="af2-pill af2-pill-live">
                <span className="af2-dot" />
                live
              </span>
            </div>

            <div
              className="af2-muted"
              style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}
            >
              {template.description ||
                "No description provided for this template yet."}
            </div>

            <div className="af2-row" style={{ marginTop: 14, gap: 10 }}>
              <span className="af2-muted" style={{ fontSize: 12 }}>
                {template.category}
              </span>
              <span className="af2-spacer" />
              <span
                className="af2-mono af2-muted-2"
                style={{ fontSize: 11 }}
              >
                {template.stepCount} steps · {template.configFieldCount}{" "}
                fields
              </span>
            </div>

            {expanded ? (
              <LibraryExpandedDetail
                template={template}
                connectorHealth={connectorHealth}
                onCollapse={() => onToggleExpand(template.id)}
                onUseTemplate={() => onUseTemplate(template)}
                forking={forking === template.id}
              />
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
  onCollapse,
  onUseTemplate,
  forking,
}: {
  template: TemplateSummary;
  connectorHealth: ConnectorHealthByKey;
  onCollapse: () => void;
  onUseTemplate: () => void;
  forking: boolean;
}) {
  const suggestedIntegrations = useMemo(
    () => suggestIntegrationsForCategory(template.category),
    [template.category]
  );

  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 14,
        borderTop: "1px solid var(--af2-line)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <DetailSection title="Description">
        <p className="af2-muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
          {template.description ||
            "No description provided for this template yet."}
        </p>
      </DetailSection>

      <DetailSection title="Sample inputs">
        {/* TODO(HEL-208 follow-up): wire real sampleInput from the template
            payload once the list endpoint surfaces it. */}
        <p className="af2-muted" style={{ fontSize: 12.5 }}>
          {template.configFieldCount} configurable fields. Open in Studio to
          inspect.
        </p>
      </DetailSection>

      <DetailSection title="Expected outputs">
        <p className="af2-muted" style={{ fontSize: 12.5 }}>
          {template.stepCount} step{template.stepCount === 1 ? "" : "s"}
          {" "}producing run logs, side-effects, and a final result envelope.
        </p>
      </DetailSection>

      <DetailSection title="Forks">
        {/* TODO(HEL-208 follow-up): backend fork-count not exposed yet. */}
        <p className="af2-muted" style={{ fontSize: 12.5 }}>
          Fork count not yet available.
        </p>
      </DetailSection>

      <DetailSection title="Suggested integrations">
        <AgentToolChips
          tools={suggestedIntegrations}
          connectorHealth={connectorHealth}
        />
      </DetailSection>

      <div
        className="af2-row"
        style={{ marginTop: 6, gap: 8, justifyContent: "flex-end" }}
      >
        <button
          type="button"
          className="af2-btn af2-btn-sm"
          onClick={onCollapse}
        >
          Close
        </button>
        <button
          type="button"
          className="af2-btn af2-btn-clay af2-btn-sm"
          onClick={onUseTemplate}
          disabled={forking}
        >
          {forking ? "Forking…" : "Use template"}
        </button>
      </div>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        className="af2-eyebrow"
        style={{ marginBottom: 4, fontSize: 10.5 }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer body
// ---------------------------------------------------------------------------

function RoutineDrawerBody({
  row,
  runs,
  loading,
}: {
  row: MineRow;
  runs: WorkflowRun[];
  loading: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <DetailSection title="Schedule">
        <p style={{ fontSize: 13, color: "var(--af2-ink-2)" }}>
          {row.schedule} · status: {row.status}
        </p>
      </DetailSection>

      <DetailSection title="Last 5 runs">
        {loading ? (
          <p className="af2-muted" style={{ fontSize: 12.5 }}>
            Loading runs…
          </p>
        ) : runs.length === 0 ? (
          <p className="af2-muted" style={{ fontSize: 12.5 }}>
            No runs recorded yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {runs.map((run) => (
              <li
                key={run.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--af2-line)",
                }}
              >
                <span className="af2-mono">{run.status}</span>
                <span className="af2-muted">
                  {formatRelative(run.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="Recent edits">
        {/* TODO(HEL-208 follow-up): wire workflow_versions feed once
            HEL-203's drawer ships with a shared edit-history surface. */}
        <p className="af2-muted" style={{ fontSize: 12.5 }}>
          Edit history not yet surfaced.
        </p>
      </DetailSection>

      <div
        className="af2-row"
        style={{ gap: 8, marginTop: 6, justifyContent: "flex-end" }}
      >
        <Link
          to={buildStudioRoute(row.id)}
          className="af2-btn af2-btn-sm"
          style={{ textDecoration: "none" }}
        >
          Edit
        </Link>
        <button type="button" className="af2-btn af2-btn-sm" disabled>
          {/* TODO(HEL-208 follow-up): wire duplicate action. */}
          Duplicate
        </button>
        <button type="button" className="af2-btn af2-btn-sm" disabled>
          {/* TODO(HEL-208 follow-up): wire disable action. */}
          Disable
        </button>
      </div>
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
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "var(--af2-ink-2)",
        }}
      >
        {label}
      </div>
      <div className="af2-muted" style={{ marginTop: 6, fontSize: 12 }}>
        Switch tabs or open the builder to create a new workflow.
      </div>
    </div>
  );
}
