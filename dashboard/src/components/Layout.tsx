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
  Bug,
} from "lucide-react";
import clsx from "clsx";
import * as Sentry from "@sentry/react";
import logoLockup from "../assets/logo/lockup.svg";
import { useAuth } from "../context/AuthContext";
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
      // HEL-23: Hire = mission intake (`/hire` → Hire.tsx). AgentCatalog
      // (`/agents`) is reachable from the Build > Library entry below.
      { to: "/hire", icon: UserPlus, label: "Hire" },
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

  // HEL-113: surface Sentry's User Feedback dialog from the chrome so users can
  // file a report even when the floating Sentry widget is dismissed or hidden.
  async function handleReportBug() {
    const feedback = Sentry.getFeedback?.();
    if (feedback) {
      try {
        const form = await feedback.createForm();
        form.appendToDom();
        form.open();
        return;
      } catch {
        // fall through to the mailto below
      }
    }
    // Fallback if Sentry isn't initialized (no DSN in this env). The mailto
    // keeps the affordance functional in local/dev so we never lose reports.
    window.location.href =
      "mailto:support@helloautoflow.com?subject=AutoFlow%20bug%20report";
  }

  function NavItems() {
    return (
      <>
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="px-3 pb-2 font-af2-sans text-[10.5px] font-medium uppercase tracking-[0.12em] text-af2-ink-4">
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
                      "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-af2-ink text-af2-paper"
                        : "text-af2-ink-2 hover:bg-af2-paper-2 hover:text-af2-ink"
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
    <div className="relative flex h-screen bg-af2-paper text-af2-ink transition-colors duration-200">
      {!isBuilderPopout && (
        <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-af2-line bg-af2-card px-4 py-3 transition-colors duration-200 lg:hidden">
          <button
            onClick={() => setMobileNavOpen((prev) => !prev)}
            className="rounded-md border border-af2-line p-2 text-af2-ink-2 transition-colors hover:bg-af2-paper-2 hover:text-af2-ink"
            aria-label="Toggle navigation"
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex items-center gap-2">
            <img src={logoLockup} alt="AutoFlow" className="h-8 w-auto object-contain" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReportBug}
              className="rounded-md border border-af2-line p-2 text-af2-ink-2 transition-colors hover:bg-af2-paper-2 hover:text-af2-ink"
              title="Report a bug"
              aria-label="Report a bug"
            >
              <Bug size={16} />
            </button>
            <button
              onClick={handleLogout}
              className="rounded-md border border-af2-line p-2 text-af2-ink-2 transition-colors hover:bg-af2-paper-2 hover:text-af2-ink"
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
          className="fixed inset-0 z-30 bg-af2-ink/35 lg:hidden"
          aria-label="Close navigation"
        />
      )}

      {!isBuilderPopout && (
        <aside
          className={clsx(
            "fixed bottom-0 left-0 top-0 z-40 flex w-72 flex-col border-r border-af2-line bg-af2-paper text-af2-ink transition-transform lg:relative lg:w-60 lg:translate-x-0",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center gap-2 px-5 py-5">
            <img src={logoLockup} alt="AutoFlow" className="h-9 w-auto object-contain" />
          </div>

          <WorkspaceSwitcher />

          <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
            <NavItems />
          </nav>

          <div className="border-t border-af2-line px-3 py-2">
            <button
              type="button"
              onClick={handleReportBug}
              className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium text-af2-ink-2 transition-colors hover:bg-af2-paper-2 hover:text-af2-ink"
              title="Report a bug"
            >
              <Bug size={18} />
              Report a bug
            </button>
          </div>

          <div className="border-t border-af2-line px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-af2-clay to-af2-mustard text-sm font-bold uppercase text-white">
                {user?.name?.[0] ?? "U"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-af2-ink">{user?.name}</p>
                <p className="truncate text-xs text-af2-ink-3">{user?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-md p-1.5 text-af2-ink-3 transition-colors hover:bg-af2-paper-2 hover:text-af2-ink"
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
          "flex-1 overflow-y-auto bg-af2-paper transition-colors duration-200",
          isBuilderPopout ? "pt-0" : "pt-14 lg:pt-0"
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
