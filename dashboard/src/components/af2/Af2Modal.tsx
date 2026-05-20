import { useEffect, type CSSProperties, type ReactNode } from "react";

export interface Af2ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Width cap; defaults to 560px to match the v2 prototype's `AF2_ModalShell`. */
  maxWidth?: number | string;
  /** Set `false` to disable backdrop dismissal (e.g. for blocking confirms). */
  dismissOnBackdrop?: boolean;
  /** Optional className applied to the inner card. */
  className?: string;
  /** Optional inline style applied to the inner card. */
  style?: CSSProperties;
}

/**
 * v2 modal shell — mirrors `docs/design/v2/modals.jsx::AF2_ModalShell` /
 * `Head` / `Body` / `Foot`. Renders a paper-cream card centered over a
 * dim backdrop, with escape-to-dismiss and click-outside-to-dismiss.
 *
 * Used to replace one-off overlay chrome that pages re-implement
 * (HandoffModal, JobDescriptionWizardModal — see HEL-189 follow-up).
 */
export function Af2Modal({
  open,
  onClose,
  title,
  eyebrow,
  footer,
  children,
  maxWidth = 560,
  dismissOnBackdrop = true,
  className,
  style,
}: Af2ModalProps) {
  // Escape-to-dismiss matches the prototype's behaviour and is the
  // baseline expectation for any modal in this codebase.
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

  const cardClass = ["af2-card", className].filter(Boolean).join(" ");
  const cardStyle: CSSProperties = {
    width: "100%",
    maxWidth,
    maxHeight: "calc(100vh - 64px)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    ...style,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (!dismissOnBackdrop) return;
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(26, 20, 16, 0.32)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div className={cardClass} style={cardStyle}>
        {(eyebrow || title) && (
          <div
            style={{
              padding: "18px 22px 12px",
              borderBottom: "1px solid var(--af2-line)",
            }}
          >
            {eyebrow ? (
              <div className="af2-eyebrow" style={{ marginBottom: 4 }}>
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <div className="af2-h2 font-af2-serif" style={{ marginTop: eyebrow ? 4 : 0 }}>
                {title}
              </div>
            ) : null}
          </div>
        )}
        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>{children}</div>
        {footer ? (
          <div
            style={{
              padding: "14px 22px",
              borderTop: "1px solid var(--af2-line)",
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              background: "var(--af2-paper)",
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
