import { type ReactNode } from "react";
import { Af2Modal } from "../af2/Af2Modal";

/**
 * Two confirm tones are supported (HEL-210):
 *   - `destructive` (default) renders the primary action in clay/red.
 *   - `sage` renders the primary action in sage/green for positive
 *     confirms like "Complete mission".
 */
export type ConfirmTone = "destructive" | "sage";

export interface ConfirmDestructiveModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  tone?: ConfirmTone;
}

export function ConfirmDestructiveModal({
  open,
  onClose,
  title,
  eyebrow,
  message,
  confirmLabel,
  onConfirm,
  confirming = false,
  secondaryLabel,
  onSecondary,
  tone = "destructive",
}: ConfirmDestructiveModalProps) {
  const primaryColor = tone === "sage" ? "var(--af2-sage)" : "var(--af2-clay)";
  return (
    <Af2Modal
      open={open}
      onClose={onClose}
      eyebrow={eyebrow}
      title={title}
      dismissOnBackdrop={!confirming}
      maxWidth={520}
      footer={
        <div className="af2-row" style={{ gap: 8, width: "100%" }}>
          <button
            type="button"
            className="af2-btn af2-btn-sm"
            disabled={confirming}
            onClick={onClose}
          >
            Cancel
          </button>
          <span className="af2-spacer" />
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              className="af2-btn af2-btn-sm"
              disabled={confirming}
              onClick={onSecondary}
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="af2-btn af2-btn-sm"
            style={{ color: primaryColor }}
            disabled={confirming}
            onClick={() => void onConfirm()}
          >
            {confirming ? "Working…" : confirmLabel}
          </button>
        </div>
      }
    >
      {typeof message === "string" ? (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--af2-ink)" }}>
          {message}
        </p>
      ) : (
        message
      )}
    </Af2Modal>
  );
}
