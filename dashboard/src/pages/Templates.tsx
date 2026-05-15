import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Search } from "lucide-react";
import { listTemplates, type TemplateSummary } from "../api/client";
import { ErrorState, LoadingState } from "../components/UiStates";

/**
 * Library (Templates) page — HEL-65 v2 restyle.
 *
 * v2 reference: `docs/design/v2/pages-extra.jsx::AF2_Library` — `af2-page`
 * chrome with eyebrow "Build · Routines", serif h1, action buttons,
 * `af2-tabs` strip, and a 2-col `af2-card` grid where each card shows
 * routine name + live/draft pill, description, owner avatar, run count,
 * and "Open in Studio" CTA.
 *
 * The route is `/templates`; the dashboard's four-pillar IA labels this
 * "Library" under the Build pillar. AgentCatalog.tsx surfaces the Hire
 * destination separately so this page can stay routine-focused.
 */

const ALL_CATEGORY = "All";

export default function Templates({
  initialTemplates,
}: {
  initialTemplates?: TemplateSummary[];
} = {}) {
  const [templates, setTemplates] = useState<TemplateSummary[]>(() => initialTemplates ?? []);
  const [loading, setLoading] = useState(() => initialTemplates == null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);

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

  const categories = useMemo(
    () => [ALL_CATEGORY, ...Array.from(new Set(templates.map((template) => template.category))).sort()],
    [templates]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return templates.filter((template) => {
      const categoryMatch = category === ALL_CATEGORY || template.category === category;
      const queryMatch =
        normalizedQuery.length === 0 ||
        template.name.toLowerCase().includes(normalizedQuery) ||
        template.description.toLowerCase().includes(normalizedQuery) ||
        template.category.toLowerCase().includes(normalizedQuery);

      return categoryMatch && queryMatch;
    });
  }, [category, query, templates]);

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
        <div className="af2-page-actions">
          <Link
            to="/builder"
            className="af2-btn af2-btn-clay"
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ＋ New routine
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="af2-tabs">
        {categories.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCategory(option)}
            className={`af2-tab${category === option ? " active" : ""}`}
          >
            {option}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            position: "relative",
            flex: 1,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 12,
              color: "var(--af2-ink-4)",
              pointerEvents: "none",
            }}
          />
          <input
            className="af2-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ width: "100%", paddingLeft: 32 }}
            placeholder="Search templates..."
          />
        </div>
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

            <div className="af2-eyebrow" style={{ marginTop: 8 }}>
              {template.category}
            </div>

            <div
              className="af2-muted"
              style={{
                fontSize: 12.5,
                marginTop: 8,
                lineHeight: 1.5,
                minHeight: "3rem",
              }}
            >
              {template.description || "No description provided for this template yet."}
            </div>

            <div
              className="af2-row"
              style={{
                marginTop: 14,
                gap: 10,
                paddingTop: 14,
                borderTop: "1px solid var(--af2-line)",
              }}
            >
              <span
                className="af2-mono af2-muted-2"
                style={{ fontSize: 11 }}
              >
                v{template.version} · {template.stepCount} steps
              </span>
              <span className="af2-spacer" />
              <Link
                to={`/builder/${template.id}`}
                className="af2-btn af2-btn-sm"
                style={{
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Open in Studio
                <ArrowRight size={12} />
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
            No templates match this filter.
          </div>
          <div
            className="af2-muted"
            style={{ marginTop: 6, fontSize: 12 }}
          >
            Try a different category or open the builder to create a new workflow.
          </div>
        </div>
      ) : null}
    </div>
  );
}
