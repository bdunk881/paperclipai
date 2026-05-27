/**
 * Lightweight keyboard-shortcut help overlay. Rendered conditionally by
 * the page that owns the keyboard handler — see useListKeyboardNav.
 */
import { useEffect } from "react";

export interface KeyboardShortcut {
  keys: string;
  label: string;
}

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  shortcuts: KeyboardShortcut[];
}

const DEFAULT_TITLE = "Keyboard shortcuts";

export function KeyboardShortcutsOverlay({
  open,
  onClose,
  title = DEFAULT_TITLE,
  shortcuts,
}: KeyboardShortcutsOverlayProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--af2-ink, #111) 35%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--af2-card)",
          border: "1px solid var(--af2-line)",
          borderRadius: "var(--af2-radius-lg, 12px)",
          padding: "20px 24px",
          minWidth: 320,
          maxWidth: 480,
          boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 14,
          }}
        >
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button
            type="button"
            className="btn ghost sm"
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            esc
          </button>
        </div>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {shortcuts.map((s) => (
            <li
              key={s.keys}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 13,
                color: "var(--af2-ink-2)",
              }}
            >
              <span>{s.label}</span>
              <kbd
                style={{
                  fontFamily:
                    "var(--af2-mono, ui-monospace, SFMono-Regular, monospace)",
                  fontSize: 11,
                  background: "var(--af2-paper-2)",
                  border: "1px solid var(--af2-line-2)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  color: "var(--af2-ink)",
                }}
              >
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
