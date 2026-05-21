import { Af2Modal } from "../af2/Af2Modal";

export interface ConfirmDestructiveModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
  /** When set, shows a secondary action (e.g. retire team before delete). */
  secondaryLabel?: string;
  onSecondary?: () => void;
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
}: ConfirmDestructiveModalProps) {
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
            style={{ color: "var(--af2-clay)" }}
            disabled={confirming}
            onClick={() => void onConfirm()}
          >
            {confirming ? "Working…" : confirmLabel}
          </button>
        </div>
      }
    >
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--af2-ink)" }}>
        {message}
      </p>
    </Af2Modal>
  );
}
