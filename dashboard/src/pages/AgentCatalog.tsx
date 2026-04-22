import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, ChevronRight, Search, Tag } from "lucide-react";
import { listAgentTemplates } from "../data/agentMarketplaceData";

const ALL_CATEGORY = "All";
const MARKETPLACE_ENABLED = true;

function TileArtwork({ templateId, name }: { templateId: string; name: string }) {
  const [showFallback, setShowFallback] = useState(false);

  if (showFallback) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-100">
        <div className="flex flex-col items-center gap-2 text-center">
          <Bot size={28} />
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
            Marketplace Skill
          </span>
        </div>
      </div>
    );
  }

  return (
    <img
      src={`/marketplace/${templateId}.svg`}
      alt={name}
      className="h-full w-full object-cover"
      loading="lazy"
      onError={() => setShowFallback(true)}
    />
  );
}

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

  if (!MARKETPLACE_ENABLED) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <Bot size={48} className="text-gray-300 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Marketplace Coming Soon</h2>
        <p className="text-gray-500 mt-2 max-w-sm">
          We are currently populating our catalog with 22+ enterprise-grade skills. Check back soon!
        </p>
      </div>
    );
  }

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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => (
            <article
              key={template.id}
              className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-200 hover:-translate-y-1 flex flex-col"
            >
              <div className="aspect-video bg-slate-900 flex items-center justify-center relative overflow-hidden">
                <TileArtwork templateId={template.id} name={template.name} />
                <div className="absolute top-3 right-3">
                  <span className="rounded-full bg-blue-50/90 backdrop-blur-sm text-blue-700 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border border-blue-100">
                    {template.pricingTier}
                  </span>
                </div>
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h2 className="text-lg font-bold text-gray-900 leading-tight">{template.name}</h2>
                </div>
                
                <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                  <Tag size={10} />
                  {template.category}
                </p>

                <p className="text-sm text-gray-600 leading-relaxed line-clamp-3 mb-4 flex-1">
                  {template.description}
                </p>

                <div className="pt-4 border-t border-gray-100 flex items-center justify-between mt-auto">
                  <p className="text-sm font-semibold text-gray-900">${template.monthlyPriceUsd}<span className="text-gray-500 font-normal">/mo</span></p>
                  <Link
                    to={`/agents/${template.id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Details
                    <ChevronRight size={14} />
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="py-24 text-center text-gray-400">
            <Bot size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium text-gray-900">No matches found</p>
            <p className="text-sm mt-1">Try adjusting your search or filters</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
