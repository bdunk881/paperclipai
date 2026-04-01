import { useState } from "react";
import { Search, Plug, PlugZap, Star, Tag, ExternalLink, CheckCircle } from "lucide-react";

interface MCPServer {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: string[];
  rating: number;
  connected: boolean;
  official: boolean;
}

const MCP_SERVERS: MCPServer[] = [
  {
    id: "mcp-github",
    name: "GitHub",
    description: "Read and write GitHub repositories, issues, PRs, and code search.",
    category: "Developer Tools",
    tools: ["search_code", "create_issue", "list_prs", "get_file", "push_commit"],
    rating: 4.9,
    connected: true,
    official: true,
  },
  {
    id: "mcp-slack",
    name: "Slack",
    description: "Send messages, read channels, and manage Slack workspaces.",
    category: "Communication",
    tools: ["send_message", "list_channels", "get_thread", "add_reaction"],
    rating: 4.8,
    connected: false,
    official: true,
  },
  {
    id: "mcp-postgres",
    name: "PostgreSQL",
    description: "Query and mutate PostgreSQL databases with schema introspection.",
    category: "Database",
    tools: ["query", "execute", "list_tables", "describe_table"],
    rating: 4.7,
    connected: false,
    official: true,
  },
  {
    id: "mcp-filesystem",
    name: "Filesystem",
    description: "Read and write files on your local or remote filesystem.",
    category: "Storage",
    tools: ["read_file", "write_file", "list_directory", "move_file", "delete_file"],
    rating: 4.6,
    connected: true,
    official: true,
  },
  {
    id: "mcp-brave",
    name: "Brave Search",
    description: "Real-time web search via Brave's privacy-focused search API.",
    category: "Search",
    tools: ["web_search", "news_search", "image_search"],
    rating: 4.5,
    connected: false,
    official: false,
  },
  {
    id: "mcp-stripe",
    name: "Stripe",
    description: "Manage payments, customers, subscriptions, and invoices via Stripe.",
    category: "Payments",
    tools: ["create_customer", "charge_card", "list_subscriptions", "create_invoice"],
    rating: 4.8,
    connected: false,
    official: true,
  },
  {
    id: "mcp-notion",
    name: "Notion",
    description: "Read and write Notion pages, databases, and blocks.",
    category: "Productivity",
    tools: ["get_page", "create_page", "query_database", "update_block"],
    rating: 4.4,
    connected: false,
    official: false,
  },
  {
    id: "mcp-puppeteer",
    name: "Puppeteer",
    description: "Browser automation — navigate pages, click, fill forms, take screenshots.",
    category: "Browser",
    tools: ["navigate", "click", "type", "screenshot", "evaluate"],
    rating: 4.3,
    connected: false,
    official: false,
  },
];

const CATEGORIES = ["All", ...Array.from(new Set(MCP_SERVERS.map((s) => s.category))).sort()];

export default function MCPIntegrations() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [servers, setServers] = useState<MCPServer[]>(MCP_SERVERS);

  function toggleConnect(id: string) {
    setServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, connected: !s.connected } : s))
    );
  }

  const filtered = servers.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === "All" || s.category === category;
    return matchSearch && matchCategory;
  });

  const connectedCount = servers.filter((s) => s.connected).length;

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">MCP Integration Hub</h1>
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
                In Development
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Connect Model Context Protocol servers to give your agents access to external tools and services.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">{connectedCount}</div>
            <div className="text-xs text-gray-400">servers connected</div>
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex gap-3 mt-5">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search servers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {CATEGORIES.map((cat) => (
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

      {/* Server grid */}
      <div className="max-w-6xl mx-auto px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((server) => (
            <div
              key={server.id}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                    <PlugZap size={16} className="text-gray-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-gray-900 text-sm">{server.name}</span>
                      {server.official && (
                        <CheckCircle size={12} className="text-blue-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Tag size={9} />
                      {server.category}
                      <span className="mx-1">·</span>
                      <Star size={9} className="text-yellow-400" />
                      {server.rating}
                    </div>
                  </div>
                </div>

                {server.connected && (
                  <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                    Connected
                  </span>
                )}
              </div>

              <p className="text-xs text-gray-500 mt-3 leading-relaxed">{server.description}</p>

              <div className="mt-3 flex flex-wrap gap-1">
                {server.tools.slice(0, 3).map((tool) => (
                  <span
                    key={tool}
                    className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-mono"
                  >
                    {tool}
                  </span>
                ))}
                {server.tools.length > 3 && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-400 rounded text-xs">
                    +{server.tools.length - 3} more
                  </span>
                )}
              </div>

              <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                <button
                  onClick={() => toggleConnect(server.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${
                    server.connected
                      ? "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  <Plug size={12} />
                  {server.connected ? "Disconnect" : "Connect"}
                </button>
                <button className="px-2.5 py-2 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 transition">
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <PlugZap size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No servers match your search</p>
          </div>
        )}
      </div>
    </div>
  );
}
