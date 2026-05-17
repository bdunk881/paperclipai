/**
 * ToastProvider (UX-7) — single source of truth for transient
 * confirmation / error / info messages across the dashboard.
 *
 * Pre-UX-7 every page wired its own local "✓ Sent" / "Failed" inline
 * state — five different patterns in five different places. This
 * provider gives callers one tiny API:
 *
 *   const toast = useToast();
 *   toast.success("Mission saved as draft");
 *   toast.error("Couldn't reach the LLM provider");
 *   toast.info("Aaron is checking in…", { duration: 5_000 });
 *
 * Toasts stack bottom-right, auto-dismiss (default 3s for success /
 * info, 6s for error so the user has time to read), and can be
 * dismissed manually with the × button.
 *
 * Implementation notes:
 *   - React Context + Map-based store keyed by autoincrement id so
 *     two simultaneous toasts don't race on Date.now() collisions.
 *   - Renders to document.body via a position:fixed div (no portal —
 *     keeps the dependency surface tiny). z-index 9999 sits above
 *     every modal in the app today.
 *   - Server-side / no-window guard: useInjectStyles is a no-op when
 *     document is undefined so SSR + tests don't choke.
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
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

export interface ToastOptions {
  /** Milliseconds before auto-dismiss. Defaults: 3000 success/info, 6000 error. */
  duration?: number;
}

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  expiresAt: number;
}

interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_BY_KIND: Record<ToastKind, number> = {
  success: 3_000,
  info: 3_500,
  error: 6_000,
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  // Track per-toast removal timers so callers can stack without
  // racing. The map is mutated outside of React state so we use a
  // ref instead of useState (no rerender needed on each timer).
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, options?: ToastOptions) => {
      const duration = options?.duration ?? DEFAULT_DURATION_BY_KIND[kind];
      const id = nextId++;
      setToasts((current) => [
        ...current,
        { id, kind, message, expiresAt: Date.now() + duration },
      ]);
      const handle = window.setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, handle);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      info: (message, options) => push("info", message, options),
    }),
    [push],
  );

  // Clear any pending timers on unmount so dev-mode hot reloads
  // don't leak fading-toast setTimeouts.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers.values()) window.clearTimeout(handle);
      timers.clear();
    };
  }, []);

  useInjectStyles();

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: "min(420px, calc(100vw - 32px))",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Soft-fail: callers in tests / preview surfaces without a
    // provider get a no-op API rather than a thrown error. Returning
    // no-ops keeps the call sites simple (no need to null-check).
    return {
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
    };
  }
  return ctx;
}

interface ToastRowProps {
  toast: ToastEntry;
  onDismiss: () => void;
}

function ToastRow({ toast, onDismiss }: ToastRowProps) {
  const { kind, message } = toast;
  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? XCircle : Info;
  const accent =
    kind === "success"
      ? "var(--af2-sage, #5a7a5a)"
      : kind === "error"
        ? "var(--af2-clay, #c0544c)"
        : "var(--af2-ink-2, #555)";
  const bg =
    kind === "success"
      ? "rgba(90,122,90,0.10)"
      : kind === "error"
        ? "rgba(192,84,76,0.10)"
        : "rgba(0,0,0,0.04)";
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${accent}40`,
        background: `var(--af2-card, #fff)`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        color: "var(--af2-ink, #222)",
        fontSize: 13,
        lineHeight: 1.45,
        pointerEvents: "auto",
        animation: "af2-toast-slide-in 180ms ease-out",
        boxSizing: "border-box",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 6,
          background: bg,
          color: accent,
          flexShrink: 0,
        }}
      >
        <Icon size={14} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          border: "none",
          background: "transparent",
          color: "var(--af2-muted, #888)",
          cursor: "pointer",
          padding: 2,
          display: "inline-flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

const STYLE_ID = "af2-toast-keyframes";

function useInjectStyles(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `@keyframes af2-toast-slide-in {
      from { transform: translateY(8px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }`;
    document.head.appendChild(style);
  }, []);
}
