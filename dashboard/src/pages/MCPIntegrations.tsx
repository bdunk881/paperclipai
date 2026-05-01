import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Plug, PlugZap, Star, Tag, ExternalLink, CheckCircle, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";

import githubLogo from "../assets/integrations/github.svg";
import linearLogo from "../assets/integrations/linear.svg";
import slackLogo from "../assets/integrations/slack.svg";
import postgresLogo from "../assets/integrations/postgresql.svg";
import notionLogo from "../assets/integrations/notion.svg";
import stripeLogo from "../assets/integrations/stripe.svg";
import hubspotLogo from "../assets/integrations/hubspot.svg";
import googleLogo from "../assets/integrations/google.svg";
import braveLogo from "../assets/integrations/brave-search.svg";
import filesystemLogo from "../assets/integrations/filesystem.svg";
import puppeteerLogo from "../assets/integrations/puppeteer.svg";
import intercomLogo from "../assets/integrations/intercom.svg";
import sanityLogo from "../assets/integrations/sanity.svg";
import oktaLogo from "../assets/integrations/okta.svg";
import jiraLogo from "../assets/integrations/jira.svg";
import discordLogo from "../assets/integrations/discord.svg";
import gmailLogo from "../assets/integrations/gmail.svg";
import twitterLogo from "../assets/integrations/twitter.svg";
import quickbooksLogo from "../assets/integrations/quickbooks.svg";

interface IntegrationOption {
  id: string;
  name: string;
  description: string;
  category: string;
  tools: string[];
  rating: number;
  connected: boolean;
  official: boolean;
  logo?: string;
}

interface RegisteredIntegration {
  id: string;
  name: string;
  url: string;
  hasAuth: boolean;
  createdAt: string;
}

const INTEGRATION_OPTIONS: IntegrationOption[] = [
  {
    id: "mcp-github",
    name: "GitHub",
    description: "Read and write GitHub repositories, issues, PRs, and code search.",
    category: "Developer Tools",
    tools: ["search_code", "create_issue", "list_prs", "get_file", "push_commit"],
    rating: 4.9,
    connected: true,
    official: true,
    logo: githubLogo,
  },
  {
    id: "mcp-linear",
    name: "Linear",
    description: "Sync projects and issues with Linear to automate triage, assignment, and status updates.",
    category: "Project Management",
    tools: ["list_teams", "list_issues", "create_issue", "update_issue"],
    rating: 4.8,
    connected: false,
    official: true,
    logo: linearLogo,
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
    logo: slackLogo,
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
    logo: postgresLogo,
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
    logo: filesystemLogo,
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
    logo: braveLogo,
  },
  {
    id: "mcp-hubspot",
    name: "HubSpot",
    description: "Sync contacts, companies, and deals with HubSpot CRM.",
    category: "CRM",
    tools: ["get_contact", "update_deal", "list_companies"],
    rating: 4.7,
    connected: false,
    official: true,
    logo: hubspotLogo,
  },
  {
    id: "mcp-google",
    name: "Google Workspace",
    description: "Send emails via Gmail and manage files in Google Drive.",
    category: "Productivity",
    tools: ["send_email", "list_files", "create_doc"],
    rating: 4.8,
    connected: false,
    official: true,
    logo: googleLogo,
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
    logo: stripeLogo,
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
    logo: notionLogo,
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
    logo: puppeteerLogo,
  },
  {
    id: "mcp-intercom",
    name: "Intercom",
    description: "Sync customer data and manage conversations via Intercom.",
    category: "Support",
    tools: ["get_contact", "list_conversations", "send_reply"],
    rating: 4.7,
    connected: false,
    official: true,
    logo: intercomLogo,
  },
  {
    id: "mcp-sanity",
    name: "Sanity",
    description: "Query and mutate content in your Sanity CMS datasets.",
    category: "Content",
    tools: ["query_content", "create_document", "patch_document"],
    rating: 4.6,
    connected: false,
    official: false,
    logo: sanityLogo,
  },
  {
    id: "mcp-okta",
    name: "Okta",
    description: "Manage user access and authentication via Okta SSO.",
    category: "Identity",
    tools: ["list_users", "get_user", "update_user_status"],
    rating: 4.8,
    connected: false,
    official: true,
    logo: oktaLogo,
  },
  {
    id: "mcp-jira",
    name: "Jira",
    description: "Automate Jira issue creation and project tracking.",
    category: "Project Management",
    tools: ["create_issue", "update_issue", "list_projects"],
    rating: 4.7,
    connected: false,
    official: true,
    logo: jiraLogo,
  },
  {
    id: "mcp-discord",
    name: "Discord",
    description: "Send notifications and manage community interactions via Discord.",
    category: "Communication",
    tools: ["send_message", "list_guilds", "add_member"],
    rating: 4.5,
    connected: false,
    official: false,
    logo: discordLogo,
  },
  {
    id: "mcp-gmail",
    name: "Gmail",
    description: "Send emails and manage inbox workflows via Gmail.",
    category: "Productivity",
    tools: ["send_email", "list_messages", "create_draft"],
    rating: 4.9,
    connected: false,
    official: true,
    logo: gmailLogo,
  },
  {
    id: "mcp-twitter",
    name: "Twitter",
    description: "Schedule tweets and monitor mentions via X (Twitter).",
    category: "Social",
    tools: ["create_tweet", "get_mentions", "search_tweets"],
    rating: 4.4,
    connected: false,
    official: false,
    logo: twitterLogo,
  },
  {
    id: "mcp-quickbooks",
    name: "Quickbooks",
    description: "Automate bookkeeping and financial reporting via Quickbooks.",
    category: "Finance",
    tools: ["list_invoices", "create_expense", "get_reports"],
    rating: 4.7,
    connected: false,
    official: true,
    logo: quickbooksLogo,
  },
];

