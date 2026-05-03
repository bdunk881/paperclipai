import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, ChevronRight, Search, Tag } from "lucide-react";
import { listAgentCatalogTemplates, type AgentCatalogTemplate } from "../api/agentCatalog";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

const ALL_CATEGORY = "All";

export default function AgentCatalog() {
  const { getAccessToken } = useAuth();
  const [templates, setTemplates] = useState<AgentCatalogTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error("Authentication session expired.");
        }
        const nextTemplates = await listAgentCatalogTemplates(accessToken);
        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load agent templates");
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
  }, [getAccessToken]);

  const categories = useMemo(
    () => [ALL_CATEGORY, ...Array.from(new Set(templates.map((template) => template.category))).sort()],
    [templates]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((template) => {
      const categoryMatch = category === ALL_CATEGORY || template.category === category;
      const searchMatch =
        q.length === 0 ||
        template.name.toLowerCase().includes(q) ||
        template.description.toLowerCase().includes(q) ||
        template.skills.some((skill) => skill.toLowerCase().includes(q));
      return categoryMatch && searchMatch;
    });
  }, [category, search, templates]);

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading agent templates..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState title="Agent catalog unavailable" message={error} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-8 py-6">
        <h1 className="text-2xl font-bold text-gray-900">Agent Catalog</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse and deploy prebuilt agent templates by function and team.
        </p>

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative w-full md:max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search agent templates..."
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {categories.map((option) => (
              <button
                key={option}
                onClick={() => setCategory(option)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  category === option
                    ? "bg-gray-900 text-white"
                    : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-8 py-6">
        {templates.length === 0 ? (
          <EmptyState
            title="No agent templates available"
            description="Your workspace does not have any role templates published to the catalog yet."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((template) => (
              <article
                key={template.id}
                className="rounded-xl border border-gray-200 bg-white p-5 transition hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{template.name}</h2>
                    <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                      <Tag size={12} />
                      {template.category}
                    </p>
                  </div>
                  {template.pricingTier ? (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {template.pricingTier}
                    </span>
                  ) : null}
                </div>

                <p className="mt-3 text-sm leading-relaxed text-gray-600">{template.description}</p>

                <ul className="mt-4 space-y-1.5">
                  {template.skills.slice(0, 3).map((skill) => (
                    <li key={skill} className="flex items-start gap-2 text-sm text-gray-700">
                      <Bot size={14} className="mt-0.5 text-gray-400" />
                      <span>{skill}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-500">
                    {template.skills.length} skill{template.skills.length === 1 ? "" : "s"}
                  </p>
                  <Link
                    to={`/agents/${template.id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    View details
                    <ChevronRight size={14} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}

        {!loading && templates.length > 0 && filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Bot size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No agent templates match this filter.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
