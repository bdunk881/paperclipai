/**
 * MFA management card embedded in /settings/security (HEL-mfa).
 *
 * Shows enrolled passkeys + TOTP status. Lets the user:
 *   - Add another passkey (re-uses the wizard's registerPasskey flow inline).
 *   - Remove a passkey or TOTP factor (server requires AAL2 — surfaces a
 *     step-up modal if not satisfied).
 *   - Regenerate recovery codes (requires AAL2).
 *   - Jump to /onboarding/mfa for the full wizard flow.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, KeyRound, RefreshCw, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  getMfaPolicy,
  regenerateRecoveryCodes,
  removeTotpFactor,
  removeWebauthnCredential,
  type MfaPolicy,
} from "../../api/mfaApi";
import { registerPasskey } from "../../auth/mfa";
import { useAuth } from "../../context/AuthContext";

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
  const { requireAccessToken } = useAuth();
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<MfaPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [regeneratedCodes, setRegeneratedCodes] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const token = await requireAccessToken();
      const next = await getMfaPolicy(token);
      setPolicy(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MFA settings.");
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAddPasskey() {
    setError(null);
    setBusy(true);
    try {
      const token = await requireAccessToken();
      await registerPasskey(token, newPasskeyName.trim() || "Passkey");
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
      const token = await requireAccessToken();
      await removeWebauthnCredential(token, credentialId);
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
      const token = await requireAccessToken();
      await removeTotpFactor(token, factorId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove authenticator.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    setError(null);
    setBusy(true);
    try {
      const token = await requireAccessToken();
      const issued = await regenerateRecoveryCodes(token);
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
      <section className="rounded-xl border border-af2-line bg-af2-card p-6">
        <div className="flex items-center gap-3">
          <ShieldCheck size={17} className="text-af2-ink-4" />
          <span className="text-sm text-af2-ink-3">Loading two-factor settings…</span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-af2-line bg-af2-card p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg border border-af2-line bg-af2-paper">
          <ShieldCheck size={17} className="text-af2-sage" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-af2-ink">Two-factor authentication</h2>
          <p className="text-sm text-af2-ink-3">
            Phish-resistant passkeys keep your account safe even if your password leaks.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-af2-clay/30 bg-af2-clay-soft/30 px-3 py-2 text-sm text-af2-clay">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* HEL-280: split the no-factors banner by whether app MFA is
          required. Password users see urgent red; OAuth users (who are
          already 2FA-satisfied via the IdP) see a softer suggestion to
          add a passkey as a backup. */}
      {!policy.hasAnyFactor && policy.requiresAppMfa && (
        <div className="mb-4 rounded-lg border border-af2-clay/40 bg-af2-clay-soft/30 px-3 py-2 text-sm text-af2-clay">
          You don't have any factors enrolled.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => navigate("/onboarding/mfa")}
          >
            Set up MFA now
          </button>
          .
        </div>
      )}
      {!policy.hasAnyFactor &&
        !policy.requiresAppMfa &&
        (policy.signInMethod === "oauth_google" || policy.signInMethod === "oauth_github") && (
          <div className="mb-4 rounded-lg border border-af2-sage/40 bg-af2-sage/10 px-3 py-2 text-sm text-af2-ink-2">
            Your account is secured by{" "}
            <span className="font-medium">
              {policy.signInMethod === "oauth_google" ? "Google" : "GitHub"}
            </span>
            's two-factor authentication. Add a passkey to keep access if you lose your{" "}
            {policy.signInMethod === "oauth_google" ? "Google" : "GitHub"} account.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => navigate("/onboarding/mfa")}
            >
              Add a passkey
            </button>
            .
          </div>
        )}

      {/* Passkeys */}
      <div className="mb-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-af2-ink mb-2">
          <KeyRound size={14} /> Passkeys
        </h3>
        {policy.webauthnDevices.length === 0 ? (
          <p className="text-sm text-af2-ink-3 mb-3">No passkeys enrolled yet.</p>
        ) : (
          <ul className="mb-3 space-y-2">
            {policy.webauthnDevices.map((dev) => (
              <li
                key={dev.credentialId}
                className="flex items-center justify-between gap-3 rounded-lg border border-af2-line bg-af2-paper px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium text-af2-ink">{dev.deviceName ?? "Unnamed passkey"}</div>
                  <div className="text-xs text-af2-ink-3">
                    Added {formatDate(dev.createdAt)} · Last used {formatDate(dev.lastUsedAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemovePasskey(dev.credentialId)}
                  disabled={busy}
                  className="grid h-8 w-8 place-items-center rounded text-af2-ink-4 hover:bg-af2-paper-2"
                  aria-label="Remove passkey"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newPasskeyName}
            onChange={(e) => setNewPasskeyName(e.target.value)}
            placeholder="e.g. Personal laptop"
            maxLength={120}
            className="flex-1 rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleAddPasskey}
            disabled={busy}
            className="rounded-lg bg-af2-ink px-3 py-2 text-sm text-af2-paper disabled:opacity-50"
          >
            Add passkey
          </button>
        </div>
      </div>

      {/* TOTP */}
      <div className="mb-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-af2-ink mb-2">
          <Smartphone size={14} /> Authenticator app (TOTP)
        </h3>
        {policy.hasTotp ? (
          <div className="flex items-center justify-between rounded-lg border border-af2-line bg-af2-paper px-3 py-2 text-sm">
            <span className="text-af2-ink">Authenticator app linked</span>
            <button
              type="button"
              onClick={() => handleRemoveTotp("totp")}
              disabled={busy}
              className="text-xs text-af2-clay underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate("/onboarding/mfa")}
            className="text-sm text-af2-ink underline"
          >
            Add an authenticator app
          </button>
        )}
      </div>

      {/* Recovery codes */}
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-af2-ink mb-2">
          <RefreshCw size={14} /> Recovery codes
        </h3>
        <p className="text-sm text-af2-ink-3 mb-2">
          {policy.hasRecoveryCodes
            ? `Last issued ${formatDate(policy.recoveryCodesIssuedAt)}. Generating new codes invalidates the old ones.`
            : "No active recovery codes. Generate a set so you can log in if you lose your factor."}
        </p>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={busy || !policy.hasAnyFactor}
          className="rounded-lg border border-af2-line-2 px-3 py-2 text-sm hover:bg-af2-paper-2 disabled:opacity-50"
        >
          Generate new recovery codes
        </button>

        {regeneratedCodes && (
          <div className="mt-3 rounded-lg border border-af2-sage/30 bg-af2-sage/10 p-3">
            <div className="text-sm font-medium text-af2-ink mb-2">
              Save these codes now — they won't be shown again.
            </div>
            <div className="grid grid-cols-2 gap-1 font-mono text-xs">
              {regeneratedCodes.map((c) => (
                <div key={c}>{c}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
