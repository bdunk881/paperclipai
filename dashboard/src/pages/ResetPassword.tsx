import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { writeStoredAuthUser, type StoredAuthUser } from "../auth/authStorage";
import {
  aalStepUpRequired,
  getSupabaseAalStatus,
  getSupabaseClient,
  getSupabaseStoredSession,
  isPasswordRecoveryFlow,
  isSupabaseAuthConfigured,
  mapSupabaseAuthError,
  sendSupabasePasswordReset,
  sessionFromSupabaseSession,
  updateSupabasePassword,
  verifySupabaseTotpStepUp,
  type SupabaseTotpFactor,
} from "../auth/supabaseAuth";
import {
  challengeEmailOtp,
  challengeMagicLink,
  getMfaPolicy,
  resetPasswordWithAttestation,
  resetPasswordWithRecoveryCode,
  verifyEmailOtp,
} from "../api/mfaApi";
import { isWebauthnAvailable, verifyPasskey } from "../auth/mfa";
import { useAuthCooldown } from "../auth/useAuthCooldown";

type StepUpMethod = "passkey" | "totp" | "email_otp" | "magic_link" | "recovery";

const PASSWORD_RESET_COOLDOWN_KEY = "autoflow.auth.passwordResetCooldown";

type ResetPhase = "loading" | "request" | "complete";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authError = searchParams.get("authError");

  const [phase, setPhase] = useState<ResetPhase>("loading");
  const [requestEmail, setRequestEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpFactor, setTotpFactor] = useState<SupabaseTotpFactor | null>(null);
  // MFA step-up state for the recovery flow. `stepUpRequired` is true when the
  // account has a verified native factor, so gotrue blocks the aal1 password
  // update. `stepUpMethod` selects how the user proves the second factor:
  // a passkey (preferred when available), the authenticator app, or a saved
  // recovery code (for a lost device / no usable TOTP).
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [stepUpMethod, setStepUpMethod] = useState<StepUpMethod>("totp");
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [hasEmailOtp, setHasEmailOtp] = useState(false);
  const [hasMagicLink, setHasMagicLink] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    authError ? decodeURIComponent(authError.replace(/\+/g, " ")) : "",
  );
  const [notice, setNotice] = useState("");

  const resetCooldown = useAuthCooldown(PASSWORD_RESET_COOLDOWN_KEY);

  const configured = isSupabaseAuthConfigured();

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setPhase("request");
      return;
    }

    let active = true;

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (!active) {
        return;
      }
      if (event === "PASSWORD_RECOVERY") {
        setPhase("complete");
        setError("");
      }
    });

    void (async () => {
      try {
        const recoveryFromUrl = isPasswordRecoveryFlow();
        const hadAuthCode =
          typeof window !== "undefined" &&
          Boolean(new URLSearchParams(window.location.search).get("code"));

        await getSupabaseStoredSession();
        if (!active) {
          return;
        }

        if (recoveryFromUrl || hadAuthCode) {
          setPhase("complete");
          return;
        }

        setPhase("request");
      } catch (bootstrapError) {
        if (!active) {
          return;
        }
        setError(mapSupabaseAuthError(bootstrapError));
        setPhase("request");
      }
    })();

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Once the recovery session exists, find out whether MFA forces an aal2
  // step-up before `updateUser({ password })` will be accepted. A recovery
  // session lands at aal1; if the account has a verified factor we offer a
  // step-up *before* changing the password instead of hitting gotrue's "AAL2
  // session is required" error. Preferred method: passkey (phishing-resistant)
  // → authenticator app → recovery code (lost device / no usable TOTP).
  useEffect(() => {
    if (phase !== "complete" || !configured) {
      return;
    }

    let active = true;
    void (async () => {
      try {
        const status = await getSupabaseAalStatus();
        if (!active) {
          return;
        }
        const needsStepUp = aalStepUpRequired(status);
        const totp = status.totpFactors[0] ?? null;
        setStepUpRequired(needsStepUp);
        setTotpFactor(totp);

        if (!needsStepUp) {
          return;
        }

        // Which app-owned factors does the account have? Passkeys / email-OTP /
        // magic-link aren't in the Supabase AAL, so they come from the policy.
        let canPasskey = false;
        let emailOtp = false;
        let magicLink = false;
        try {
          const session = await getSupabaseStoredSession();
          if (session?.accessToken) {
            const policy = await getMfaPolicy(session.accessToken);
            canPasskey = policy.hasWebauthn && isWebauthnAvailable();
            emailOtp = policy.hasEmailOtp;
            magicLink = policy.hasMagicLink;
          }
        } catch {
          // Ignore — those methods simply won't be offered.
        }
        if (!active) {
          return;
        }
        setPasskeyAvailable(canPasskey);
        setHasEmailOtp(emailOtp);
        setHasMagicLink(magicLink);
        // Preferred order: passkey → authenticator → email code → email link →
        // recovery code (last resort).
        setStepUpMethod(
          canPasskey
            ? "passkey"
            : totp
              ? "totp"
              : emailOtp
                ? "email_otp"
                : magicLink
                  ? "magic_link"
                  : "recovery",
        );
      } catch {
        // Non-fatal: if the probe fails we still let the user try, and the
        // mapped gotrue error explains the authenticator requirement.
      }
    })();

    return () => {
      active = false;
    };
  }, [phase, configured]);

  async function handleRequestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestEmail.trim()) {
      setError("Enter the email address for your account.");
      setNotice("");
      return;
    }
    if (!configured) {
      setError("Supabase auth is not configured for this dashboard environment.");
      return;
    }
    if (resetCooldown.active) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await sendSupabasePasswordReset(requestEmail.trim());
      setNotice("Recovery email sent. Open the link in this browser to choose a new password.");
      setBusy(false);
      resetCooldown.start();
    } catch (requestError) {
      setBusy(false);
      setError(mapSupabaseAuthError(requestError));
      // Same rationale as Login: a rate-limited send still consumes the
      // Supabase project quota, so block instant retry.
      resetCooldown.start();
    }
  }

  // After the password is set, persist the user and route on. A user who had
  // no MFA factor and whose workspace requires app MFA is sent straight to
  // enrollment (the enforcement gate would also catch this at "/", but the
  // explicit redirect avoids a flash of the dashboard first).
  async function finishAndRedirect() {
    const session = await getSupabaseStoredSession();
    let user: StoredAuthUser | null = session?.user ?? null;
    if (!user) {
      const client = getSupabaseClient();
      const { data } = await client!.auth.getSession();
      if (data.session) {
        user = sessionFromSupabaseSession(data.session).user;
      }
    }
    if (user) {
      writeStoredAuthUser(user);
    }

    let destination = "/";
    const token = session?.accessToken;
    if (!stepUpRequired && token) {
      try {
        const policy = await getMfaPolicy(token);
        if (policy.requiresAppMfa && !policy.hasAnyFactor) {
          destination = "/onboarding/mfa";
        }
      } catch {
        // Fall back to "/"; the enforcement gate still forces enrollment.
      }
    }
    navigate(destination, { replace: true });
  }

  async function requireRecoveryToken(): Promise<string> {
    const session = await getSupabaseStoredSession();
    const token = session?.accessToken;
    if (!token) {
      throw new Error("Your recovery session has expired. Request a new reset email.");
    }
    return token;
  }

  // Switching methods clears the per-method "sent" state so a stale
  // emailed-code / link prompt doesn't carry over.
  function switchMethod(next: StepUpMethod) {
    setError("");
    setEmailOtpSent(false);
    setMagicLinkSent(false);
    setEmailCode("");
    setStepUpMethod(next);
  }

  async function handleSendEmailCode() {
    setError("");
    setBusy(true);
    try {
      const token = await requireRecoveryToken();
      await challengeEmailOtp(token);
      setEmailOtpSent(true);
    } catch (sendError) {
      setError(mapSupabaseAuthError(sendError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMagicLink() {
    setError("");
    setBusy(true);
    try {
      const token = await requireRecoveryToken();
      await challengeMagicLink(token);
      setMagicLinkSent(true);
    } catch (sendError) {
      setError(mapSupabaseAuthError(sendError));
    } finally {
      setBusy(false);
    }
  }

  async function handleCompleteReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newPassword.trim() || newPassword.length < 8) {
      setError("Choose a new password with at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Password confirmation does not match.");
      return;
    }
    if (!configured) {
      setError("Supabase auth is not configured for this dashboard environment.");
      return;
    }
    if (stepUpRequired && stepUpMethod === "recovery" && recoveryCode.trim().length < 8) {
      setError("Enter a valid recovery code.");
      return;
    }
    if (stepUpRequired && stepUpMethod === "totp" && !/^\d{6}$/.test(totpCode.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    if (stepUpRequired && stepUpMethod === "email_otp" && !/^\d{6}$/.test(emailCode.trim())) {
      setError("Enter the 6-digit code we emailed you.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (!stepUpRequired) {
        await updateSupabasePassword(newPassword);
      } else if (stepUpMethod === "passkey") {
        // Passkeys are app-owned and can't lift the session to aal2, so we
        // verify the assertion (mints the AAL2 attestation cookie) and set the
        // password via the requireAAL2-gated backend endpoint.
        const token = await requireRecoveryToken();
        await verifyPasskey(token);
        await resetPasswordWithAttestation(token, newPassword);
      } else if (stepUpMethod === "email_otp") {
        // Email-OTP is app-owned: verifying the code mints the attestation,
        // then the password is set via the same requireAAL2-gated endpoint.
        const token = await requireRecoveryToken();
        await verifyEmailOtp(token, emailCode.trim());
        await resetPasswordWithAttestation(token, newPassword);
      } else if (stepUpMethod === "magic_link") {
        // Magic-link verification happens by clicking the emailed link (which
        // sets the attestation cookie on this device); we then set the
        // password. If the link wasn't clicked the endpoint 401s.
        const token = await requireRecoveryToken();
        await resetPasswordWithAttestation(token, newPassword);
      } else if (stepUpMethod === "recovery") {
        // Lost-device path: recovery codes are app-owned, so the password is
        // set server-side via the recovery-code endpoint instead of `updateUser`.
        const token = await requireRecoveryToken();
        await resetPasswordWithRecoveryCode(token, recoveryCode.trim(), newPassword);
      } else {
        // TOTP is native: step the recovery session up to aal2, then gotrue's
        // own `updateUser` accepts the new password.
        if (totpFactor) {
          await verifySupabaseTotpStepUp(totpFactor.id, totpCode.trim());
        }
        await updateSupabasePassword(newPassword);
      }
      await finishAndRedirect();
    } catch (completeError) {
      setBusy(false);
      setError(mapSupabaseAuthError(completeError));
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-af2-paper px-6 py-12 text-af2-ink">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <span className="font-af2-serif text-2xl font-medium tracking-[-0.02em] text-af2-ink">AutoFlow</span>
        </div>

        <section className="animate-auth-card-in rounded-xl border border-af2-line bg-af2-card p-7 shadow-[0_18px_40px_rgba(26,20,16,0.08)] sm:p-8">
          <header className="mb-6">
            <h1 className="font-af2-serif text-3xl font-normal leading-tight tracking-[-0.02em] text-af2-ink">
              {phase === "complete" ? "Choose a new password" : "Reset your password"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-af2-ink-2">
              {phase === "complete"
                ? "Enter a new password for your account, then continue to your workspace."
                : "We'll email you a recovery link. Open it in this browser to finish resetting your password."}
            </p>
          </header>

          {!configured ? (
            <div className="mb-4 rounded-md border border-af2-mustard/40 bg-af2-mustard/10 px-4 py-3 text-sm text-af2-mustard">
              Supabase auth is not configured yet. Set{" "}
              <code className="font-af2-mono text-xs">VITE_SUPABASE_URL</code> and{" "}
              <code className="font-af2-mono text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code>.
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mb-4 rounded-md border border-af2-sage/40 bg-af2-sage/10 px-4 py-3 text-sm text-af2-sage">
              {notice}
            </div>
          ) : null}

          {phase === "loading" ? (
            <div className="flex items-center gap-3 py-6 text-sm text-af2-ink-2">
              <Loader2 size={18} className="animate-spin text-af2-clay" />
              Checking recovery link…
            </div>
          ) : null}

          {phase === "request" ? (
            <form onSubmit={handleRequestReset} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">
                  Work email
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  value={requestEmail}
                  onChange={(event) => setRequestEmail(event.target.value)}
                  disabled={busy || !configured || resetCooldown.active}
                  className="auth-input"
                  placeholder="operator@company.com"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !configured || resetCooldown.active}
                className="auth-primary-button mt-2"
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {busy
                  ? "Sending…"
                  : resetCooldown.active
                    ? `Send recovery email · ${resetCooldown.remainingSeconds}s`
                    : "Send recovery email"}
              </button>
            </form>
          ) : null}

          {phase === "complete" ? (
            <form onSubmit={handleCompleteReset} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">
                  New password
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  disabled={busy || !configured}
                  className="auth-input"
                  placeholder="At least 8 characters"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">
                  Confirm password
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={busy || !configured}
                  className="auth-input"
                  placeholder="Repeat your new password"
                />
              </label>
              {stepUpRequired && stepUpMethod === "passkey" ? (
                <p className="text-xs leading-5 text-af2-ink-3">
                  Your account has two-factor authentication enabled. Verify with your passkey to
                  confirm this change — you'll be prompted by your device.
                </p>
              ) : null}

              {stepUpRequired && stepUpMethod === "totp" ? (
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">
                    Authenticator code
                  </span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))}
                    disabled={busy || !configured}
                    className="auth-input"
                    placeholder="6-digit code"
                  />
                  <span className="mt-1.5 block text-xs leading-5 text-af2-ink-3">
                    Your account has two-factor authentication enabled. Enter the code from your
                    authenticator app to confirm this change.
                  </span>
                </label>
              ) : null}

              {stepUpRequired && stepUpMethod === "recovery" ? (
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">
                    Recovery code
                  </span>
                  <input
                    type="text"
                    autoComplete="off"
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value)}
                    disabled={busy || !configured}
                    className="auth-input font-af2-mono"
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                  />
                  <span className="mt-1.5 block text-xs leading-5 text-af2-ink-3">
                    {totpFactor === null && !passkeyAvailable
                      ? "Your account requires a second factor. Enter one of the recovery codes you saved when you set up two-factor authentication."
                      : "Enter one of the recovery codes you saved when you set up two-factor authentication. If you have none, contact support to recover access."}
                  </span>
                </label>
              ) : null}

              {stepUpRequired && stepUpMethod === "email_otp" ? (
                emailOtpSent ? (
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">
                      Email code
                    </span>
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={emailCode}
                      onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))}
                      disabled={busy || !configured}
                      className="auth-input"
                      placeholder="6-digit code"
                    />
                    <span className="mt-1.5 block text-xs leading-5 text-af2-ink-3">
                      Enter the 6-digit code we emailed you to confirm this change.
                    </span>
                  </label>
                ) : (
                  <p className="text-xs leading-5 text-af2-ink-3">
                    Your account has two-factor authentication enabled. We'll email you a 6-digit
                    code to confirm this change.
                  </p>
                )
              ) : null}

              {stepUpRequired && stepUpMethod === "magic_link" ? (
                magicLinkSent ? (
                  <p className="text-xs leading-5 text-af2-ink-3">
                    We emailed you a verification link. Open it on this device, then continue below
                    to set your new password.
                  </p>
                ) : (
                  <p className="text-xs leading-5 text-af2-ink-3">
                    Your account has two-factor authentication enabled. We'll email you a
                    verification link to confirm this change.
                  </p>
                )
              ) : null}

              {stepUpRequired && stepUpMethod === "email_otp" && !emailOtpSent ? (
                <button
                  type="button"
                  onClick={handleSendEmailCode}
                  disabled={busy || !configured}
                  className="auth-primary-button mt-2"
                >
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                  {busy ? "Sending…" : "Email me a code"}
                </button>
              ) : stepUpRequired && stepUpMethod === "magic_link" && !magicLinkSent ? (
                <button
                  type="button"
                  onClick={handleSendMagicLink}
                  disabled={busy || !configured}
                  className="auth-primary-button mt-2"
                >
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                  {busy ? "Sending…" : "Email me a link"}
                </button>
              ) : (
                <button type="submit" disabled={busy || !configured} className="auth-primary-button mt-2">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                  {stepUpRequired && stepUpMethod === "passkey"
                    ? busy
                      ? "Waiting for device…"
                      : "Verify with passkey & update password"
                    : stepUpRequired && stepUpMethod === "magic_link"
                      ? busy
                        ? "Updating…"
                        : "I've opened the link — update password"
                      : busy
                        ? "Updating…"
                        : "Update password"}
                </button>
              )}

              {stepUpRequired ? (
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-af2-ink-3">
                  {passkeyAvailable && stepUpMethod !== "passkey" ? (
                    <button type="button" onClick={() => switchMethod("passkey")} className="underline">
                      Use a passkey
                    </button>
                  ) : null}
                  {totpFactor && stepUpMethod !== "totp" ? (
                    <button type="button" onClick={() => switchMethod("totp")} className="underline">
                      Use your authenticator app
                    </button>
                  ) : null}
                  {hasEmailOtp && stepUpMethod !== "email_otp" ? (
                    <button type="button" onClick={() => switchMethod("email_otp")} className="underline">
                      Email me a code
                    </button>
                  ) : null}
                  {hasMagicLink && stepUpMethod !== "magic_link" ? (
                    <button type="button" onClick={() => switchMethod("magic_link")} className="underline">
                      Email me a link
                    </button>
                  ) : null}
                  {stepUpMethod !== "recovery" ? (
                    <button type="button" onClick={() => switchMethod("recovery")} className="underline">
                      Lost your device? Use a recovery code
                    </button>
                  ) : null}
                </div>
              ) : null}
            </form>
          ) : null}
        </section>

        <p className="mt-6 text-center text-xs text-af2-ink-3">
          <Link to="/login" className="font-medium text-af2-clay hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
