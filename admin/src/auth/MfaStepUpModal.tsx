import { useEffect, useState } from "react";
import { consumeRecoveryCode } from "../api/mfaApi";
import { isWebauthnAvailable, verifyPasskey } from "./mfa";
import {
  STEP_UP_REQUIRED_EVENT,
  emitStepUpCancelled,
  emitStepUpSatisfied,
} from "./stepUpEvents";

export function MfaStepUpModal() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<"passkey" | "recovery">("passkey");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail ?? {};
      setReason(detail.reason);
      setError(null);
      setRecoveryCode("");
      setMode(isWebauthnAvailable() ? "passkey" : "recovery");
      setOpen(true);
    };
    window.addEventListener(STEP_UP_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(STEP_UP_REQUIRED_EVENT, handler);
  }, []);

  function close(cancelled = true) {
    setOpen(false);
    if (cancelled) emitStepUpCancelled();
  }

  async function handlePasskey() {
    setError(null);
    setBusy(true);
    try {
      await verifyPasskey();
      emitStepUpSatisfied();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecovery() {
    setError(null);
    if (recoveryCode.trim().length < 8) {
      setError("Enter a valid recovery code.");
      return;
    }
    setBusy(true);
    try {
      await consumeRecoveryCode(recoveryCode.trim());
      emitStepUpSatisfied();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery code rejected.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="stepup-title">
      <div className="modal-dialog">
        <h2 id="stepup-title">Verify it's you</h2>
        <p className="muted">
          This action requires a fresh second-factor check.
          {reason === "staff_requires_passkey"
            ? " AutoFlow staff endpoints require a passkey."
            : ""}
        </p>
        {error && (
          <div className="banner danger" style={{ marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}
        {mode === "passkey" ? (
          <div className="stack">
            <button className="primary" onClick={handlePasskey} disabled={busy}>
              {busy ? "Waiting for device…" : "Use passkey"}
            </button>
            <button type="button" className="link-button" onClick={() => setMode("recovery")}>
              Use a recovery code instead
            </button>
            <button type="button" onClick={() => close(true)} disabled={busy}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="stack">
            <div className="field">
              <label htmlFor="stepup-recovery">Recovery code</label>
              <input
                id="stepup-recovery"
                autoComplete="off"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
            </div>
            <div className="row">
              <button className="primary" onClick={handleRecovery} disabled={busy}>
                Verify
              </button>
              {isWebauthnAvailable() && (
                <button type="button" onClick={() => setMode("passkey")} disabled={busy}>
                  Use passkey
                </button>
              )}
              <button type="button" onClick={() => close(true)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
