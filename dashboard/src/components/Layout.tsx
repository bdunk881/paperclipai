import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Workflow,
  Activity,
  History,
  LogOut,
  Zap,
  Cpu,
  Settings,
  DollarSign,
  CheckSquare,
  Database,
  PlugZap,
  ScrollText,
  Bot,
  BotMessageSquare,
  Menu,
  X,
  Moon,
  Sun,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import clsx from "clsx";
import { useTheme } from "../hooks/useTheme";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/builder", icon: Workflow, label: "Builder" },
  { to: "/monitor", icon: Activity, label: "Run Monitor" },
  { to: "/history", icon: History, label: "History" },
  { to: "/agents", icon: Bot, label: "Agent Catalog" },
  { to: "/agents/my", icon: Activity, label: "My Agents" },
  { to: "/agents/activity", icon: BotMessageSquare, label: "Agent Activity" },
  { to: "/approvals", icon: CheckSquare, label: "Approvals" },
  { to: "/logs", icon: ScrollText, label: "Logs" },
  { to: "/memory", icon: Database, label: "Memory" },
  { to: "/integrations", icon: PlugZap, label: "Integrations" },
  { to: "/pricing", icon: DollarSign, label: "Pricing" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
        {NAV.map(({ to, icon: Icon, label, end }) => (
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

        <div className="mt-2 border-t border-gray-200 dark:border-surface-700 pt-3">
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
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 transition-colors duration-200 lg:hidden dark:border-surface-800 dark:bg-surface-900">
        <button
          onClick={() => setMobileNavOpen((prev) => !prev)}
          className="rounded-lg border border-gray-200 p-2 text-gray-700 transition-colors hover:bg-gray-50 dark:border-surface-700 dark:text-gray-200 dark:hover:bg-surface-800"
          aria-label="Toggle navigation"
        >
          {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600">
            <Zap size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight text-gray-900 dark:text-gray-100">AutoFlow</span>
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

      {mobileNavOpen && (
        <button
          onClick={closeNav}
          className="fixed inset-0 z-30 bg-surface-950/35 lg:hidden"
          aria-label="Close navigation"
        />
      )}

      <aside
        className={clsx(
          "fixed bottom-0 left-0 top-0 z-40 flex w-72 flex-col border-r border-gray-200 bg-white text-gray-900 transition-transform lg:relative lg:w-60 lg:translate-x-0 dark:border-surface-800 dark:bg-surface-900 dark:text-gray-100",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-5 dark:border-surface-800">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-600">
            <Zap size={16} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">AutoFlow</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItems nested />
        </nav>

        {/* User + logout */}
        <div className="border-t border-gray-200 px-4 py-4 dark:border-surface-800">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-600 text-sm font-bold uppercase text-white">
              {user?.name?.[0] ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
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
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-surface-50 pt-14 transition-colors duration-200 lg:pt-0 dark:bg-surface-950">
        <Outlet />
      </main>
    </div>
  );
}
