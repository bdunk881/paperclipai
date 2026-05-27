import { useEffect, useState, type ReactNode } from "react";
import { getSupabaseClient } from "../lib/supabase";

/**
 * Hard gate: every action in the admin app requires AAL2 (MFA-elevated JWT).
 * If the user has no enrolled factors, render an enrollment flow. If they
 * have factors but the current session is AAL1, prompt for a challenge.
 */
export function MfaGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok" }
    | { kind: "enroll" }
    | { kind: "challenge"; factorId: string }
    | { kind: "error"; error: string }
  >({ kind: "loading" });

  async function refresh() {
    setState({ kind: "loading" });
    try {
      const supa = getSupabaseClient();
      const { data: aal } = await supa.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        setState({ kind: "ok" });
        return;
      }
      const { data: factors } = await supa.auth.mfa.listFactors();
      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (!verified) {
        setState({ kind: "enroll" });
        return;
      }
      setState({ kind: "challenge", factorId: verified.id });
    } catch (err) {
      setState({ kind: "error", error: (err as Error).message });
    }
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  if (state.kind === "loading") return <div className="muted">Checking MFA…</div>;
  if (state.kind === "ok") return <>{children}</>;
  if (state.kind === "error")
    return (
      <div className="card">
        <h2>MFA check failed</h2>
        <p className="muted">{state.error}</p>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  if (state.kind === "enroll") return <EnrollMfa onEnrolled={refresh} />;
  return <Challenge factorId={state.factorId} onVerified={refresh} />;
}

function EnrollMfa({ onEnrolled }: { onEnrolled: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const supa = getSupabaseClient();
      const { data, error } = await supa.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) throw error ?? new Error("enroll failed");
      setFactorId(data.id);
      setQr(data.totp?.qr_code ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      const supa = getSupabaseClient();
      const { data: challenge, error: cErr } = await supa.auth.mfa.challenge({ factorId });
      if (cErr || !challenge) throw cErr ?? new Error("challenge failed");
      const { error: vErr } = await supa.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) throw vErr;
      onEnrolled();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="card" style={{ maxWidth: 480, margin: "2rem auto" }}>
        <h2>Enroll a TOTP factor</h2>
        <p className="muted">
          MFA is required for the admin console. Scan the QR code with your
          authenticator app (1Password, Authy, Google Authenticator), then enter
          the 6-digit code to confirm.
        </p>
        {!qr ? (
          <button className="primary" onClick={start} disabled={busy}>
            Start enrollment
          </button>
        ) : (
          <>
            <img src={qr} alt="MFA QR code" style={{ width: 192, height: 192 }} />
            <div className="field">
              <label htmlFor="code">Verification code</label>
              <input
                id="code"
                value={code}
                inputMode="numeric"
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              />
            </div>
            <button className="primary" onClick={verify} disabled={busy || code.length !== 6}>
              Verify
            </button>
          </>
        )}
        {error && (
          <div className="banner danger" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}
      </div>
    </main>
  );
}

function Challenge({ factorId, onVerified }: { factorId: string; onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const supa = getSupabaseClient();
      const { data: challenge, error: cErr } = await supa.auth.mfa.challenge({ factorId });
      if (cErr || !challenge) throw cErr ?? new Error("challenge failed");
      const { error: vErr } = await supa.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) throw vErr;
      onVerified();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="card" style={{ maxWidth: 380, margin: "2rem auto" }}>
        <h2>Verify MFA</h2>
        <p className="muted">Enter the 6-digit code from your authenticator app.</p>
        <div className="field">
          <input
            value={code}
            inputMode="numeric"
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            autoFocus
          />
        </div>
        <button className="primary" onClick={verify} disabled={busy || code.length !== 6}>
          Verify
        </button>
        {error && (
          <div className="banner danger" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
