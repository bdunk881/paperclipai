import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, ChevronRight, Search, Tag } from "lucide-react";
import { listAgentTemplates } from "../data/agentMarketplaceData";

const ALL_CATEGORY = "All";

export default function AgentCatalog() {
  const templates = listAgentTemplates();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);

  const categories = useMemo(
    () => [ALL_CATEGORY, ...Array.from(new Set(templates.map((t) => t.category))).sort()],
    [templates]
  );

  const filtered = templates.filter((template) => {
    const q = search.trim().toLowerCase();
    const categoryMatch = category === ALL_CATEGORY || template.category === category;
    const searchMatch =
      q.length === 0 ||
      template.name.toLowerCase().includes(q) ||
      template.description.toLowerCase().includes(q) ||
      template.capabilities.some((capability) => capability.toLowerCase().includes(q));
    return categoryMatch && searchMatch;
  });

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-gray-900">Agent Marketplace</h1>
        <p className="text-sm text-gray-500 mt-1">
          Browse and deploy prebuilt agent templates by function and team.
        </p>

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative w-full md:max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search agent templates..."
              className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-8 py-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => (
            <article
              key={template.id}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  {template.tileIcon ? (
                    <div className="w-12 h-12 mb-4 rounded-lg bg-gray-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <img
                        src={new URL(`../assets/marketplace/${template.tileIcon}`, import.meta.url).href}
                        alt=""
                        className="w-10 h-10 object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 mb-4 rounded-lg bg-gray-50 flex items-center justify-center">
                      <Bot size={24} className="text-gray-400" />
                    </div>
                  )}
                  <h2 className="font-semibold text-gray-900 text-lg">{template.name}</h2>
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    <Tag size={12} />
                    {template.category}
                  </p>
                </div>
                <span className="rounded-full bg-brand-50 text-brand-700 px-2.5 py-0.5 text-xs font-semibold">
                  {template.pricingTier}
                </span>
              </div>

              <p className="mt-3 text-sm text-gray-600 leading-relaxed">{template.description}</p>

              <ul className="mt-4 space-y-1.5">
                {template.capabilities.slice(0, 3).map((capability) => (
                  <li key={capability} className="text-sm text-gray-700 flex items-start gap-2">
                    <Bot size={14} className="mt-0.5 text-gray-400" />
                    <span>{capability}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
                <p className="text-sm text-gray-500">${template.monthlyPriceUsd}/mo</p>
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

        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Bot size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No agent templates match this filter.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
