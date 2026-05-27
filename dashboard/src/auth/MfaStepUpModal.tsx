/**
 * Global step-up modal (HEL-mfa).
 *
 * Listens for `autoflow:mfa:step-up-required` events emitted by API helpers
 * that detect a 401 with `mfa_step_up_required`. Pops a passkey challenge;
 * falls back to recovery code entry on click. On success, emits
 * `autoflow:mfa:step-up-satisfied` so awaiting callers can retry.
 */

import { useEffect, useState } from "react";
import { Af2Button, Af2Modal } from "../components/af2";
import { useAuth } from "../context/AuthContext";
import { consumeRecoveryCode } from "../api/mfaApi";
import { isWebauthnAvailable, verifyPasskey } from "./mfa";
import {
  STEP_UP_REQUIRED_EVENT,
  emitStepUpCancelled,
  emitStepUpSatisfied,
} from "./stepUpEvents";

export function MfaStepUpModal() {
  const { requireAccessToken } = useAuth();
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
      const token = await requireAccessToken();
      await verifyPasskey(token);
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
      const token = await requireAccessToken();
      await consumeRecoveryCode(token, recoveryCode.trim());
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
    <Af2Modal open={open} onClose={() => close(true)} title="Verify it's you">
      <p className="text-sm text-af2-ink-4 mb-4">
        This action requires a fresh second-factor check.
        {reason === "staff_requires_passkey"
          ? " AutoFlow staff endpoints require a passkey."
          : ""}
      </p>
      {error && (
        <div className="mb-3 rounded border border-af2-clay/30 bg-af2-clay-soft/30 px-3 py-2 text-sm text-af2-clay">
          {error}
        </div>
      )}
      {mode === "passkey" ? (
        <div className="space-y-3">
          <Af2Button variant="primary" onClick={handlePasskey} disabled={busy}>
            {busy ? "Waiting for device…" : "Use passkey"}
          </Af2Button>
          <button
            type="button"
            onClick={() => setMode("recovery")}
            className="block text-sm text-af2-ink-4 underline"
          >
            Use a recovery code instead
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Recovery code</span>
            <input
              type="text"
              autoComplete="off"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              className="w-full rounded border border-af2-line-2 px-3 py-2 font-mono"
              placeholder="XXXX-XXXX-XXXX-XXXX"
            />
          </label>
          <div className="flex gap-2">
            <Af2Button variant="primary" onClick={handleRecovery} disabled={busy}>
              Verify
            </Af2Button>
            {isWebauthnAvailable() && (
              <Af2Button variant="ghost" onClick={() => setMode("passkey")} disabled={busy}>
                Use passkey
              </Af2Button>
            )}
          </div>
        </div>
      )}
    </Af2Modal>
  );
}
