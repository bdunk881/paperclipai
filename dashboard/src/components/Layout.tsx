import { type ElementType, useMemo, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Target,
  Stamp,
  Activity,
  Users,
  UserPlus,
  Wallet,
  Wand2,
  BookOpen,
  Plug,
  Sparkles,
  Settings,
  LogOut,
  Menu,
  X,
  Moon,
  Sun,
} from "lucide-react";
import clsx from "clsx";
import logoLockup from "../assets/logo/lockup.svg";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

// v2 four-pillar IA (HEL-31). Labels follow the v2 design (`docs/design/v2/data.jsx`,
// `docs/design/v2/shell.jsx`); routes map to existing dashboard pages until the
// per-page restyle work in HEL-32 lands. New v2-native pages (Hire intake,
// Studio, Library) are tracked separately and will replace these route fallbacks
// when they ship.
type NavItem = {
  to: string;
  icon: ElementType;
  label: string;
  end?: boolean;
};

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Run",
    items: [
      { to: "/", icon: Home, label: "Home", end: true },
      { to: "/mission-state", icon: Target, label: "Missions" },
      { to: "/approvals", icon: Stamp, label: "Approvals" },
      { to: "/agents/activity", icon: Activity, label: "Activity" },
    ],
  },
  {
    title: "Workforce",
    items: [
      { to: "/workspace/org-structure", icon: Users, label: "Team" },
      // end:true so /agents/activity etc don't ALSO highlight Hire as active.
      { to: "/agents", icon: UserPlus, label: "Hire", end: true },
      { to: "/workspace/budget-dashboard", icon: Wallet, label: "Budget" },
    ],
  },
  {
    title: "Build",
    items: [
      { to: "/builder", icon: Wand2, label: "Studio" },
      { to: "/templates", icon: BookOpen, label: "Library" },
    ],
  },
  {
    title: "Connect",
    items: [
      { to: "/integrations/mcp", icon: Plug, label: "Integrations" },
      { to: "/settings/llm-providers", icon: Sparkles, label: "Models" },
      { to: "/settings", icon: Settings, label: "Settings", end: true },
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

  function NavItems() {
    return (
      <>
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="px-3 pb-2 font-af2-sans text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400 dark:text-surface-500">
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
          <div className="flex items-center gap-2 px-5 py-5">
            <img src={logoLockup} alt="AutoFlow" className="h-9 w-auto object-contain text-gray-900 dark:text-gray-100" />
          </div>

          <WorkspaceSwitcher />

          <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
            <NavItems />
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
