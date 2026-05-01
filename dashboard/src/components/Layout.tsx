import { type ElementType, useMemo, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Flag,
  Workflow,
  Activity,
  History,
  LogOut,
  Cpu,
  Settings,
  DollarSign,
  CheckSquare,
  Database,
  PlugZap,
  ScrollText,
  Bot,
  BotMessageSquare,
  Repeat,
  Network,
  BarChart3,
  BriefcaseBusiness,
  Ticket,
  Menu,
  X,
  Moon,
  Sun,
  Siren,
} from "lucide-react";
import clsx from "clsx";
import logoLockup from "../assets/logo/lockup.svg";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";

type NavItem = {
  to: string;
  icon: ElementType;
  label: string;
  end?: boolean;
};

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Core",
    items: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
      { to: "/mission-state", icon: Flag, label: "Mission State" },
      { to: "/tickets", icon: Ticket, label: "Tickets" },
      { to: "/builder", icon: Workflow, label: "Builder" },
      { to: "/monitor", icon: Activity, label: "Run Monitor" },
      { to: "/history", icon: History, label: "History" },
    ],
  },
  {
    title: "Agents",
    items: [
      { to: "/agents", icon: Bot, label: "Agent Catalog" },
      { to: "/agents/my", icon: Bot, label: "My Agents" },
      { to: "/agents/activity", icon: BotMessageSquare, label: "Agent Activity" },
      { to: "/agents/routines", icon: Repeat, label: "Routines" },
    ],
  },
  {
    title: "Workspace",
    items: [
      { to: "/workspace/staffing-plan", icon: BriefcaseBusiness, label: "Staffing Plan" },
      { to: "/workspace/org-structure", icon: Network, label: "Org Structure" },
      { to: "/workspace/budget-dashboard", icon: BarChart3, label: "Budget Dashboard" },
      { to: "/approvals", icon: CheckSquare, label: "Approvals" },
    ],
  },
  {
    title: "Ops",
    items: [
      { to: "/logs", icon: ScrollText, label: "Logs" },
      { to: "/memory", icon: Database, label: "Memory" },
      { to: "/integrations/health", icon: Siren, label: "Connector Health" },
      { to: "/integrations/mcp", icon: PlugZap, label: "Integrations" },
      { to: "/pricing", icon: DollarSign, label: "Pricing" },
    ],
  },
] as const;

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isBuilderPopout = useMemo(() => {
    if (!location.pathname.startsWith("/builder")) {
      return false;
    }

    const params = new URLSearchParams(location.search);
    return params.get("popout") === "1";
  }, [location.pathname, location.search]);

  function handleLogout() {
    setMobileNavOpen(false);
    logout();
    navigate("/login");
  }

  function closeNav() {
    setMobileNavOpen(false);
  }

  function NavItems({ nested = false }: { nested?: boolean }) {
    return (
      <>
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400 dark:text-surface-500">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map(({ to, icon: Icon, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={closeNav}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-brand-600 text-white"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white"
                    )
                  }
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-2 border-t border-gray-200 pt-3 dark:border-surface-700">
          <NavLink
            to="/settings"
            end
            onClick={closeNav}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white"
              )
            }
          >
            <Settings size={18} />
            Settings
          </NavLink>
          <NavLink
            to="/settings/llm-providers"
            onClick={closeNav}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                nested && "pl-9",
                isActive
                  ? "bg-brand-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white"
              )
            }
          >
            <Cpu size={18} />
            LLM Providers
          </NavLink>
        </div>
      </>
    );
  }

  return (
    <div className="relative flex h-screen bg-surface-50 text-gray-900 transition-colors duration-200 dark:bg-surface-950 dark:text-gray-100">
      {!isBuilderPopout && (
        <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 transition-colors duration-200 lg:hidden dark:border-surface-800 dark:bg-surface-900">
          <button
            onClick={() => setMobileNavOpen((prev) => !prev)}
            className="rounded-lg border border-gray-200 p-2 text-gray-700 transition-colors hover:bg-gray-50 dark:border-surface-700 dark:text-gray-200 dark:hover:bg-surface-800"
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex items-center gap-2">
            <img src={logoLockup} alt="AutoFlow" className="h-8 w-auto object-contain text-gray-900 dark:text-gray-100" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 dark:border-surface-700 dark:text-gray-200 dark:hover:bg-surface-800"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 dark:border-surface-700 dark:text-gray-200 dark:hover:bg-surface-800"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
      )}

      {!isBuilderPopout && mobileNavOpen && (
        <button
          onClick={closeNav}
          className="fixed inset-0 z-30 bg-surface-950/35 lg:hidden"
          aria-label="Close navigation"
        />
      )}

      {!isBuilderPopout && (
        <aside
          className={clsx(
            "fixed bottom-0 left-0 top-0 z-40 flex w-72 flex-col border-r border-gray-200 bg-white text-gray-900 transition-transform lg:relative lg:w-60 lg:translate-x-0 dark:border-surface-800 dark:bg-surface-900 dark:text-gray-100",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-5 dark:border-surface-800">
            <img src={logoLockup} alt="AutoFlow" className="h-9 w-auto object-contain text-gray-900 dark:text-gray-100" />
          </div>

          <nav className="flex-1 space-y-1 px-3 py-4">
            <NavItems nested />
          </nav>

          <div className="border-t border-gray-200 px-4 py-4 dark:border-surface-800">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold uppercase text-white">
                {user?.name?.[0] ?? "U"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs text-gray-500 dark:text-surface-400">{user?.email}</p>
              </div>
              <button
                onClick={toggleTheme}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button
                onClick={handleLogout}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-white"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </aside>
      )}

      <main
        className={clsx(
          "flex-1 overflow-y-auto bg-surface-50 transition-colors duration-200 dark:bg-surface-950",
          isBuilderPopout ? "pt-0" : "pt-14 lg:pt-0"
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
