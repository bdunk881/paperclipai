import { useEffect, useState, type ReactNode } from "react";

/**
 * Af2RowDrawer — inline row expansion panel (HEL-203 / PR 1).
 *
 * Used by the consolidated dashboard surfaces (Hire, Missions, Agents) to
 * progressively disclose detail directly underneath the clicked row, instead
 * of yanking the user away into a separate route. On desktop the drawer
 * unfurls in place (inline-expansion); on phones it slides up from the
 * bottom as a sheet so finger reach is comfortable.
 *
 * The component itself is unstyled beyond the animation chrome — callers
 * compose the inner card. This keeps the primitive reusable across rows
 * with varying widths (mission row vs agent card vs run row).
 *
 * Closing: backdrop click (bottom-sheet only), Esc, or a parent setting
 * `open={false}`. We do NOT trap focus — these are not full modals; the
 * underlying list remains interactive so users can hop between rows.
 */

export type Af2RowDrawerProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /**
   * When true (default), the drawer renders as a bottom sheet on narrow
   * viewports. Set to false to force inline-expansion on every breakpoint
   * (e.g. for a row inside a wide split view that already accounts for
   * touch reach).
   */
  mobileBottomSheet?: boolean;
  /** Optional aria-label for screen readers (defaults to "Row details"). */
  ariaLabel?: string;
};

/**
 * Inline `useMediaQuery` — kept local to this file (and Af2UserMenu) until
 * we accumulate a second consumer that justifies a shared hooks/ directory.
 * Guards against jsdom/SSR where matchMedia is absent.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function Af2RowDrawer({
  open,
  onClose,
  children,
  mobileBottomSheet = true,
  ariaLabel = "Row details",
}: Af2RowDrawerProps) {
  const isMobile = useMediaQuery("(max-width: 760px)");
  const renderAsSheet = open && mobileBottomSheet && isMobile;
  const renderAsInline = open && !renderAsSheet;

  // Esc collapses regardless of mode. Bound to window so a focused inner
  // form input doesn't swallow the key before reaching the drawer.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  if (renderAsSheet) {
    return (
      <>
        {/* Inline keyframes so this primitive stays drop-in without
            requiring a global stylesheet edit in PR 1. */}
        <style>{AF2_ROW_DRAWER_KEYFRAMES}</style>
        <div
          aria-hidden="true"
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(26, 20, 16, 0.32)",
            animation: "af2RowDrawerFade 160ms ease-out",
          }}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className="af2-row-drawer af2-row-drawer-sheet"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 41,
            maxHeight: "85vh",
            overflowY: "auto",
            background: "var(--af2-card)",
            borderTop: "1px solid var(--af2-line)",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            boxShadow: "0 -12px 32px rgba(26, 20, 16, 0.18)",
            animation: "af2RowDrawerSlideUp 220ms cubic-bezier(0.2, 0.7, 0.3, 1)",
          }}
        >
          {children}
        </div>
      </>
    );
  }

  if (renderAsInline) {
    return (
      <>
        <style>{AF2_ROW_DRAWER_KEYFRAMES}</style>
        <div
          role="region"
          aria-label={ariaLabel}
          className="af2-row-drawer af2-row-drawer-inline"
          style={{
            overflow: "hidden",
            background: "var(--af2-paper-2)",
            borderTop: "1px solid var(--af2-line)",
            borderBottom: "1px solid var(--af2-line)",
            animation: "af2RowDrawerExpand 180ms ease-out",
          }}
        >
          {children}
        </div>
      </>
    );
  }

  return null;
}

const AF2_ROW_DRAWER_KEYFRAMES = `
@keyframes af2RowDrawerSlideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes af2RowDrawerExpand {
  from { opacity: 0; max-height: 0; }
  to { opacity: 1; max-height: 1200px; }
}
@keyframes af2RowDrawerFade {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;
