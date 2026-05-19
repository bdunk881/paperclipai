import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { CircleHelp, Inbox, Plus, Search, X } from "lucide-react";
import * as Sentry from "@sentry/react";
import { useAuth } from "../context/AuthContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { searchEntities, type GlobalSearchResult } from "../api/searchApi";

// AppTopbar - v2 chrome strap that sits across the top of the authenticated
// shell. Mirrors `docs/design/v2/shell.jsx::AF2_Topbar`: workspace switcher
// on the left, global search in the middle, "+ New mission" / utility icons
// on the right. The sidebar in `Layout.tsx` no longer renders its own
// workspace switcher because it lives here now.

type AppTopbarProps = {
  leading?: ReactNode;
};

export function AppTopbar({ leading }: AppTopbarProps = {}) {
  const navigate = useNavigate();
  const { user, requireAccessToken } = useAuth();
  const searchLaunchRef = useRef<HTMLButtonElement | null>(null);
  const paletteInputRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error">("idle");

  const initials = useMemo(() => {
    const source = user?.name ?? user?.email ?? "";
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (first + last).toUpperCase().slice(0, 2);
  }, [user]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
    setSearchState("idle");
    searchLaunchRef.current?.blur();
  }, []);

  const navigateToResult = useCallback(
    (result: GlobalSearchResult) => {
      closeSearch();
      navigate(result.route);
    },
    [closeSearch, navigate],
  );

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target;
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.key.toLowerCase() !== "k") return;
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || target.isContentEditable) {
          if (target !== searchLaunchRef.current && target !== paletteInputRef.current) return;
        }
      }
      event.preventDefault();
      openSearch();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  useEffect(() => {
    if (!searchOpen) return;
    const timeout = window.setTimeout(() => {
      paletteInputRef.current?.focus();
      paletteInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    let cancelled = false;
    setSearchState("loading");

    async function runSearch() {
      try {
        const token = await requireAccessToken();
        const payload = await searchEntities(token, query, 8);
        if (cancelled) return;
        setResults(payload.results);
        setActiveIndex(0);
        setSearchState("idle");
      } catch {
        if (cancelled) return;
        setResults([]);
        setActiveIndex(0);
        setSearchState("error");
      }
    }

    void runSearch();
    return () => {
      cancelled = true;
    };
  }, [query, requireAccessToken, searchOpen]);

  async function handleHelp() {
    const feedback = Sentry.getFeedback?.();
    if (feedback) {
      try {
        const form = await feedback.createForm();
        form.appendToDom();
        form.open();
        return;
      } catch {
        // Fall through to email.
      }
    }
    window.location.href =
      "mailto:support@helloautoflow.com?subject=AutoFlow%20help";
  }

  function handlePaletteKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeIndex];
      if (result) {
        navigateToResult(result);
      }
    }
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
        <button
          ref={searchLaunchRef}
          type="button"
          aria-label="Search agents, missions, assignments, runs"
          onClick={openSearch}
          className="flex h-9 w-full items-center rounded-lg border border-af2-line bg-af2-paper-2/60 pl-8 pr-12 text-left text-[13px] text-af2-ink-4 transition focus:border-af2-line-2 focus:bg-af2-card focus:outline-none focus:ring-2 focus:ring-af2-clay/20"
        >
          <span className="truncate">Search agents, missions, assignments, runs...</span>
        </button>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 rounded border border-af2-line-2 bg-af2-card px-1.5 py-0.5 font-af2-mono text-[10.5px] leading-none text-af2-ink-4"
        >
          Ctrl K
        </span>
      </div>

      <div className="flex flex-1 justify-end md:hidden">
        <button
          type="button"
          onClick={openSearch}
          title="Search"
          aria-label="Open search"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
        >
          <Search size={16} />
        </button>
      </div>

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
        title="Inbox - Approvals"
        aria-label="Inbox - Approvals"
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

      {searchOpen ? (
        <div
          className="fixed inset-0 z-50 bg-af2-ink/25 p-3 backdrop-blur-[2px] sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSearch();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search AutoFlow"
            className="mx-auto flex max-h-[calc(100vh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-af2-line bg-af2-card shadow-2xl sm:max-h-[min(720px,calc(100vh-3rem))]"
          >
            <div className="flex items-center gap-3 border-b border-af2-line px-3 py-3">
              <Search size={16} className="shrink-0 text-af2-ink-4" />
              <input
                ref={paletteInputRef}
                type="search"
                aria-label="Search AutoFlow"
                aria-controls="global-search-results"
                aria-activedescendant={
                  results[activeIndex] ? `global-search-result-${activeIndex}` : undefined
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handlePaletteKeyDown}
                placeholder="Search agents, missions, routines, approvals..."
                className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-af2-ink placeholder:text-af2-ink-4 focus:outline-none"
              />
              <button
                type="button"
                onClick={closeSearch}
                title="Close search"
                aria-label="Close search"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
              >
                <X size={16} />
              </button>
            </div>

            <div
              id="global-search-results"
              role="listbox"
              aria-label="Search results"
              className="max-h-[min(560px,calc(100vh-6rem))] overflow-y-auto p-2"
            >
              {results.map((result, index) => (
                <button
                  key={`${result.type}-${result.id}`}
                  id={`global-search-result-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => navigateToResult(result)}
                  className={`flex min-h-[58px] w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${
                    index === activeIndex
                      ? "bg-af2-paper-2 text-af2-ink"
                      : "text-af2-ink hover:bg-af2-paper-2"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">
                      {result.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-af2-ink-4">
                      {formatSearchType(result.type)}
                      {result.subtitle ? ` - ${result.subtitle}` : ""}
                    </span>
                  </span>
                  {result.status ? (
                    <span className="shrink-0 rounded border border-af2-line bg-af2-card px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-af2-ink-4">
                      {result.status}
                    </span>
                  ) : null}
                </button>
              ))}

              {searchState === "loading" ? (
                <div role="status" className="px-3 py-5 text-center text-[13px] text-af2-ink-4">
                  Searching...
                </div>
              ) : null}

              {searchState === "error" ? (
                <div role="alert" className="px-3 py-5 text-center text-[13px] text-af2-ink-4">
                  Search unavailable
                </div>
              ) : null}

              {searchState === "idle" && results.length === 0 ? (
                <div className="px-3 py-5 text-center text-[13px] text-af2-ink-4">
                  No matching results
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function formatSearchType(type: GlobalSearchResult["type"]): string {
  switch (type) {
    case "mission":
      return "Mission";
    case "agent":
      return "Agent";
    case "routine":
      return "Routine";
    case "approval":
      return "Approval";
  }
}
