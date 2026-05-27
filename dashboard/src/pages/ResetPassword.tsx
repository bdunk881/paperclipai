import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { writeStoredAuthUser } from "../auth/authStorage";
import {
  getSupabaseClient,
  getSupabaseStoredSession,
  isPasswordRecoveryFlow,
  isSupabaseAuthConfigured,
  mapSupabaseAuthError,
  sendSupabasePasswordReset,
  sessionFromSupabaseSession,
  updateSupabasePassword,
} from "../auth/supabaseAuth";
import { useAuthCooldown } from "../auth/useAuthCooldown";

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

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await updateSupabasePassword(newPassword);
      const session = await getSupabaseStoredSession();
      if (session?.user) {
        writeStoredAuthUser(session.user);
      } else {
        const client = getSupabaseClient();
        const { data } = await client!.auth.getSession();
        if (data.session) {
          writeStoredAuthUser(sessionFromSupabaseSession(data.session).user);
        }
      }
      navigate("/", { replace: true });
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
              <button type="submit" disabled={busy || !configured} className="auth-primary-button mt-2">
                {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {busy ? "Updating…" : "Update password"}
              </button>
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
