/**
 * CommandPaletteContext — registry of palette actions and the open
 * state. Pages contribute their own actions on mount (`registerActions`)
 * and remove them on unmount; the palette renders the union.
 *
 * Recent actions (last 8) are persisted in localStorage so power users
 * see what they used most often surfaced at the top of the palette.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type CommandActionGroup = "navigate" | "action" | "filter" | "help";

export interface CommandAction {
  /** Unique id (scoped to the contributing page, e.g. `studio:add-llm`). */
  id: string;
  /** What the user types or sees. */
  label: string;
  /** Optional second-line context, e.g. "Studio". */
  hint?: string;
  /** Comma-separated keywords for fuzzy match. */
  keywords?: string;
  /** Grouped section in the palette. */
  group?: CommandActionGroup;
  /** What runs when chosen. */
  run: () => void;
}

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  actions: CommandAction[];
  /** Page-scoped contributors. Returns a stable scope token used to remove. */
  registerActions: (scope: string, actions: CommandAction[]) => void;
  unregisterActions: (scope: string) => void;
  /** Stable list of recent ids (newest first). */
  recentIds: string[];
  /** Push an id to the head of recents. */
  bumpRecent: (id: string) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

const RECENT_KEY = "af2.commandPalette.recent.v1";
const RECENT_LIMIT = 8;

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s) => typeof s === "string").slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [registry, setRegistry] = useState<Map<string, CommandAction[]>>(
    () => new Map(),
  );
  const [recentIds, setRecentIds] = useState<string[]>(() => loadRecent());

  const registerActions = useCallback(
    (scope: string, actions: CommandAction[]) => {
      setRegistry((prev) => {
        const next = new Map(prev);
        next.set(scope, actions);
        return next;
      });
    },
    [],
  );

  const unregisterActions = useCallback((scope: string) => {
    setRegistry((prev) => {
      if (!prev.has(scope)) return prev;
      const next = new Map(prev);
      next.delete(scope);
      return next;
    });
  }, []);

  const bumpRecent = useCallback((id: string) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
      saveRecent(next);
      return next;
    });
  }, []);

  const actions = useMemo<CommandAction[]>(() => {
    const seen = new Set<string>();
    const flat: CommandAction[] = [];
    for (const entries of registry.values()) {
      for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        flat.push(entry);
      }
    }
    return flat;
  }, [registry]);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      open,
      setOpen,
      actions,
      registerActions,
      unregisterActions,
      recentIds,
      bumpRecent,
    }),
    [open, actions, registerActions, unregisterActions, recentIds, bumpRecent],
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    // Soft no-op so unit tests and isolated previews don't crash.
    const noop = () => undefined;
    return {
      open: false,
      setOpen: noop,
      actions: [],
      registerActions: noop,
      unregisterActions: noop,
      recentIds: [],
      bumpRecent: noop,
    };
  }
  return ctx;
}

/**
 * Convenience hook for pages to register their actions on mount.
 * Re-registers whenever the actions reference changes — wrap the
 * contributors in useMemo on the calling side.
 */
export function useRegisterCommandActions(
  scope: string,
  actions: CommandAction[],
): void {
  const { registerActions, unregisterActions } = useCommandPalette();
  // Avoid stale-closure issues for runtime; keep latest run handlers in a ref.
  const latestRef = useRef(actions);
  useEffect(() => {
    latestRef.current = actions;
    registerActions(scope, actions);
    return () => unregisterActions(scope);
  }, [scope, actions, registerActions, unregisterActions]);
}
