import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  enrollTotp,
  regenerateRecoveryCodes,
  verifyTotpEnrollment,
  type TotpEnrollmentResponse,
} from "../api/mfaApi";
import { isWebauthnAvailable, platformAuthenticatorAvailable, registerPasskey } from "../auth/mfa";

type Step = "choose" | "enroll-passkey" | "enroll-totp" | "recovery-codes";
type FactorChoice = "passkey" | "totp";

interface LocationState {
  from?: string;
}

export default function MfaEnrollmentWizard() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromUrl = (location.state as LocationState | null)?.from ?? "/";

  const [step, setStep] = useState<Step>("choose");
  const [factor, setFactor] = useState<FactorChoice | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollmentResponse | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);

  const webauthnAvailable = useMemo(() => isWebauthnAvailable(), []);

  useEffect(() => {
    void platformAuthenticatorAvailable().then(setPlatformAvailable);
  }, []);

  async function handleChoose(choice: FactorChoice) {
    setError(null);
    setFactor(choice);
    if (choice === "passkey") {
      setDeviceName(platformAvailable ? "This device" : "Security key");
      setStep("enroll-passkey");
      return;
    }
    setStep("enroll-totp");
    setBusy(true);
    try {
      const enrolled = await enrollTotp("AutoFlow Admin authenticator");
      setTotpEnrollment(enrolled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start TOTP enrollment.");
      setStep("choose");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnrollPasskey() {
    setError(null);
    setBusy(true);
    try {
      await registerPasskey(deviceName.trim() || "Passkey");
      await issueAndShowRecoveryCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey enrollment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyTotp() {
    if (!totpEnrollment) return;
    setError(null);
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError("Enter the 6-digit code from your authenticator.");
      return;
    }
    setBusy(true);
    try {
      await verifyTotpEnrollment(totpEnrollment.factorId, totpCode.trim());
      await issueAndShowRecoveryCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "TOTP verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function issueAndShowRecoveryCodes() {
    const issued = await regenerateRecoveryCodes();
    setRecoveryCodes(issued.codes);
    setStep("recovery-codes");
  }

  function copyRecoveryCodes() {
    void navigator.clipboard.writeText(recoveryCodes.join("\n"));
  }

  function downloadRecoveryCodes() {
    const text =
      `AutoFlow Admin recovery codes\n` +
      `Generated ${new Date().toISOString()}\n\n` +
      `Each code can be used once if you lose access to your MFA factor.\n\n` +
      recoveryCodes.map((code) => `  ${code}`).join("\n") +
      "\n";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "autoflow-admin-recovery-codes.txt";
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
    navigate(fromUrl, { replace: true });
  }

  return (
    <div className="card" style={{ maxWidth: 640, margin: "1.5rem auto" }}>
      <h2>Set up two-factor authentication</h2>
      <p className="muted">
        The AutoFlow admin console requires a phish-resistant second factor. Use a passkey
        (recommended) or an authenticator app, then save your recovery codes.
      </p>

      {error && (
        <div className="banner danger" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {step === "choose" && (
        <div className="factor-grid">
          <button
            type="button"
            className="factor-card"
            disabled={!webauthnAvailable}
            onClick={() => handleChoose("passkey")}
          >
            <h3>Passkey (recommended)</h3>
            <p className="muted">
              Phish-resistant. Uses Touch ID, Windows Hello, or a hardware security key.
              Origin-bound — attackers can't relay the credential to a fake site.
            </p>
            {!webauthnAvailable && (
              <p className="muted" style={{ color: "#6a1d1a" }}>
                This browser or connection doesn't support passkeys. Open the admin console on a
                secure (HTTPS) origin.
              </p>
            )}
            {webauthnAvailable && platformAvailable && (
              <p className="muted">Your device can use the built-in authenticator.</p>
            )}
          </button>

          <button type="button" className="factor-card" onClick={() => handleChoose("totp")}>
            <h3>Authenticator app (TOTP)</h3>
            <p className="muted">
              Pair the admin console with 1Password, Authy, Google Authenticator, etc. Less
              phish-resistant than a passkey — use only if you can't use a passkey.
            </p>
          </button>
        </div>
      )}

      {step === "enroll-passkey" && (
        <div>
          <h3>Add a passkey</h3>
          <p className="muted">
            You'll be prompted by your browser to use Touch ID, Windows Hello, or a security key.
          </p>
          <div className="field">
            <label htmlFor="passkey-name">Name this device</label>
            <input
              id="passkey-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. Work laptop"
              maxLength={120}
            />
          </div>
          <div className="row">
            <button className="primary" onClick={handleEnrollPasskey} disabled={busy}>
              {busy ? "Waiting for device…" : "Create passkey"}
            </button>
            <button onClick={() => setStep("choose")} disabled={busy}>
              Back
            </button>
          </div>
        </div>
      )}

      {step === "enroll-totp" && totpEnrollment && (
        <div>
          <h3>Scan with your authenticator app</h3>
          <p className="muted">
            Use 1Password, Authy, Google Authenticator, or any TOTP app. Then enter the 6-digit
            code.
          </p>
          <div
            className="row"
            style={{ alignItems: "flex-start", gap: "1.5rem", marginBottom: "1rem" }}
          >
            <TotpQr value={totpEnrollment.qrCodeSvg} />
            <div className="muted">
              {totpEnrollment.secret ? (
                <>
                  <p>Can't scan? Enter this setup key manually:</p>
                  <code className="code">{totpEnrollment.secret}</code>
                </>
              ) : (
                <p style={{ color: "#6a1d1a" }}>
                  Couldn't load the authenticator setup key. Go Back and try again — if it keeps
                  happening, an unfinished setup may be stuck on your account.
                </p>
              )}
            </div>
          </div>
          <div className="field" style={{ maxWidth: 160 }}>
            <label htmlFor="totp-code">6-digit code</label>
            <input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />
          </div>
          <div className="row">
            <button className="primary" onClick={handleVerifyTotp} disabled={busy}>
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <button onClick={() => setStep("choose")} disabled={busy}>
              Back
            </button>
          </div>
        </div>
      )}

      {step === "recovery-codes" && (
        <div>
          <h3>Save your recovery codes</h3>
          <p className="muted">
            Each code can be used <strong>once</strong> if you lose access to your{" "}
            {factor === "passkey" ? "passkey" : "authenticator app"}. Store them somewhere safe —
            we won't show them again.
          </p>
          <div className="recovery-grid">
            {recoveryCodes.map((code) => (
              <div key={code}>{code}</div>
            ))}
          </div>
          <div className="row" style={{ margin: "0.75rem 0" }}>
            <button onClick={copyRecoveryCodes}>Copy</button>
            <button onClick={downloadRecoveryCodes}>Download .txt</button>
          </div>
          <label className="row" style={{ alignItems: "flex-start", marginBottom: "1rem" }}>
            <input
              type="checkbox"
              checked={recoveryAcknowledged}
              onChange={(e) => setRecoveryAcknowledged(e.target.checked)}
              style={{ width: "auto", marginTop: 4 }}
            />
            <span>
              I've saved these codes somewhere secure (password manager, encrypted note, or
              printed).
            </span>
          </label>
          <button className="primary" onClick={handleFinish} disabled={!recoveryAcknowledged}>
            Continue to the admin console
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * HEL-327: render the TOTP QR robustly across gotrue formats. `qr_code`
 * is usually a data-URL (Supabase's documented `<img src>` form),
 * sometimes raw inline `<svg>`, and empty when the enroll response has no
 * usable totp block. The old code always injected it via
 * dangerouslySetInnerHTML, so a data-URL showed as text and an empty
 * value showed as a silent blank box.
 */
function TotpQr({ value }: { value: string }) {
  const v = (value ?? "").trim();
  const boxStyle = { background: "#fff", padding: "0.5rem", border: "1px solid #e6e8eb" } as const;
  if (v.startsWith("data:") || v.startsWith("http")) {
    return <img src={v} alt="Authenticator QR code" width={200} height={200} style={boxStyle} />;
  }
  if (v.includes("<svg")) {
    const svg = v.slice(v.indexOf("<svg"));
    return <div style={boxStyle} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return (
    <div className="muted" style={{ maxWidth: 220, padding: "0.75rem", border: "1px solid #e6e8eb" }}>
      QR code unavailable — use the setup key to add this account to your authenticator app manually.
    </div>
  );
}
