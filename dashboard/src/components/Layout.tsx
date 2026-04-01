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
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import clsx from "clsx";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/builder", icon: Workflow, label: "Builder" },
  { to: "/monitor", icon: Activity, label: "Run Monitor" },
  { to: "/history", icon: History, label: "History" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex flex-col w-60 bg-gray-900 text-white">
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-700">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600">
            <Zap size={16} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">AutoFlow</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}

          <div className="pt-3 mt-2 border-t border-gray-700">
            <NavLink
              to="/settings"
              end
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                )
              }
            >
              <Settings size={18} />
              Settings
            </NavLink>
            <NavLink
              to="/settings/llm-providers"
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2 pl-9 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                )
              }
            >
              <Cpu size={18} />
              LLM Providers
            </NavLink>
          </div>
        </nav>

        {/* User + logout */}
        <div className="px-4 py-4 border-t border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-sm font-bold uppercase">
              {user?.name?.[0] ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