const CATEGORIES = ["All", ...Array.from(new Set(INTEGRATION_OPTIONS.map((s) => s.category))).sort()];

export default function IntegrationsHub() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [registered, setRegistered] = useState<RegisteredIntegration[]>([]);
  const [loadingRegistered, setLoadingRegistered] = useState(true);

  useEffect(() => {
    async function loadRegistered() {
      try {
        const data = await apiGet<{ servers: RegisteredIntegration[] }>("/api/mcp/servers", user);
        setRegistered(data.servers);
      } finally {
        setLoadingRegistered(false);
      }
    }
    void loadRegistered();
  }, [user]);

  const filtered = INTEGRATION_OPTIONS.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === "All" || s.category === category;
    return matchSearch && matchCategory;
  });

  const marketplaceConnectedCount = useMemo(
    () => INTEGRATION_OPTIONS.filter((option) => option.connected).length,
    []
  );
  const registeredCount = registered.length;
  const recentRegistered = registered
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Integrations Hub</h1>
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
                In Development
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Connect integrations to give your agents access to external tools and services.
            </p>
          </div>
          <div className="text-right space-y-1">
            <div>
              <div className="text-2xl font-bold text-gray-900">{registeredCount}</div>
              <div className="text-xs text-gray-400">custom integrations registered</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-700">{marketplaceConnectedCount}</div>
              <div className="text-xs text-gray-400">marketplace integrations connected</div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Custom Integration Activity</p>
              <p className="mt-1 text-xs text-gray-500">
                Manage your registered integration servers and verify auth before using them in workflows.
              </p>
            </div>
            <Link
              to="/settings/integrations"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
            >
              Manage registry
              <ExternalLink size={12} />
            </Link>
          </div>
          {loadingRegistered ? (
            <div className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500">
              <Loader2 size={12} className="animate-spin" />
              Loading custom integrations…
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
            <p className="mt-3 text-xs text-gray-500">No custom integrations registered yet.</p>
          )}
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
          {filtered.map((server) => {
            const Logo = server.logo ? (
              <img src={server.logo} alt={`${server.name} logo`} className="w-6 h-6 object-contain" />
            ) : (
              <PlugZap size={16} className="text-gray-600 dark:text-gray-400" />
            );

            return (
              <div
                key={server.id}
                className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 hover:shadow-md hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all duration-300 group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      {Logo}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{server.name}</span>
                        {server.official && (
                          <CheckCircle size={12} className="text-blue-500 dark:text-blue-400" />
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                        <Tag size={9} />
                        {server.category}
                        <span className="mx-1">·</span>
                        <Star size={9} className="text-yellow-400" />
                        {server.rating}
                      </div>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium">
                    Coming soon
                  </span>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">{server.description}</p>

              <div className="mt-3 flex flex-wrap gap-1">
                {server.tools.slice(0, 3).map((tool) => (
                  <span
                    key={tool}
                    className="px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 rounded text-xs font-mono"
                  >
                    {tool}
                  </span>
                ))}
                {server.tools.length > 3 && (
                  <span className="px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500 rounded text-xs">
                    +{server.tools.length - 3} more
                  </span>
                )}
              </div>

              <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled
                  title="Connection flow is still in development. Use Settings > Integrations to register custom integrations today."
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-500 border border-gray-200 dark:border-slate-700 cursor-not-allowed"
                >
                  <Plug size={12} />
                  Connect (coming soon)
                </button>
                <button className="px-2.5 py-2 rounded-lg border border-gray-200 dark:border-slate-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-slate-700 transition">
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>
          );
        })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <PlugZap size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No integrations match your search</p>
          </div>
        )}
      </div>
    </div>
  );
}
