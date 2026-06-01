/**
 * Headless MFA enrollment flow (HEL-281).
 *
 * Extracted from the original `MfaEnrollmentWizard` body so the same
 * three-step state machine (choose → enroll → recovery codes) can run
 * inside either:
 *   - the full-page `/onboarding/mfa` route, or
 *   - the global `<MfaEnrollmentSheet>` overlay introduced by HEL-281.
 *
 * No page chrome here — wrappers supply their own header/scrim/layout.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  KeyRound,
  Link2,
  Mail,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Af2Button, Af2Card, Af2H1 } from "../components/af2";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ToastProvider";
import {
  beginEmailOtpEnrollment,
  beginMagicLinkEnrollment,
  enrollTotp,
  getMfaPolicy,
  regenerateRecoveryCodes,
  verifyEmailOtpEnrollment,
  verifyTotpEnrollment,
  type TotpEnrollmentResponse,
} from "../api/mfaApi";
import {
  consumePasskeySignupIntent,
  isWebauthnAvailable,
  platformAuthenticatorAvailable,
  registerPasskey,
} from "./mfa";

type Step =
  | "choose"
  | "enroll-passkey"
  | "enroll-totp"
  | "enroll-email-otp"
  | "enroll-magic-link"
  | "recovery-codes";
type FactorChoice = "passkey" | "totp" | "email-otp" | "magic-link";

export interface MfaEnrollmentFlowProps {
  /**
   * Called once the user finishes enrolling AND acknowledges their
   * recovery codes. The caller decides what "finished" means — the page
   * navigates back to `state.from`, the sheet emits its completion event.
   */
  onComplete: () => void;
}

