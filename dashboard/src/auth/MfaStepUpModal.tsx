/**
 * Global step-up modal (HEL-mfa).
 *
 * Listens for `autoflow:mfa:step-up-required` events emitted by API helpers
 * that detect a 401 with `mfa_step_up_required`. Pops a passkey challenge;
 * falls back to recovery code entry on click. On success, emits
 * `autoflow:mfa:step-up-satisfied` so awaiting callers can retry.
 *
 * HEL-282: also surfaces the email-OTP and magic-link fallbacks for whichever
 * the user has enrolled (fetched from `/api/mfa/policy` when the modal opens).
 */

import { useEffect, useState } from "react";
import { Af2Button, Af2Modal } from "../components/af2";
import { useAuth } from "../context/AuthContext";
import {
  challengeEmailOtp,
  challengeMagicLink,
  consumeRecoveryCode,
  getMfaPolicy,
  verifyEmailOtp,
  verifyTotpStepUp,
  type MfaPolicy,
} from "../api/mfaApi";
import { isWebauthnAvailable, verifyPasskey } from "./mfa";
import {
  STEP_UP_REQUIRED_EVENT,
  emitStepUpCancelled,
  emitStepUpSatisfied,
} from "./stepUpEvents";

type StepUpMode = "passkey" | "totp" | "recovery" | "email_otp" | "magic_link";

export function MfaStepUpModal() {
  const { requireAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<StepUpMode>("passkey");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [policy, setPolicy] = useState<MfaPolicy | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail ?? {};
      setReason(detail.reason);
      setError(null);
      setRecoveryCode("");
      setEmailCode("");
      setTotpCode("");
      setEmailSent(false);
      setLinkSent(false);
      setPolicy(null);
      setMode(isWebauthnAvailable() ? "passkey" : "recovery");
      setOpen(true);
    };
    window.addEventListener(STEP_UP_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(STEP_UP_REQUIRED_EVENT, handler);
  }, []);

  // Fetch the policy once the modal opens so we know which fallback methods to
  // offer. If it fails we silently keep the passkey/recovery defaults.
  useEffect(() => {
    if (!open || policy) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await requireAccessToken();
        const fetched = await getMfaPolicy(token);
        if (cancelled) return;
        setPolicy(fetched);
        // Prefer passkey; otherwise land on the first enrolled fallback.
        if (!isWebauthnAvailable()) {
          if (fetched.hasTotp) setMode("totp");
          else if (fetched.hasEmailOtp) setMode("email_otp");
          else if (fetched.hasMagicLink) setMode("magic_link");
          else setMode("recovery");
        }
      } catch {
        // Ignore — passkey/recovery remain available.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, policy, requireAccessToken]);

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

  async function handleVerifyTotp() {
    setError(null);
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await verifyTotpStepUp(token, totpCode.trim());
      emitStepUpSatisfied();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code rejected.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendEmailCode() {
    setError(null);
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await challengeEmailOtp(token);
      setEmailSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyEmailCode() {
    setError(null);
    if (!/^\d{6}$/.test(emailCode.trim())) {
      setError("Enter the 6-digit code we emailed you.");
      return;
    }
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await verifyEmailOtp(token, emailCode.trim());
      emitStepUpSatisfied();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code rejected.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMagicLink() {
    setError(null);
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await challengeMagicLink(token);
      setLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a link.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const showTotp = policy?.hasTotp ?? false;
  const showEmailOtp = policy?.hasEmailOtp ?? false;
  const showMagicLink = policy?.hasMagicLink ?? false;

  function switchTo(next: StepUpMode) {
    setError(null);
    setMode(next);
  }

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

      {mode === "passkey" && (
        <div className="space-y-3">
          <Af2Button variant="primary" onClick={handlePasskey} disabled={busy}>
            {busy ? "Waiting for device…" : "Use passkey"}
          </Af2Button>
        </div>
      )}

      {mode === "recovery" && (
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
          <Af2Button variant="primary" onClick={handleRecovery} disabled={busy}>
            Verify
          </Af2Button>
        </div>
      )}

      {mode === "totp" && (
        <div className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Authenticator code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              className="w-32 rounded border border-af2-line-2 px-3 py-2 text-center font-mono tracking-widest"
              placeholder="000000"
            />
          </label>
          <Af2Button variant="primary" onClick={handleVerifyTotp} disabled={busy}>
            {busy ? "Verifying…" : "Verify"}
          </Af2Button>
        </div>
      )}

      {mode === "email_otp" && (
        <div className="space-y-3">
          {!emailSent ? (
            <Af2Button variant="primary" onClick={handleSendEmailCode} disabled={busy}>
              {busy ? "Sending…" : "Email me a code"}
            </Af2Button>
          ) : (
            <>
              <label className="block">
                <span className="block text-sm font-medium mb-1">6-digit code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                  className="w-32 rounded border border-af2-line-2 px-3 py-2 text-center font-mono tracking-widest"
                  placeholder="000000"
                />
              </label>
              <div className="flex gap-2">
                <Af2Button variant="primary" onClick={handleVerifyEmailCode} disabled={busy}>
                  Verify
                </Af2Button>
                <Af2Button variant="ghost" onClick={handleSendEmailCode} disabled={busy}>
                  Resend
                </Af2Button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "magic_link" && (
        <div className="space-y-3">
          {!linkSent ? (
            <Af2Button variant="primary" onClick={handleSendMagicLink} disabled={busy}>
              {busy ? "Sending…" : "Email me a link"}
            </Af2Button>
          ) : (
            <>
              <p className="text-sm text-af2-ink-4">
                We emailed you a verification link. Open it on this device — once you do, retry your
                action.
              </p>
              <div className="flex gap-2">
                <Af2Button
                  variant="primary"
                  onClick={() => {
                    emitStepUpSatisfied();
                    setOpen(false);
                  }}
                  disabled={busy}
                >
                  I've clicked the link — retry
                </Af2Button>
                <Af2Button variant="ghost" onClick={handleSendMagicLink} disabled={busy}>
                  Resend
                </Af2Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Method switcher — only the methods the user actually has. */}
      <div className="mt-4 flex flex-wrap gap-3 border-t border-af2-line pt-3 text-sm">
        {mode !== "passkey" && isWebauthnAvailable() && (
          <button type="button" onClick={() => switchTo("passkey")} className="text-af2-ink-4 underline">
            Use passkey
          </button>
        )}
        {mode !== "totp" && showTotp && (
          <button type="button" onClick={() => switchTo("totp")} className="text-af2-ink-4 underline">
            Use authenticator app
          </button>
        )}
        {mode !== "email_otp" && showEmailOtp && (
          <button type="button" onClick={() => switchTo("email_otp")} className="text-af2-ink-4 underline">
            Use an email code
          </button>
        )}
        {mode !== "magic_link" && showMagicLink && (
          <button type="button" onClick={() => switchTo("magic_link")} className="text-af2-ink-4 underline">
            Email me a link
          </button>
        )}
        {mode !== "recovery" && (
          <button type="button" onClick={() => switchTo("recovery")} className="text-af2-ink-4 underline">
            Use a recovery code
          </button>
        )}
      </div>
    </Af2Modal>
  );
}
