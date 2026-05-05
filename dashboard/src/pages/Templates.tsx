import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Layers3, Search } from "lucide-react";
import { listTemplates, type TemplateSummary } from "../api/client";
import { ErrorState, LoadingState } from "../components/UiStates";

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
      <div className="p-8">
        <LoadingState label="Loading workflow templates..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState title="Templates unavailable" message={error} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Workflow Templates</h1>
            <p className="mt-1 text-sm text-gray-500">
              Start from a live workflow template, then open it in the builder to customize and deploy.
            </p>
          </div>
          <Link
            to="/builder"
            className="inline-flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Open Builder
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mt-6 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-2xl border border-gray-200 pl-9 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder="Search templates..."
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((option) => (
                <button
                  key={option}
                  onClick={() => setCategory(option)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    category === option
                      ? "bg-slate-900 text-white"
                      : "border border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => (
            <article key={template.id} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{template.name}</h2>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                    {template.category}
                  </p>
                </div>
                <div className="rounded-2xl bg-brand-50 p-2 text-brand-600">
                  <Layers3 size={16} />
                </div>
              </div>

              <p className="mt-4 min-h-[3rem] text-sm leading-6 text-gray-600">
                {template.description || "No description provided for this template yet."}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Version</p>
                  <p className="mt-1 font-medium text-gray-700">{template.version}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Template ID</p>
                  <p className="mt-1 truncate font-mono text-xs text-gray-600">{template.id}</p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <Link
                  to={`/builder/${template.id}`}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
                >
                  Open in builder
                  <ArrowRight size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
            <p className="text-sm font-medium text-gray-600">No templates match this filter.</p>
            <p className="mt-2 text-xs text-gray-400">Try a different category or open the builder to create a new workflow.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