export function MfaEnrollmentFlow({ onComplete }: MfaEnrollmentFlowProps) {
  const { requireAccessToken } = useAuth();
  const toast = useToast();

  const [step, setStep] = useState<Step>("choose");
  const [factor, setFactor] = useState<FactorChoice | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollmentResponse | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);

  const webauthnAvailable = useMemo(() => isWebauthnAvailable(), []);

  useEffect(() => {
    void platformAuthenticatorAvailable().then(setPlatformAvailable);
  }, []);

  // HEL-390: when the user arrived here straight from passkey sign-up (clicked
  // the email link, now signed in but factorless), skip the factor chooser and
  // drop them on the passkey step — that's the factor they came to create.
  // Consumed once; if they're on a device without WebAuthn we leave the chooser.
  useEffect(() => {
    if (!webauthnAvailable) return;
    if (consumePasskeySignupIntent()) {
      setFactor("passkey");
      setDeviceName((prev) => prev || "This device");
      setStep("enroll-passkey");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webauthnAvailable]);

  function clearError() {
    setError(null);
  }

  async function handleChoose(choice: FactorChoice) {
    clearError();
    setFactor(choice);
    if (choice === "passkey") {
      const defaultName = platformAvailable ? "This device" : "Security key";
      setDeviceName(defaultName);
      setStep("enroll-passkey");
      return;
    }
    if (choice === "totp") {
      setStep("enroll-totp");
      setBusy(true);
      try {
        const token = await requireAccessToken();
        const enrolled = await enrollTotp(token, "AutoFlow authenticator");
        setTotpEnrollment(enrolled);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start TOTP enrollment.");
        setStep("choose");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (choice === "email-otp") {
      setEmailOtpCode("");
      setStep("enroll-email-otp");
      setBusy(true);
      try {
        const token = await requireAccessToken();
        await beginEmailOtpEnrollment(token);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send a verification code.");
        setStep("choose");
      } finally {
        setBusy(false);
      }
      return;
    }
    // magic-link
    setStep("enroll-magic-link");
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await beginMagicLinkEnrollment(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a verification link.");
      setStep("choose");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyEmailOtp() {
    clearError();
    if (!/^\d{6}$/.test(emailOtpCode.trim())) {
      setError("Enter the 6-digit code we emailed you.");
      return;
    }
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await verifyEmailOtpEnrollment(token, emailOtpCode.trim());
      await issueAndShowRecoveryCodes(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResendEmailOtp() {
    clearError();
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await beginEmailOtpEnrollment(token);
      toast.success("We sent a new code to your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMagicLinkContinue() {
    clearError();
    setBusy(true);
    try {
      const token = await requireAccessToken();
      // The link click verifies out-of-band; re-fetch policy to confirm.
      const policy = await getMfaPolicy(token);
      if (!policy.hasMagicLink) {
        setError("We haven't seen the link clicked yet. Open the email and click the link, then try again.");
        return;
      }
      await issueAndShowRecoveryCodes(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm verification.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResendMagicLink() {
    clearError();
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await beginMagicLinkEnrollment(token);
      toast.success("We sent a new link to your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnrollPasskey() {
    clearError();
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await registerPasskey(token, deviceName.trim() || "Passkey");
      await issueAndShowRecoveryCodes(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey enrollment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyTotp() {
    if (!totpEnrollment) return;
    clearError();
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError("Enter the 6-digit code from your authenticator.");
      return;
    }
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await verifyTotpEnrollment(token, totpEnrollment.factorId, totpCode.trim());
      await issueAndShowRecoveryCodes(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "TOTP verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function issueAndShowRecoveryCodes(token: string) {
    const issued = await regenerateRecoveryCodes(token);
    setRecoveryCodes(issued.codes);
    setStep("recovery-codes");
  }

  function copyRecoveryCodes() {
    const text = recoveryCodes.join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      toast.success("Recovery codes copied to clipboard.");
    });
  }

  function downloadRecoveryCodes() {
    const text =
      `AutoFlow recovery codes\n` +
      `Generated ${new Date().toISOString()}\n\n` +
      `Each code can be used once if you lose access to your MFA factor.\n\n` +
      recoveryCodes.map((code) => `  ${code}`).join("\n") +
      "\n";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "autoflow-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleFinish() {
    if (!recoveryAcknowledged) {
      setError("Please confirm you've saved your recovery codes before continuing.");
      return;
    }
    onComplete();
  }

  return (
    <>
      {error && (
        <Af2Card className="mb-4 border-af2-rust">
          <div className="flex items-start gap-2 text-af2-rust">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        </Af2Card>
      )}

      {step === "choose" && (
        <ChooseFactor
          webauthnAvailable={webauthnAvailable}
          platformAvailable={platformAvailable}
          onChoose={handleChoose}
        />
      )}

      {step === "enroll-passkey" && (
        <Af2Card>
          <Af2H1 className="mb-2">Add a passkey</Af2H1>
          <p className="text-af2-ink-4 mb-4">
            You'll be prompted by your browser to use Touch ID, Windows Hello, or a security key.
          </p>
          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1">Name this device</span>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="af2-input w-full"
              placeholder="e.g. Work laptop"
              maxLength={120}
            />
          </label>
          <div className="flex gap-2">
            <Af2Button variant="primary" onClick={handleEnrollPasskey} disabled={busy}>
              {busy ? "Waiting for device…" : "Create passkey"}
            </Af2Button>
            <Af2Button variant="ghost" onClick={() => setStep("choose")} disabled={busy}>
              Back
            </Af2Button>
          </div>
        </Af2Card>
      )}

      {step === "enroll-totp" && totpEnrollment && (
        <Af2Card>
          <Af2H1 className="mb-2">Scan with your authenticator app</Af2H1>
          <p className="text-af2-ink-4 mb-4">
            Use 1Password, Authy, Google Authenticator, or any TOTP app. Then enter the 6-digit code.
          </p>
          <div className="flex flex-col md:flex-row gap-6 items-start mb-4">
            <TotpQr value={totpEnrollment.qrCodeSvg} />
            <div className="text-sm text-af2-ink-4">
              {totpEnrollment.secret ? (
                <>
                  <p className="mb-2">Can't scan? Enter this setup key manually:</p>
                  <code className="bg-af2-paper-2 px-2 py-1 rounded break-all">
                    {totpEnrollment.secret}
                  </code>
                </>
              ) : (
                <p className="text-af2-rust">
                  Couldn't load the authenticator setup key. Go Back and try again — if it keeps
                  happening, an unfinished setup may be stuck on your account.
                </p>
              )}
            </div>
          </div>
          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1">6-digit code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              className="af2-input w-32 text-center font-mono tracking-widest"
              placeholder="000000"
            />
          </label>
          <div className="flex gap-2">
            <Af2Button variant="primary" onClick={handleVerifyTotp} disabled={busy}>
              {busy ? "Verifying…" : "Verify & continue"}
            </Af2Button>
            <Af2Button variant="ghost" onClick={() => setStep("choose")} disabled={busy}>
              Back
            </Af2Button>
          </div>
        </Af2Card>
      )}

      {step === "enroll-email-otp" && (
        <Af2Card>
          <Af2H1 className="mb-2">Enter your email code</Af2H1>
          <p className="text-af2-ink-4 mb-4">
            We emailed you a 6-digit code. It expires in 5 minutes. Enter it below to finish setting
            up email codes as your second factor.
          </p>
          <label className="block mb-4">
            <span className="block text-sm font-medium mb-1">6-digit code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={emailOtpCode}
              onChange={(e) => setEmailOtpCode(e.target.value.replace(/\D/g, ""))}
              className="af2-input w-32 text-center font-mono tracking-widest"
              placeholder="000000"
            />
          </label>
          <div className="flex gap-2">
            <Af2Button variant="primary" onClick={handleVerifyEmailOtp} disabled={busy}>
              {busy ? "Verifying…" : "Verify & continue"}
            </Af2Button>
            <Af2Button variant="ghost" onClick={handleResendEmailOtp} disabled={busy}>
              Resend code
            </Af2Button>
            <Af2Button variant="ghost" onClick={() => setStep("choose")} disabled={busy}>
              Back
            </Af2Button>
          </div>
        </Af2Card>
      )}

      {step === "enroll-magic-link" && (
        <Af2Card>
          <Af2H1 className="mb-2">Check your email</Af2H1>
          <p className="text-af2-ink-4 mb-4">
            We emailed you a one-click verification link. It expires in 5 minutes and can be used
            once. Open it on this device, then come back and continue.
          </p>
          <div className="flex gap-2">
            <Af2Button variant="primary" onClick={handleMagicLinkContinue} disabled={busy}>
              {busy ? "Checking…" : "I've clicked the link — continue"}
            </Af2Button>
            <Af2Button variant="ghost" onClick={handleResendMagicLink} disabled={busy}>
              Resend link
            </Af2Button>
            <Af2Button variant="ghost" onClick={() => setStep("choose")} disabled={busy}>
              Back
            </Af2Button>
          </div>
        </Af2Card>
      )}

      {step === "recovery-codes" && (
        <Af2Card>
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={20} className="text-af2-sage" />
            <Af2H1>Save your recovery codes</Af2H1>
          </div>
          <p className="text-af2-ink-4 mb-4">
            Each code can be used <strong>once</strong> if you lose access to your{" "}
            {factor === "passkey"
              ? "passkey"
              : factor === "totp"
                ? "authenticator app"
                : "email"}
            . Store them somewhere safe — we won't show them again.
          </p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-af2-paper-2 p-4 rounded mb-4">
            {recoveryCodes.map((code) => (
              <div key={code}>{code}</div>
            ))}
          </div>
          <div className="flex gap-2 mb-4">
            <Af2Button variant="secondary" onClick={copyRecoveryCodes}>
              <ClipboardCopy size={16} className="mr-1" /> Copy
            </Af2Button>
            <Af2Button variant="secondary" onClick={downloadRecoveryCodes}>
              Download .txt
            </Af2Button>
          </div>
          <label className="flex items-start gap-2 mb-4">
            <input
              type="checkbox"
              checked={recoveryAcknowledged}
              onChange={(e) => setRecoveryAcknowledged(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              I've saved these codes somewhere secure (password manager, encrypted note, or printed).
            </span>
          </label>
          <Af2Button variant="primary" onClick={handleFinish} disabled={!recoveryAcknowledged}>
            Continue to AutoFlow
          </Af2Button>
        </Af2Card>
      )}
    </>
  );
}

/**
 * HEL-327: render the TOTP QR robustly across gotrue formats. `qr_code`
 * comes back as a data-URL (Supabase's documented `<img src>` form),
 * occasionally as raw inline `<svg>`, and — when the enroll response has
 * no usable totp block — empty. Previously this was always injected via
 * dangerouslySetInnerHTML, so a data-URL rendered as text and an empty
 * value rendered as a silent blank box.
 */
function TotpQr({ value }: { value: string }) {
  const v = (value ?? "").trim();
  const boxClass = "bg-white p-2 rounded border border-af2-edge";
  if (v.startsWith("data:") || v.startsWith("http")) {
    return <img src={v} alt="Authenticator QR code" width={200} height={200} className={boxClass} />;
  }
  if (v.includes("<svg")) {
    const svg = v.slice(v.indexOf("<svg"));
    return <div className={boxClass} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return (
    <div className="max-w-[220px] rounded border border-af2-edge bg-af2-paper-2 p-3 text-sm text-af2-ink-4">
      QR code unavailable — use the setup key to add this account to your authenticator app manually.
    </div>
  );
}

interface ChooseFactorProps {
  webauthnAvailable: boolean;
  platformAvailable: boolean;
  onChoose: (choice: FactorChoice) => void;
}

function ChooseFactor({ webauthnAvailable, platformAvailable, onChoose }: ChooseFactorProps) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <button
        type="button"
        disabled={!webauthnAvailable}
        onClick={() => onChoose("passkey")}
        className={`af2-card text-left cursor-pointer transition hover:border-af2-ink-3 disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={20} className="text-af2-sage" />
          <h2 className="text-lg font-semibold">Passkey</h2>
          <span className="text-xs bg-af2-sage text-af2-paper px-2 py-0.5 rounded-full">
            Recommended
          </span>
        </div>
        <p className="text-sm text-af2-ink-4 mb-3">
          Phish-resistant. Uses Touch ID, Windows Hello, or a hardware security key. Origin-bound —
          attackers can't relay the credential to a fake site.
        </p>
        {!webauthnAvailable && (
          <p className="text-xs text-af2-rust">
            This browser or connection doesn't support passkeys. Open AutoFlow on a secure (HTTPS)
            origin in a modern browser.
          </p>
        )}
        {webauthnAvailable && platformAvailable && (
          <p className="text-xs text-af2-ink-3">Your device can use the built-in authenticator.</p>
        )}
      </button>

      <button
        type="button"
        onClick={() => onChoose("totp")}
        className="af2-card text-left cursor-pointer transition hover:border-af2-ink-3"
      >
        <div className="flex items-center gap-2 mb-2">
          <Smartphone size={20} className="text-af2-ink-4" />
          <h2 className="text-lg font-semibold">Authenticator app (TOTP)</h2>
        </div>
        <p className="text-sm text-af2-ink-4">
          Pair AutoFlow with 1Password, Authy, Google Authenticator, etc. Less phish-resistant than
          a passkey — use only if you can't use a passkey.
        </p>
        <div className="flex items-center gap-1 mt-2 text-xs text-af2-ink-3">
          <KeyRound size={14} />
          Allowed for end-users, not for AutoFlow staff.
        </div>
      </button>

      <button
        type="button"
        onClick={() => onChoose("email-otp")}
        className="af2-card text-left cursor-pointer transition hover:border-af2-ink-3"
      >
        <div className="flex items-center gap-2 mb-2">
          <Mail size={20} className="text-af2-ink-4" />
          <h2 className="text-lg font-semibold">Email code (OTP)</h2>
        </div>
        <p className="text-sm text-af2-ink-4">
          We'll email a 6-digit code each time we need to verify it's you. Less phish-resistant than
          a passkey — use only if you can't use a passkey.
        </p>
        <div className="flex items-center gap-1 mt-2 text-xs text-af2-ink-3">
          <KeyRound size={14} />
          Allowed for end-users, not for AutoFlow staff.
        </div>
      </button>

      <button
        type="button"
        onClick={() => onChoose("magic-link")}
        className="af2-card text-left cursor-pointer transition hover:border-af2-ink-3"
      >
        <div className="flex items-center gap-2 mb-2">
          <Link2 size={20} className="text-af2-ink-4" />
          <h2 className="text-lg font-semibold">Magic link</h2>
        </div>
        <p className="text-sm text-af2-ink-4">
          We'll email a one-click verification link each time we need to verify it's you. Less
          phish-resistant than a passkey — use only if you can't use a passkey.
        </p>
        <div className="flex items-center gap-1 mt-2 text-xs text-af2-ink-3">
          <KeyRound size={14} />
          Allowed for end-users, not for AutoFlow staff.
        </div>
      </button>
    </div>
  );
}
