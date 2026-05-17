import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTemplates, type TemplateSummary } from "../api/client";
import { ErrorState, LoadingState } from "../components/UiStates";

/**
 * Library (Templates) page — HEL-65 v2 restyle.
 *
 * Matches `docs/design/v2/pages-extra.jsx::AF2_Library` — `af2-page` chrome
 * with eyebrow "Build · Routines", serif h1 "Library", two action buttons,
 * an `af2-tabs` strip with All/Mine/Shared/Templates, and a 2-col `af2-card`
 * grid where each card shows routine name, live/draft pill, description,
 * secondary metadata, and an "Open in Studio" CTA.
 *
 * Real data deltas vs. the v2 mockup:
 * - `TemplateSummary` has no `live` flag → every listed template renders as "live".
 * - No `uses` (run-count) field → show `{stepCount} steps · {configFieldCount} fields`.
 * - No `owner` field → show category as the secondary text.
 * - No ownership/sharing signal → "Mine" and "Shared" tabs render empty for now;
 *   "Templates" is an alias for "All".
 */

type TabKey = "all" | "mine" | "shared" | "templates";

const TAB_DEFS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "shared", label: "Shared" },
  { key: "templates", label: "Templates" },
];

function filterByTab(templates: TemplateSummary[], tab: TabKey): TemplateSummary[] {
  switch (tab) {
    case "mine":
    case "shared":
      // TemplateSummary carries no ownership or sharing signal yet.
      return [];
    case "all":
    case "templates":
    default:
      return templates;
  }
}

export default function Templates({
  initialTemplates,
}: {
  initialTemplates?: TemplateSummary[];
} = {}) {
  const [templates, setTemplates] = useState<TemplateSummary[]>(() => initialTemplates ?? []);
  const [loading, setLoading] = useState(() => initialTemplates == null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

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
          setError(loadError instanceof Error ? loadError.message : "Failed to load templates");
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

  if (loading) {
    return (
      <div className="af2-page">
        <LoadingState label="Loading workflow templates..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page">
        <ErrorState title="Templates unavailable" message={error} />
      </div>
    );
  }

  const totalCount = templates.length;
  const filtered = filterByTab(templates, activeTab);

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Build · Routines</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Library
          </h1>
          <div className="af2-page-head-meta">
            Reusable workflows your agents call as routines. Like functions, but with judgment.
          </div>
        </div>
        {/* DASH-6/7: "Browse templates" was redundant — this whole
            page IS the template browser. "+New routine" used to drop
            users straight into Studio (the WorkflowBuilder canvas) on
            click, which surprised SMB owners expecting a template
            picker. Renamed to "Blank routine →" so the action
            advertises what it actually does. Picking an existing
            template from the list below is the recommended path. */}
        <div className="af2-page-actions">
          <Link
            to="/builder"
            className="af2-btn af2-btn-clay"
            style={{ textDecoration: "none" }}
            title="Open a blank Studio canvas. To start from a template, pick one from the list below."
          >
            Blank routine →
          </Link>
        </div>
      </div>

      <div className="af2-tabs">
        {TAB_DEFS.map(({ key, label }) => {
          const displayLabel = key === "all" ? `All (${totalCount})` : label;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`af2-tab${activeTab === key ? " active" : ""}`}
            >
              {displayLabel}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 14,
        }}
      >
        {filtered.map((template) => (
          <div key={template.id} className="af2-card" style={{ padding: 18 }}>
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
              style={{
                fontSize: 12.5,
                marginTop: 6,
                lineHeight: 1.5,
              }}
            >
              {template.description || "No description provided for this template yet."}
            </div>

            <div className="af2-row" style={{ marginTop: 14, gap: 10 }}>
              <span className="af2-muted" style={{ fontSize: 12 }}>
                {template.category}
              </span>
              <span className="af2-spacer" />
              <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                {template.stepCount} steps · {template.configFieldCount} fields
              </span>
              <Link
                to={`/templates/${template.id}`}
                className="af2-btn af2-btn-sm"
                style={{ textDecoration: "none" }}
              >
                Open in Studio
              </Link>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
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
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--af2-ink-2)" }}>
            No routines to show here yet.
          </div>
          <div className="af2-muted" style={{ marginTop: 6, fontSize: 12 }}>
            Switch tabs or open the builder to create a new workflow.
          </div>
        </div>
      ) : null}
    </div>
  );
}
