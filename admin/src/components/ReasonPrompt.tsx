import { useState } from "react";

/**
 * Small helper that wraps a button — clicking opens an inline reason input
 * and a confirm button. Calls onConfirm(reason) when the admin submits.
 */
export function ReasonPrompt({
  label,
  className,
  placeholder = "Reason (required, audited)",
  confirmLabel = "Confirm",
  onConfirm,
}: {
  label: string;
  className?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason);
      setOpen(false);
      setReason("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="row" style={{ width: "100%" }}>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1 }}
        autoFocus
      />
      <button className="primary" disabled={busy || !reason.trim()} onClick={submit}>
        {confirmLabel}
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setReason("");
          setError(null);
        }}
        disabled={busy}
      >
        Cancel
      </button>
      {error && <div className="banner danger">{error}</div>}
    </div>
  );
}
