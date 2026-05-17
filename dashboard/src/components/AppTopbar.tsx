import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CircleHelp, Inbox, Plus, Search } from "lucide-react";
import * as Sentry from "@sentry/react";
import { useAuth } from "../context/AuthContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

// AppTopbar — v2 chrome strap that sits across the top of the authenticated
// shell. Mirrors `docs/design/v2/shell.jsx::AF2_Topbar`: workspace switcher
// on the left, global search in the middle, "+ New mission" / utility icons
// on the right. The sidebar in `Layout.tsx` no longer renders its own
// workspace switcher (it lives here now), and ⌘K / Ctrl+K focuses the
// search input — wiring an actual command palette is a follow-up.

type AppTopbarProps = {
  leading?: ReactNode;
};

export function AppTopbar({ leading }: AppTopbarProps = {}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const searchRef = useRef<HTMLInputElement | null>(null);

  const initials = useMemo(() => {
    const source = user?.name ?? user?.email ?? "";
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (first + last).toUpperCase().slice(0, 2);
  }, [user]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.key.toLowerCase() !== "k") return;
      // Don't hijack when the user is typing in another input/textarea/editable.
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || target.isContentEditable) {
          if (target !== searchRef.current) return;
        }
      }
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleHelp() {
    const feedback = Sentry.getFeedback?.();
    if (feedback) {
      try {
        const form = await feedback.createForm();
        form.appendToDom();
        form.open();
        return;
      } catch {
        // fall through
      }
    }
    window.location.href =
      "mailto:support@helloautoflow.com?subject=AutoFlow%20help";
  }

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-af2-line bg-af2-card/95 px-3 backdrop-blur lg:px-5"
      data-testid="app-topbar"
    >
      {leading}

      <div className="hidden min-w-0 lg:block">
        <WorkspaceSwitcher variant="topbar" />
      </div>

      <div className="relative ml-1 hidden min-w-0 flex-1 items-center md:flex">
        <Search size={14} className="pointer-events-none absolute left-3 text-af2-ink-4" />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search agents, missions, assignments, runs"
          placeholder="Search agents, missions, assignments, runs…"
          className="h-9 w-full rounded-lg border border-af2-line bg-af2-paper-2/60 pl-8 pr-12 text-[13px] text-af2-ink placeholder:text-af2-ink-4 focus:border-af2-line-2 focus:bg-af2-card focus:outline-none focus:ring-2 focus:ring-af2-clay/20"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 rounded border border-af2-line-2 bg-af2-card px-1.5 py-0.5 font-af2-mono text-[10.5px] leading-none text-af2-ink-4"
        >
          ⌘K
        </span>
      </div>

      <div className="md:hidden flex-1" />

      <Link
        to="/hire"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-af2-ink px-3 text-[13px] font-medium text-af2-paper transition hover:bg-af2-ink-2"
      >
        <Plus size={14} />
        <span className="hidden sm:inline">New mission</span>
      </Link>

      <button
        type="button"
        onClick={() => navigate("/approvals")}
        title="Inbox · Approvals"
        aria-label="Inbox · Approvals"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
      >
        <Inbox size={16} />
      </button>

      <button
        type="button"
        onClick={handleHelp}
        title="Help & feedback"
        aria-label="Help and feedback"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
      >
        <CircleHelp size={16} />
      </button>

      <Link
        to="/settings/profile"
        title={user?.name ?? user?.email ?? "Profile"}
        aria-label="Open profile settings"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-af2-clay to-af2-mustard text-[11px] font-bold uppercase text-white"
      >
        {initials}
      </Link>
    </header>
  );
}
