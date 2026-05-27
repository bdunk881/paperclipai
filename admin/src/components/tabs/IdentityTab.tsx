import { useState } from "react";
import { apiRequest } from "../../lib/apiClient";
import { ReasonPrompt } from "../ReasonPrompt";

export function IdentityTab({ userId }: { userId: string }) {
  const [reset, setReset] = useState<{ link: string | null; email: string } | null>(null);
  const [mfa, setMfa] = useState<{ request_id: string; otp: string; expires_at: string } | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");

  return (
    <div className="card">
      <h2>Identity recovery</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <li className="field">
          <strong>Send password reset link.</strong>
          <p className="muted">
            Generates a Supabase recovery link. The admin DMs it to the user (or Supabase emails it).
          </p>
          <ReasonPrompt
            label="Generate reset link"
            className="primary"
            onConfirm={async (reason) => {
              const r = await apiRequest<{ link: string | null; email: string }>(
                `/api/admin-console/identity/${userId}/password-reset`,
                { method: "POST", body: { reason } },
              );
              setReset(r);
            }}
          />
          {reset && (
            <div className="banner" style={{ marginTop: ".5rem" }}>
              Link for <span className="code">{reset.email}</span>:
              <div className="code" style={{ wordBreak: "break-all", marginTop: ".25rem" }}>
                {reset.link ?? "(Supabase returned no link)"}
              </div>
            </div>
          )}
        </li>

        <li className="field">
          <strong>Revoke all sessions.</strong>
          <p className="muted">Forces the user to sign in again everywhere.</p>
          <ReasonPrompt
            label="Revoke sessions"
            className="danger"
            confirmLabel="Revoke"
            onConfirm={(reason) =>
              apiRequest(`/api/admin-console/identity/${userId}/revoke-sessions`, {
                method: "POST",
                body: { reason },
              })
            }
          />
        </li>

        <li className="field">
          <strong>Reset MFA (OTP confirmation).</strong>
          <p className="muted">
            Step 1: emails the user a 6-digit OTP and shows it to you below. Step 2: enter the OTP to wipe their
            factors. OTP expires in 15 minutes.
          </p>
          <ReasonPrompt
            label="Step 1 — Send OTP"
            className="primary"
            onConfirm={async (reason) => {
              const r = await apiRequest<{ request_id: string; otp: string; expires_at: string }>(
                `/api/admin-console/identity/${userId}/mfa-reset/request`,
                { method: "POST", body: { reason } },
              );
              setMfa(r);
              setMfaError(null);
            }}
          />
          {mfa && (
            <div className="banner" style={{ marginTop: ".5rem" }}>
              OTP: <span className="code">{mfa.otp}</span> · expires{" "}
              {new Date(mfa.expires_at).toLocaleTimeString()}
              <div className="row" style={{ marginTop: ".5rem" }}>
                <input
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="6-digit OTP"
                  style={{ width: 160 }}
                />
                <button
                  className="danger"
                  disabled={otpInput.length !== 6}
                  onClick={async () => {
                    setMfaError(null);
                    try {
                      await apiRequest(`/api/admin-console/identity/${userId}/mfa-reset/confirm`, {
                        method: "POST",
                        body: { otp: otpInput },
                      });
                      setMfa(null);
                      setOtpInput("");
                    } catch (err) {
                      setMfaError((err as Error).message);
                    }
                  }}
                >
                  Step 2 — Wipe factors
                </button>
              </div>
              {mfaError && <div className="banner danger" style={{ marginTop: ".5rem" }}>{mfaError}</div>}
            </div>
          )}
        </li>
      </ul>
    </div>
  );
}
