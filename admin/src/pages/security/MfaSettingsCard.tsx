import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMfaPolicy,
  regenerateRecoveryCodes,
  removeEmailOtp,
  removeMagicLink,
  removeTotpFactor,
  removeWebauthnCredential,
  type MfaPolicy,
} from "../../api/mfaApi";
import { registerPasskey } from "../../auth/mfa";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function MfaSettingsCard() {
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<MfaPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [regeneratedCodes, setRegeneratedCodes] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getMfaPolicy();
      setPolicy(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MFA settings.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAddPasskey() {
    setError(null);
    setBusy(true);
    try {
      await registerPasskey(newPasskeyName.trim() || "Passkey");
      setNewPasskeyName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey enrollment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePasskey(credentialId: string) {
    setError(null);
    setBusy(true);
    try {
      await removeWebauthnCredential(credentialId);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not remove passkey.";
      setError(
        message.includes("mfa_step_up_required")
          ? "Step-up authentication required. Verify your passkey first, then retry."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveTotp(factorId: string) {
    setError(null);
    setBusy(true);
    try {
      await removeTotpFactor(factorId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove authenticator.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveEmailOtp() {
    setError(null);
    setBusy(true);
    try {
      await removeEmailOtp();
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not remove email codes.";
      setError(
        message.includes("mfa_step_up_required")
          ? "Step-up authentication required. Verify your factor first, then retry."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMagicLink() {
    setError(null);
    setBusy(true);
    try {
      await removeMagicLink();
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not remove magic link.";
      setError(
        message.includes("mfa_step_up_required")
          ? "Step-up authentication required. Verify your factor first, then retry."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    setError(null);
    setBusy(true);
    try {
      const issued = await regenerateRecoveryCodes();
      setRegeneratedCodes(issued.codes);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not regenerate codes.";
      setError(
        message.includes("mfa_step_up_required")
          ? "Step-up authentication required. Verify your factor first, then retry."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!policy) {
    return (
      <div className="card">
        <span className="muted">Loading two-factor settings…</span>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Two-factor authentication</h2>
      <p className="muted">
        Phish-resistant passkeys keep your admin account safe even if your password leaks.
      </p>

      {error && (
        <div className="banner danger" style={{ marginTop: "0.75rem" }}>
          {error}
        </div>
      )}

      {!policy.hasAnyFactor && (
        <div className="banner danger" style={{ marginTop: "0.75rem" }}>
          You don't have any factors enrolled.{" "}
          <button type="button" className="link-button" onClick={() => navigate("/onboarding/mfa")}>
            Set up MFA now
          </button>
          .
        </div>
      )}

      <h3>Passkeys</h3>
      {policy.webauthnDevices.length === 0 ? (
        <p className="muted">No passkeys enrolled yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Added</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {policy.webauthnDevices.map((dev) => (
              <tr key={dev.credentialId}>
                <td>{dev.deviceName ?? "Unnamed passkey"}</td>
                <td>{formatDate(dev.createdAt)}</td>
                <td>{formatDate(dev.lastUsedAt)}</td>
                <td>
                  <button onClick={() => handleRemovePasskey(dev.credentialId)} disabled={busy}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <input
          type="text"
          value={newPasskeyName}
          onChange={(e) => setNewPasskeyName(e.target.value)}
          placeholder="e.g. Personal laptop"
          maxLength={120}
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={handleAddPasskey} disabled={busy}>
          Add passkey
        </button>
      </div>

      <h3 style={{ marginTop: "1.25rem" }}>Authenticator app (TOTP)</h3>
      {policy.hasTotp ? (
        <div className="row">
          <span>Authenticator app linked</span>
          <button onClick={() => handleRemoveTotp("totp")} disabled={busy}>
            Remove
          </button>
        </div>
      ) : (
        <button type="button" className="link-button" onClick={() => navigate("/onboarding/mfa")}>
          Add an authenticator app
        </button>
      )}

      <h3 style={{ marginTop: "1.25rem" }}>Email code (OTP)</h3>
      {policy.hasEmailOtp ? (
        <div className="row">
          <span>Email codes enabled</span>
          <button onClick={handleRemoveEmailOtp} disabled={busy}>
            Remove
          </button>
        </div>
      ) : (
        <button type="button" className="link-button" onClick={() => navigate("/onboarding/mfa")}>
          Add email codes
        </button>
      )}

      <h3 style={{ marginTop: "1.25rem" }}>Magic link</h3>
      {policy.hasMagicLink ? (
        <div className="row">
          <span>Magic link enabled</span>
          <button onClick={handleRemoveMagicLink} disabled={busy}>
            Remove
          </button>
        </div>
      ) : (
        <button type="button" className="link-button" onClick={() => navigate("/onboarding/mfa")}>
          Add magic link
        </button>
      )}

      <h3 style={{ marginTop: "1.25rem" }}>Recovery codes</h3>
      <p className="muted">
        {policy.hasRecoveryCodes
          ? `Last issued ${formatDate(policy.recoveryCodesIssuedAt)}. Generating new codes invalidates the old ones.`
          : "No active recovery codes. Generate a set so you can sign in if you lose your factor."}
      </p>
      <button onClick={handleRegenerate} disabled={busy || !policy.hasAnyFactor}>
        Generate new recovery codes
      </button>

      {regeneratedCodes && (
        <div style={{ marginTop: "0.75rem" }}>
          <p>
            <strong>Save these codes now — they won't be shown again.</strong>
          </p>
          <div className="recovery-grid">
            {regeneratedCodes.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
