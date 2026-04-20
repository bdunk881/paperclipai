import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, PlugZap, Tag, ExternalLink, CheckCircle, Loader2, Wrench } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";

interface LibraryPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: string[];
  official: boolean;
  logoSlug?: string;
  connected: boolean;
}

interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface RegisteredIntegration {
  id: string;
  name: string;
  url: string;
  hasAuth: boolean;
  createdAt: string;
}

interface IntegrationCard {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: string[];
  official: boolean;
  connected: boolean;
  isCustom: boolean;
  logoSlug?: string;
}

const BRAND_ASSET_VERSION = "0.1.0";

function getIntegrationLogoUrl(logoSlug: string) {
  return `https://cdn.helloautoflow.com/v${BRAND_ASSET_VERSION}/logos/integrations/${logoSlug}/logo.svg`;
}

export default function IntegrationsHub() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [registered, setRegistered] = useState<RegisteredIntegration[]>([]);
  const [presets, setPresets] = useState<LibraryPreset[]>([]);
  const [customTemplate, setCustomTemplate] = useState<CustomTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [serverData, libraryData] = await Promise.all([
          apiGet<{ servers: RegisteredIntegration[] }>("/api/mcp/servers", user),
          apiGet<{ presets: LibraryPreset[]; customTemplate: CustomTemplate }>("/api/mcp/servers/library", user),
        ]);
        setRegistered(serverData.servers);
        setPresets(libraryData.presets);
        setCustomTemplate(libraryData.customTemplate);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [user]);

  const allOptions = useMemo<IntegrationCard[]>(() => {
    const custom = customTemplate
      ? [
          {
            ...customTemplate,
            tools: ["Bring your own MCP server", "Custom headers", "Health checks"],
            official: false,
            connected: false,
            isCustom: true,
          } satisfies IntegrationCard,
        ]
      : [];
    return [...presets.map((preset) => ({ ...preset, isCustom: false } satisfies IntegrationCard)), ...custom];
  }, [customTemplate, presets]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(allOptions.map((item) => item.category))).sort()],
    [allOptions]
  );

  const filtered = allOptions.filter((item) => {
    const query = search.toLowerCase();
    const matchSearch =
      item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query);
    const matchCategory = category === "All" || item.category === category;
    return matchSearch && matchCategory;
  });

  const recentRegistered = registered
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  return (
    <div className="min-h-full bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Integrations Hub</h1>
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
                MCP library
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Browse pre-built MCP servers, inspect their tools, and register a CustomMCP endpoint.
            </p>
          </div>
          <div className="text-right space-y-1">
            <div>
              <div className="text-2xl font-bold text-gray-900">{registered.length}</div>
              <div className="text-xs text-gray-400">registered MCP connections</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-700">
                {presets.filter((preset) => preset.connected).length}
              </div>
              <div className="text-xs text-gray-400">pre-built servers connected</div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Connection Activity</p>
              <p className="mt-1 text-xs text-gray-500">
                Registered servers are available in workflows and can be tested from the MCP registry.
              </p>
            </div>
            <Link
              to="/settings/integrations"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Open MCP registry
              <ExternalLink size={12} />
            </Link>
          </div>
          {loading ? (
            <div className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500">
              <Loader2 size={12} className="animate-spin" />
              Loading MCP library…
            </div>
          ) : recentRegistered.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {recentRegistered.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700"
                  title={item.url}
                >
                  <PlugZap size={11} />
                  {item.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-500">No MCP servers registered yet.</p>
          )}
        </div>

        <div className="flex gap-3 mt-5">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search MCP library..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  category === cat
                    ? "bg-gray-900 text-white"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={14} className="animate-spin" />
            Loading integrations…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((item) => {
              const logo = item.logoSlug ? getIntegrationLogoUrl(item.logoSlug) : undefined;

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-blue-200 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                        {logo ? (
                          <img src={logo} alt={`${item.name} logo`} className="w-6 h-6 object-contain" />
                        ) : item.isCustom ? (
                          <Wrench size={16} className="text-gray-600" />
                        ) : (
                          <PlugZap size={16} className="text-gray-600" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-gray-900 text-sm">{item.name}</span>
                          {item.official && <CheckCircle size={12} className="text-blue-500" />}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Tag size={9} />
                          {item.category}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.connected
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {item.connected ? "Connected" : item.isCustom ? "Custom setup" : "Ready to configure"}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500 mt-3 leading-relaxed">{item.description}</p>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {item.tools.slice(0, 3).map((tool) => (
                      <span
                        key={tool}
                        className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-mono"
                      >
                        {tool}
                      </span>
                    ))}
                    {item.tools.length > 3 && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-400 rounded text-xs">
                        +{item.tools.length - 3} more
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                    <Link
                      to="/settings/integrations"
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
                    >
                      <PlugZap size={12} />
                      {item.isCustom ? "Open CustomMCP" : item.connected ? "Manage connection" : "Configure"}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <PlugZap size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No integrations match your search</p>
          </div>
        )}
      </div>
    </div>
  );
}
