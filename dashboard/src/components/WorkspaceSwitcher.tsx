import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, Plus, RefreshCw, X } from "lucide-react";
import clsx from "clsx";
import { useWorkspace } from "../context/useWorkspace";

function workspaceInitial(name: string | undefined): string {
  const initial = name?.trim().charAt(0).toUpperCase();
  return initial || "W";
}

export function WorkspaceSwitcher() {
  const {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    loading,
    creating,
    error,
    setActiveWorkspaceId,
    refreshWorkspaces,
    createWorkspace,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerId = useId();
  const menuId = useId();

  const secondaryText = useMemo(() => {
    if (loading && !activeWorkspace) {
      return "Loading workspaces";
    }

    if (error && !activeWorkspace) {
      return "Unable to load workspaces";
    }

    if (activeWorkspace?.slug) {
      return activeWorkspace.slug;
    }

    return "Current workspace";
  }, [activeWorkspace, error, loading]);

  useEffect(() => {
    if (!open && !createOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateOpen(false);
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [createOpen, open]);

  async function handleCreateWorkspaceSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = draftName.trim();

    if (!nextName) {
      setCreateError("Workspace name is required.");
      return;
    }

    setCreateError(null);

    try {
      await createWorkspace(nextName);
      setDraftName("");
      setCreateOpen(false);
      setOpen(false);
    } catch (workspaceError) {
      setCreateError(
        workspaceError instanceof Error ? workspaceError.message : "Failed to create workspace."
      );
    }
  }

  return (
    <>
      <div ref={dropdownRef} className="relative border-b border-af2-line px-3 pb-3 dark:border-surface-800">
        <button
          id={triggerId}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          disabled={loading && !activeWorkspace}
          onClick={() => setOpen((current) => !current)}
          className={clsx(
            "mt-3 flex h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all",
            "bg-transparent text-af2-ink hover:bg-af2-paper-2 dark:bg-surface-900 dark:text-surface-50 dark:hover:bg-surface-850",
            open
              ? "border-af2-clay/50 shadow-[0_0_0_1px_rgba(99,102,241,0.18)] dark:bg-surface-800"
              : "border-af2-line shadow-none dark:border-surface-700",
            error && !activeWorkspace
              ? "border-af2-clay/60 text-af2-clay dark:border-af2-clay/60 dark:text-af2-clay"
              : null,
            loading && !activeWorkspace ? "cursor-not-allowed opacity-55" : null
          )}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-af2-clay-soft/40 text-xs font-bold uppercase text-af2-clay dark:bg-af2-clay-soft/40 dark:text-brand-300">
            {loading && !activeWorkspace ? <Loader2 size={14} className="animate-spin" /> : workspaceInitial(activeWorkspace?.name)}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-[-0.01em]">
              {activeWorkspace?.name ?? "Workspace"}
            </p>
            <p
              className={clsx(
                "truncate text-[11px]",
                error && !activeWorkspace
                  ? "text-af2-clay"
                  : "text-af2-ink-3 dark:text-surface-400"
              )}
            >
              {secondaryText}
            </p>
          </div>

          <ChevronDown
            size={16}
            className={clsx(
              "shrink-0 text-af2-ink-4 transition-transform duration-[180ms] dark:text-surface-400",
              open ? "rotate-180 text-af2-ink-3 dark:text-surface-300" : null
            )}
          />
        </button>

        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className={clsx(
            "pointer-events-none absolute left-3 right-3 top-[calc(100%+4px)] z-30 origin-top rounded-2xl border border-af2-line bg-af2-card/98 shadow-[0_20px_48px_rgba(15,23,42,0.16)] backdrop-blur transition-all dark:border-surface-700 dark:bg-surface-900/98 dark:shadow-[0_24px_64px_rgba(2,6,23,0.42)]",
            open
              ? "pointer-events-auto translate-y-0 opacity-100 duration-[180ms] ease-out"
              : "-translate-y-1 opacity-0 duration-[140ms] ease-in"
          )}
        >
          <div className="max-h-72 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-af2-ink-3 dark:text-surface-400">
                <Loader2 size={14} className="animate-spin" />
                Loading workspaces
              </div>
            ) : error ? (
              <button
                type="button"
                onClick={() => void refreshWorkspaces()}
                className="flex w-full items-center gap-3 rounded-xl border border-af2-clay/40 px-3 py-3 text-left text-sm text-af2-clay transition hover:bg-af2-clay/10"
              >
                <AlertTriangle size={14} />
                <span className="flex-1 truncate">{error}</span>
                <RefreshCw size={14} />
              </button>
            ) : workspaces.length === 0 ? (
              <div className="rounded-xl border border-dashed border-af2-line px-3 py-4 text-sm text-af2-ink-3 dark:border-surface-700 dark:text-surface-400">
                No workspaces available yet.
              </div>
            ) : (
              <div className="space-y-1">
                {workspaces.map((workspace) => {
                  const selected = workspace.id === activeWorkspaceId;

                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        setActiveWorkspaceId(workspace.id);
                        setOpen(false);
                      }}
                      className={clsx(
                        "relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition",
                        selected
                          ? "bg-af2-clay-soft/40 text-af2-ink dark:bg-af2-clay-soft/40 dark:text-surface-50"
                          : "text-af2-ink-2 hover:bg-af2-paper-2 dark:text-surface-300 dark:hover:bg-surface-800"
                      )}
                    >
                      <span
                        className={clsx(
                          "absolute inset-y-2 left-1 w-0.5 rounded-full bg-af2-clay-soft/400 transition-opacity",
                          selected ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-af2-clay-soft/40 text-xs font-bold uppercase text-af2-clay dark:bg-af2-clay-soft/40 dark:text-brand-300">
                        {workspaceInitial(workspace.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold tracking-[-0.01em]">{workspace.name}</p>
                        <p className="truncate text-[11px] text-af2-ink-3 dark:text-surface-400">
                          {workspace.slug}
                        </p>
                      </div>
                      {selected ? <Check size={15} className="text-af2-clay" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-af2-line p-2 dark:border-surface-700">
            <button
              type="button"
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-af2-line px-3 py-2.5 text-sm font-medium text-af2-ink-2 transition hover:border-af2-clay/40 hover:text-af2-clay dark:border-surface-700 dark:text-surface-200 dark:hover:border-af2-clay/40 dark:hover:text-surface-50"
            >
              <Plus size={14} />
              Create workspace
            </button>
          </div>
        </div>
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close create workspace modal"
            className="absolute inset-0 bg-af2-ink/55 backdrop-blur-[2px]"
            onClick={() => setCreateOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-workspace-title"
            className="animate-ticket-modal relative z-10 w-full max-w-md rounded-[28px] border border-af2-line bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.98))] p-6 shadow-2xl dark:border-slate-800 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(7,12,24,0.98))]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-af2-clay">
                  Workspace Setup
                </p>
                <h2 id="create-workspace-title" className="mt-2 text-xl font-semibold text-af2-ink dark:text-slate-100">
                  Create workspace
                </h2>
                <p className="mt-2 text-sm leading-6 text-af2-ink-2 dark:text-surface-400">
                  Create a new workspace and switch the dashboard into it immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-full border border-af2-line p-2 text-af2-ink-3 transition hover:border-af2-clay/30 hover:text-af2-ink dark:border-surface-700 dark:text-surface-400 dark:hover:text-surface-50"
                aria-label="Close create workspace modal"
              >
                <X size={14} />
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleCreateWorkspaceSubmit}>
              <div>
                <label htmlFor="workspace-name" className="mb-2 block text-sm font-medium text-af2-ink-2 dark:text-surface-200">
                  Workspace name
                </label>
                <input
                  id="workspace-name"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  maxLength={80}
                  autoFocus
                  placeholder="Acme launch ops"
                  className="w-full rounded-2xl border border-af2-line bg-af2-card px-4 py-3 text-sm text-af2-ink transition focus:outline-none focus:ring-2 focus:ring-af2-clay/20 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-50"
                />
              </div>

              {createError ? (
                <div className="rounded-2xl border border-af2-clay/40 bg-af2-clay/10 px-4 py-3 text-sm text-af2-clay">
                  {createError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-xl border border-af2-line px-4 py-2 text-sm font-medium text-af2-ink-2 transition hover:border-af2-line-2 hover:text-af2-ink dark:border-surface-700 dark:text-surface-300 dark:hover:text-surface-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-2 rounded-xl bg-af2-clay px-4 py-2 text-sm font-medium text-white transition hover:bg-af2-clay-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Create workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
