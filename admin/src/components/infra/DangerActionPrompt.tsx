import { useEffect, useState } from "react";

export interface DangerActionPromptProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  /** When set, admin must type this exact string (case-sensitive) into a confirm field. */
  typedConfirm?: string;
  confirmLabel?: string;
  /** When provided, the modal shows a checkbox the admin must tick before confirming. */
  acknowledgementText?: string;
  onClose: () => void;
  onConfirm: (input: { reason: string }) => Promise<void> | void;
}

/**
 * Modal-style confirmation prompt for destructive infra actions. Replaces
 * inline ReasonPrompt when we need typed-confirmation (production Fly
 * restart, queue drain) on top of the reason field. Designed so callers
 * just pass typedConfirm + acknowledgementText to opt in.
 */
export function DangerActionPrompt({
  open,
  title,
  description,
  typedConfirm,
  confirmLabel = "Confirm",
  acknowledgementText,
  onClose,
  onConfirm,
}: DangerActionPromptProps) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setTyped("");
      setAck(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const canConfirm =
    reason.trim().length >= 4 &&
    (!typedConfirm || typed === typedConfirm) &&
    (!acknowledgementText || ack);

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      await onConfirm({ reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-dialog">
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {description && <div className="muted" style={{ marginBottom: "0.75rem" }}>{description}</div>}

        {error && (
          <div className="banner danger" style={{ marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="danger-reason">Reason (required, audited)</label>
          <input
            id="danger-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you doing this?"
            autoFocus
          />
        </div>

        {typedConfirm && (
          <div className="field">
            <label htmlFor="danger-confirm">
              Type <code className="code">{typedConfirm}</code> to confirm
            </label>
            <input
              id="danger-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typedConfirm}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />
          </div>
        )}

        {acknowledgementText && (
          <label className="row" style={{ alignItems: "flex-start", marginBottom: "0.75rem" }}>
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              style={{ width: "auto", marginTop: 4 }}
            />
            <span>{acknowledgementText}</span>
          </label>
        )}

        <div className="row">
          <button
            className="danger"
            onClick={handleConfirm}
            disabled={!canConfirm || busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
