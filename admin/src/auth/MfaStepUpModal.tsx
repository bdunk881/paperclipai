import { useEffect, useState } from "react";
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
        const fetched = await getMfaPolicy();
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
  }, [open, policy]);

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

  async function handleVerifyTotp() {
    setError(null);
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      await verifyTotpStepUp(totpCode.trim());
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
      await challengeEmailOtp();
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
      await verifyEmailOtp(emailCode.trim());
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
      await challengeMagicLink();
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

        {mode === "passkey" && (
          <div className="stack">
            <button className="primary" onClick={handlePasskey} disabled={busy}>
              {busy ? "Waiting for device…" : "Use passkey"}
            </button>
          </div>
        )}

        {mode === "recovery" && (
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
            <button className="primary" onClick={handleRecovery} disabled={busy}>
              Verify
            </button>
          </div>
        )}

        {mode === "totp" && (
          <div className="stack">
            <div className="field">
              <label htmlFor="stepup-totp">Authenticator code</label>
              <input
                id="stepup-totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
            </div>
            <button className="primary" onClick={handleVerifyTotp} disabled={busy}>
              {busy ? "Verifying…" : "Verify"}
            </button>
          </div>
        )}

        {mode === "email_otp" && (
          <div className="stack">
            {!emailSent ? (
              <button className="primary" onClick={handleSendEmailCode} disabled={busy}>
                {busy ? "Sending…" : "Email me a code"}
              </button>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="stepup-email-otp">6-digit code</label>
                  <input
                    id="stepup-email-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                  />
                </div>
                <div className="row">
                  <button className="primary" onClick={handleVerifyEmailCode} disabled={busy}>
                    Verify
                  </button>
                  <button type="button" onClick={handleSendEmailCode} disabled={busy}>
                    Resend
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {mode === "magic_link" && (
          <div className="stack">
            {!linkSent ? (
              <button className="primary" onClick={handleSendMagicLink} disabled={busy}>
                {busy ? "Sending…" : "Email me a link"}
              </button>
            ) : (
              <>
                <p className="muted">
                  We emailed you a verification link. Open it on this device — once you do, retry
                  your action.
                </p>
                <div className="row">
                  <button
                    className="primary"
                    onClick={() => {
                      emitStepUpSatisfied();
                      setOpen(false);
                    }}
                    disabled={busy}
                  >
                    I've clicked the link — retry
                  </button>
                  <button type="button" onClick={handleSendMagicLink} disabled={busy}>
                    Resend
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Method switcher — only the methods the user actually has. */}
        <div className="row" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
          {mode !== "passkey" && isWebauthnAvailable() && (
            <button type="button" className="link-button" onClick={() => switchTo("passkey")}>
              Use passkey
            </button>
          )}
          {mode !== "totp" && showTotp && (
            <button type="button" className="link-button" onClick={() => switchTo("totp")}>
              Use authenticator app
            </button>
          )}
          {mode !== "email_otp" && showEmailOtp && (
            <button type="button" className="link-button" onClick={() => switchTo("email_otp")}>
              Use an email code
            </button>
          )}
          {mode !== "magic_link" && showMagicLink && (
            <button type="button" className="link-button" onClick={() => switchTo("magic_link")}>
              Email me a link
            </button>
          )}
          {mode !== "recovery" && (
            <button type="button" className="link-button" onClick={() => switchTo("recovery")}>
              Use a recovery code
            </button>
          )}
          <button type="button" onClick={() => close(true)} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
