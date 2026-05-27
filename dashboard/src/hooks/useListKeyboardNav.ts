/**
 * useListKeyboardNav — shared j/k/Enter/Esc keyboard navigation for
 * row lists (Approvals queue, Assignments queue, etc.).
 *
 * Bindings:
 *   - j or ArrowDown : focus next row
 *   - k or ArrowUp   : focus previous row
 *   - Enter or o     : toggle expand on the focused row
 *   - Esc            : collapse the currently expanded row
 *   - ?              : toggle the help overlay (caller renders it)
 *
 * Listens at the document level but ignores key events that originate
 * from form fields (input, textarea, contenteditable, select).
 */
import { useCallback, useEffect, useState } from "react";

export interface UseListKeyboardNavOptions {
  /** Stable ordered list of row identifiers. */
  ids: string[];
  /** Currently expanded row, if any. */
  expandedId: string | null;
  /** Setter for the expanded row. */
  setExpandedId: (id: string | null) => void;
  /** Disable (e.g. when a modal is open). */
  disabled?: boolean;
}

export interface UseListKeyboardNavResult {
  /** Currently focused row id (driven by j/k). */
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  /** True while the user is holding `?` open. */
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

function targetIsTypable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useListKeyboardNav({
  ids,
  expandedId,
  setExpandedId,
  disabled,
}: UseListKeyboardNavOptions): UseListKeyboardNavResult {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Drop focus if the row disappears from the list (e.g. filter change).
  useEffect(() => {
    if (focusedId && !ids.includes(focusedId)) {
      setFocusedId(ids[0] ?? null);
    }
  }, [ids, focusedId]);

  const move = useCallback(
    (direction: 1 | -1) => {
      if (ids.length === 0) return;
      const currentIdx = focusedId ? ids.indexOf(focusedId) : -1;
      const nextIdx =
        currentIdx === -1
          ? direction === 1
            ? 0
            : ids.length - 1
          : Math.max(0, Math.min(ids.length - 1, currentIdx + direction));
      const nextId = ids[nextIdx] ?? null;
      setFocusedId(nextId);
      // Scroll the targeted row into view if it's offscreen.
      if (nextId && typeof document !== "undefined") {
        const el = document.querySelector<HTMLElement>(
          `[data-keyboard-row-id="${cssEscape(nextId)}"]`,
        );
        if (el) el.scrollIntoView({ block: "nearest" });
      }
    },
    [ids, focusedId],
  );

  useEffect(() => {
    if (disabled) return;
    const handler = (event: KeyboardEvent) => {
      if (targetIsTypable(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "Enter":
        case "o":
          if (focusedId) {
            event.preventDefault();
            setExpandedId(expandedId === focusedId ? null : focusedId);
          }
          break;
        case "Escape":
          if (expandedId) {
            event.preventDefault();
            setExpandedId(null);
          } else if (helpOpen) {
            event.preventDefault();
            setHelpOpen(false);
          }
          break;
        case "?":
          event.preventDefault();
          setHelpOpen(!helpOpen);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [disabled, focusedId, expandedId, helpOpen, move, setExpandedId]);

  return { focusedId, setFocusedId, helpOpen, setHelpOpen };
}

// Native CSS.escape isn't available in all jsdom test environments.
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
