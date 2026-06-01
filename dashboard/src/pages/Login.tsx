import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Link2, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { writeStoredAuthUser } from "../auth/authStorage";
import { Link } from "react-router-dom";
import {
  isSupabaseAuthConfigured,
  mapSupabaseAuthError,
  sendSignupEmailOtp,
  sendSupabaseMagicLink,
  setSupabaseSessionFromTokens,
  signInWithSupabaseOAuth,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  verifySignupEmailOtp,
  type SupabaseOAuthProvider,
} from "../auth/supabaseAuth";
import { isWebauthnAvailable, loginWithPasskey, registerPasskey } from "../auth/mfa";
import { useAuthCooldown } from "../auth/useAuthCooldown";
import { useTheme } from "../context/ThemeContext";

const MAGIC_LINK_COOLDOWN_KEY = "autoflow.auth.magicLinkCooldown";
import { CompanyLogo } from "@autoflow/logo-dev";

type AuthMode = "signin" | "signup" | "magic-link";

// HEL-76: noise overlay + obsidian lockup dropped for v2 cream/clay aesthetic.
// Inline AutoFlowMark + cream paper backdrop match the landing's editorial style.

function AutoFlowMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--af2-ink)" />
      <path
        d="M9 11.5a4.5 4.5 0 0 1 9 0v9a4.5 4.5 0 0 1-9 0M14 11.5a4.5 4.5 0 0 1 9 0v9"
        fill="none"
        stroke="var(--af2-paper)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const socialProviders: Array<{ key: SupabaseOAuthProvider; label: string }> = [
  { key: "google", label: "Google" },
  { key: "github", label: "GitHub" },
];

function resolveMode(value: string | null): AuthMode {
  if (value === "signup") return "signup";
  if (value === "magic-link") return "magic-link";
  return "signin";
}

function cardTitle(mode: AuthMode): string {
  if (mode === "signup") return "Create your account";
  if (mode === "magic-link") return "Magic link sign-in";
  return "Welcome back";
}

function cardCopy(mode: AuthMode): string {
  if (mode === "signup") {
    return "Start with a free workspace. Bring your own LLM keys, hire your first agents in minutes.";
  }
  if (mode === "magic-link") {
    return "We'll send a one-time link to your inbox. Open it on this device to sign in.";
  }
  return "Sign in to your AutoFlow workspace.";
}

/**
 * Friendly copy for passkey sign-in failures. The WebAuthn ceremony throws a
 * `DOMException` (NotAllowedError on cancel/timeout, etc.); backend rejections
 * arrive as plain `Error` messages. Cancellation isn't really an error, so
 * keep it gentle.
 */
function mapPasskeyLoginError(error: unknown): string {
  if (error instanceof DOMException || (error && typeof error === "object" && "name" in error)) {
    const name = (error as { name?: string }).name;
    if (name === "NotAllowedError" || name === "AbortError") {
      return "Passkey sign-in was cancelled or timed out. Try again.";
    }
    if (name === "InvalidStateError") {
      return "No matching passkey is registered on this device.";
    }
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("unknown_credential")) {
    return "That passkey isn't registered. Sign in another way, then add it from Security settings.";
  }
  if (message.includes("challenge_missing")) {
    return "Your passkey sign-in attempt expired. Try again.";
  }
  if (message.includes("passwordless_login_unavailable")) {
    return "Passwordless passkey sign-in isn't enabled for this environment yet.";
  }
  return message || "Passkey sign-in failed. Try again.";
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = resolveMode(searchParams.get("mode"));
  const qaPreviewError = searchParams.get("qaPreviewError") === "invalid";
  const callbackError = searchParams.get("authError");
  const legacySocialError = searchParams.get("socialAuthError");

  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [magicLinkEmail, setMagicLinkEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeProvider, setActiveProvider] = useState<SupabaseOAuthProvider | null>(null);
  const [error, setError] = useState(
    qaPreviewError
      ? "Preview access link is invalid, expired, or not enabled for this deployment."
      : callbackError
        ? decodeURIComponent(callbackError.replace(/\+/g, " "))
        : legacySocialError
          ? legacySocialError.replace(/\+/g, " ")
          : ""
  );
  const [notice, setNotice] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  // Passwordless passkey sign-up is two-phase: "idle" → enter email + name and
  // request a code; "code" → enter the emailed code, then run the passkey
  // registration ceremony.
  const [passkeySignupStep, setPasskeySignupStep] = useState<"idle" | "code">("idle");
  const [passkeySignupCode, setPasskeySignupCode] = useState("");

  const magicLinkCooldown = useAuthCooldown(MAGIC_LINK_COOLDOWN_KEY);

  const configured = isSupabaseAuthConfigured();
  // Passwordless passkey sign-in is offered whenever the browser can run a
  // WebAuthn ceremony (secure context + PublicKeyCredential). Read once at
  // render — it doesn't change within the page's lifetime.
  const passkeysAvailable = isWebauthnAvailable();
  const isAnyBusy = busy || activeProvider !== null || passkeyBusy;

  // HEL-76: the v1 hero-side `signals` strip was dropped for the v2 single-card
  // layout. Trust pills (BYOK / OAuth / SOC 2) render under the form instead.

  function triggerError(message: string) {
    setError(message);
    setNotice("");
  }

  function switchMode(nextMode: AuthMode) {
    const nextParams = new URLSearchParams(searchParams);
    if (nextMode === "signin") {
      nextParams.delete("mode");
    } else {
      nextParams.set("mode", nextMode);
    }
    nextParams.delete("qaPreviewError");
    nextParams.delete("authError");
    nextParams.delete("socialAuthError");
    setSearchParams(nextParams);
    setError("");
    setNotice("");
    // Leaving a tab abandons any in-flight passkey sign-up code entry.
    setPasskeySignupStep("idle");
    setPasskeySignupCode("");
  }

  async function handleOAuth(provider: SupabaseOAuthProvider) {
    if (!configured) {
      triggerError("Supabase auth is not configured for this dashboard environment.");
      return;
    }

    setActiveProvider(provider);
    setError("");
    setNotice("");

    try {
      await signInWithSupabaseOAuth(provider);
    } catch (authError) {
      setActiveProvider(null);
      triggerError(mapSupabaseAuthError(authError));
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signinEmail.trim() || !signinPassword.trim()) {
      triggerError("Enter both your email and password.");
      return;
    }
    if (!configured) {
      triggerError("Supabase auth is not configured for this dashboard environment.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const session = await signInWithSupabasePassword(signinEmail.trim(), signinPassword);
      writeStoredAuthUser(session.user);
      navigate("/", { replace: true });
    } catch (authError) {
      setBusy(false);
      triggerError(mapSupabaseAuthError(authError));
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim()) {
      triggerError("Enter your name, email, and password to continue.");
      return;
    }
    if (signupPassword !== signupConfirmPassword) {
      triggerError("Password confirmation does not match.");
      return;
    }
    if (!configured) {
      triggerError("Supabase auth is not configured for this dashboard environment.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const session = await signUpWithSupabasePassword({
        email: signupEmail.trim(),
        password: signupPassword,
        fullName: signupName.trim(),
      });

      if (session) {
        writeStoredAuthUser(session.user);
        navigate("/", { replace: true });
        return;
      }

      setNotice("Check your inbox to confirm your email, then return here to sign in.");
      setBusy(false);
    } catch (authError) {
      setBusy(false);
      triggerError(mapSupabaseAuthError(authError));
    }
  }

  async function handleMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!magicLinkEmail.trim()) {
      triggerError("Enter the email address that should receive the magic link.");
      return;
    }
    if (!configured) {
      triggerError("Supabase auth is not configured for this dashboard environment.");
      return;
    }
    if (magicLinkCooldown.active) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await sendSupabaseMagicLink(magicLinkEmail.trim());
      setNotice("Magic link sent. Open the email on this device to complete sign-in.");
      setBusy(false);
      magicLinkCooldown.start();
    } catch (authError) {
      setBusy(false);
      triggerError(mapSupabaseAuthError(authError));
      // Apply the cooldown even on error — a rate-limited send burns the
      // Supabase project quota the same as a successful one, so the user
      // shouldn't be able to retry instantly.
      magicLinkCooldown.start();
    }
  }

  // Passwordless first-factor sign-in with a discoverable passkey. The
  // WebAuthn assertion is verified server-side and exchanged for a real
  // Supabase session, which we adopt before redirecting into the app.
  async function handlePasskeyLogin() {
    if (!configured) {
      triggerError("Supabase auth is not configured for this dashboard environment.");
      return;
    }
    if (!passkeysAvailable) {
      triggerError("Passkeys aren't available on this device or connection.");
      return;
    }
    setPasskeyBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await loginWithPasskey();
      const session = await setSupabaseSessionFromTokens(result.accessToken, result.refreshToken);
      writeStoredAuthUser(session.user);
      navigate("/", { replace: true });
    } catch (authError) {
      setPasskeyBusy(false);
      triggerError(mapPasskeyLoginError(authError));
    }
  }

  // Passwordless passkey sign-up, phase 1: prove inbox control. We email a
  // one-time code (which also provisions the account on verify) before letting
  // the user mint a passkey, so nobody can squat an address they don't own.
  async function handlePasskeySignupStart() {
    if (!configured) {
      triggerError("Supabase auth is not configured for this dashboard environment.");
      return;
    }
    if (!passkeysAvailable) {
      triggerError("Passkeys aren't available on this device or connection.");
      return;
    }
    if (!signupName.trim() || !signupEmail.trim()) {
      triggerError("Enter your name and email to sign up with a passkey.");
      return;
    }
    setPasskeyBusy(true);
    setError("");
    setNotice("");
    try {
      await sendSignupEmailOtp(signupEmail.trim(), signupName.trim());
      setPasskeySignupStep("code");
      setNotice("We emailed you a 6-digit code. Enter it below, then create your passkey.");
      setPasskeyBusy(false);
    } catch (authError) {
      setPasskeyBusy(false);
      triggerError(mapSupabaseAuthError(authError));
    }
  }

  // Phase 2: verify the emailed code, register the passkey, THEN adopt the
  // session. Order matters: verify runs on a detached client so the shared
  // client doesn't sign in yet — that lets the passkey ceremony finish at the
  // sign-up window instead of the session change redirecting us into MFA
  // onboarding first. Once the passkey exists, adopting the session lands the
  // user in the app with a factor already enrolled (no second-factor prompt).
  // Errors are mapped per stage so a wrong code reads differently from a
  // cancelled passkey prompt.
  async function handlePasskeySignupVerify() {
    if (!passkeySignupCode.trim()) {
      triggerError("Enter the code we emailed you.");
      return;
    }
    setPasskeyBusy(true);
    setError("");
    setNotice("");

    let session: Awaited<ReturnType<typeof verifySignupEmailOtp>>;
    try {
      session = await verifySignupEmailOtp(signupEmail.trim(), passkeySignupCode);
    } catch (authError) {
      setPasskeyBusy(false);
      triggerError(mapSupabaseAuthError(authError));
      return;
    }

    try {
      // Token-authenticated; the shared client has no session yet, so the
      // ceremony completes here on the sign-up form.
      await registerPasskey(session.accessToken, "Passkey");
    } catch (authError) {
      // Email is verified but the passkey didn't take. Keep the code step so
      // they can retry the ceremony without re-requesting a code.
      setPasskeyBusy(false);
      triggerError(mapPasskeyLoginError(authError));
      return;
    }

    try {
      // Passkey is enrolled — now sign in for real and head into the app.
      await setSupabaseSessionFromTokens(session.accessToken, session.refreshToken ?? "");
    } catch (authError) {
      setPasskeyBusy(false);
      triggerError(mapSupabaseAuthError(authError));
      return;
    }

    writeStoredAuthUser(session.user);
    navigate("/", { replace: true });
  }

  const headerText = cardTitle(mode);
  const helperText = cardCopy(mode);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-af2-paper px-6 py-12 text-af2-ink">
      <div className="w-full max-w-md">
        {/* AutoFlow mark + wordmark */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <AutoFlowMark size={36} />
          <span className="font-af2-serif text-2xl font-medium tracking-[-0.02em] text-af2-ink">
            AutoFlow
          </span>
        </div>

        <section className="animate-auth-card-in rounded-xl border border-af2-line bg-af2-card p-7 shadow-[0_18px_40px_rgba(26,20,16,0.08)] sm:p-8">
          <header className="mb-6">
            <h1 className="font-af2-serif text-3xl font-normal leading-tight tracking-[-0.02em] text-af2-ink">
              {headerText}
            </h1>
            <p className="mt-2 text-sm leading-6 text-af2-ink-2">{helperText}</p>
          </header>

          {/* Mode tabs */}
          <div className="mb-6 inline-flex w-full rounded-md border border-af2-line bg-af2-paper p-1 text-sm">
            {(["signin", "signup", "magic-link"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
                  mode === m
                    ? "bg-af2-ink text-af2-paper"
                    : "text-af2-ink-3 hover:text-af2-ink"
                }`}
              >
                {m === "signin" ? "Sign in" : m === "signup" ? "Sign up" : "Magic link"}
              </button>
            ))}
          </div>

          {!configured ? (
            <div className="mb-4 rounded-md border border-af2-mustard/40 bg-af2-mustard/10 px-4 py-3 text-sm text-af2-mustard">
              Supabase auth is not configured yet. Set <code className="font-af2-mono text-xs">VITE_SUPABASE_URL</code> and{" "}
              <code className="font-af2-mono text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code> before using this dashboard surface.
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
          {qaPreviewError ? (
            <p className="mb-4 text-xs leading-5 text-af2-clay">
              Request a fresh QA preview-access link if you still need smoke-test access for this deployment.
            </p>
          ) : null}

            {mode !== "magic-link" ? (
              <>
                <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">Or continue with</p>
                <SocialButtonRail
                  mode={mode}
                  activeProvider={activeProvider}
                  disabled={isAnyBusy || !configured}
                  onSelect={handleOAuth}
                />
                {passkeysAvailable && mode === "signin" ? (
                  <button
                    type="button"
                    onClick={handlePasskeyLogin}
                    disabled={isAnyBusy || !configured}
                    className="auth-microsoft-button mt-3 w-full justify-center"
                    aria-label="Sign in with a passkey"
                  >
                    <span className="flex h-6 w-6 items-center justify-center">
                      {passkeyBusy ? (
                        <Loader2 size={18} className="animate-spin text-af2-ink-3" />
                      ) : (
                        <KeyRound size={18} className="text-af2-ink-3" />
                      )}
                    </span>
                    <span>{passkeyBusy ? "Waiting for passkey…" : "Sign in with a passkey"}</span>
                  </button>
                ) : null}
                <SectionDivider label={mode === "signin" ? "Or sign in with email" : "Or sign up with email"} />
              </>
            ) : null}

            {mode === "signin" ? (
              <form onSubmit={handleSignIn} className="space-y-4 transition-all duration-300">
                <Field label="Work email" delay={0}>
                  <input
                    type="email"
                    autoComplete="email"
                    value={signinEmail}
                    onChange={(event) => setSigninEmail(event.target.value)}
                    disabled={isAnyBusy || !configured}
                    className="auth-input"
                    placeholder="operator@company.com"
                  />
                </Field>
                <Field label="Password" delay={50}>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={signinPassword}
                    onChange={(event) => setSigninPassword(event.target.value)}
                    disabled={isAnyBusy || !configured}
                    className="auth-input"
                    placeholder="Enter your password"
                  />
                </Field>
                <p className="text-right text-xs">
                  <Link to="/reset-password" className="font-medium text-af2-clay hover:underline">
                    Forgot password?
                  </Link>
                </p>
                <button type="submit" disabled={isAnyBusy || !configured} className="auth-primary-button mt-2">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                  {busy ? "Authorizing..." : "Sign in"}
                </button>
              </form>
            ) : null}

            {mode === "signup" ? (
              <form onSubmit={handleSignUp} className="space-y-4 transition-all duration-300">
                <Field label="Full name" delay={0}>
                  <input
                    type="text"
                    autoComplete="name"
                    value={signupName}
                    onChange={(event) => setSignupName(event.target.value)}
                    disabled={isAnyBusy || !configured}
                    className="auth-input"
                    placeholder="Avery Quinn"
                  />
                </Field>
                <Field label="Work email" delay={50}>
                  <input
                    type="email"
                    autoComplete="email"
                    value={signupEmail}
                    onChange={(event) => setSignupEmail(event.target.value)}
                    disabled={isAnyBusy || !configured}
                    className="auth-input"
                    placeholder="avery@company.com"
                  />
                </Field>
                <Field label="Password" delay={100}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={signupPassword}
                    onChange={(event) => setSignupPassword(event.target.value)}
                    disabled={isAnyBusy || !configured}
                    className="auth-input"
                    placeholder="Choose a password"
                  />
                </Field>
                <Field label="Confirm password" delay={150}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={signupConfirmPassword}
                    onChange={(event) => setSignupConfirmPassword(event.target.value)}
                    disabled={isAnyBusy || !configured}
                    className="auth-input"
                    placeholder="Repeat your password"
                  />
                </Field>
                <button type="submit" disabled={isAnyBusy || !configured} className="auth-primary-button mt-2">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                  {busy ? "Creating account..." : "Create account"}
                </button>
              </form>
            ) : null}

            {/* Passwordless sign-up: verify email, then mint a passkey instead
                of a password. Uses the name + email entered in the form above. */}
            {mode === "signup" && passkeysAvailable ? (
              <div className="mt-4 border-t border-dashed border-af2-line pt-4">
                {passkeySignupStep === "idle" ? (
                  <button
                    type="button"
                    onClick={handlePasskeySignupStart}
                    disabled={isAnyBusy || !configured}
                    className="auth-microsoft-button w-full justify-center"
                    aria-label="Sign up with a passkey"
                  >
                    <span className="flex h-6 w-6 items-center justify-center">
                      {passkeyBusy ? (
                        <Loader2 size={18} className="animate-spin text-af2-ink-3" />
                      ) : (
                        <KeyRound size={18} className="text-af2-ink-3" />
                      )}
                    </span>
                    <span>{passkeyBusy ? "Sending code…" : "Sign up with a passkey"}</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <Field label="Email code" delay={0}>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={passkeySignupCode}
                        onChange={(event) => setPasskeySignupCode(event.target.value)}
                        disabled={isAnyBusy}
                        className="auth-input"
                        placeholder="6-digit code"
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={handlePasskeySignupVerify}
                      disabled={isAnyBusy}
                      className="auth-primary-button"
                      aria-label="Verify code and create passkey"
                    >
                      {passkeyBusy ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                      {passkeyBusy ? "Verifying…" : "Verify & create passkey"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPasskeySignupStep("idle");
                        setPasskeySignupCode("");
                        setNotice("");
                      }}
                      disabled={isAnyBusy}
                      className="w-full text-center text-xs font-medium text-af2-clay hover:underline disabled:opacity-50"
                    >
                      Use a different email
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {mode === "magic-link" ? (
              <form onSubmit={handleMagicLink} className="space-y-4 transition-all duration-300">
                <Field label="Work email" delay={0}>
                  <input
                    type="email"
                    autoComplete="email"
                    value={magicLinkEmail}
                    onChange={(event) => setMagicLinkEmail(event.target.value)}
                    disabled={isAnyBusy || !configured || magicLinkCooldown.active}
                    className="auth-input"
                    placeholder="operator@company.com"
                  />
                </Field>
                <button
                  type="submit"
                  disabled={isAnyBusy || !configured || magicLinkCooldown.active}
                  className="auth-primary-button mt-2"
                >
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />}
                  {busy
                    ? "Sending link..."
                    : magicLinkCooldown.active
                      ? `Send magic link · ${magicLinkCooldown.remainingSeconds}s`
                      : "Send magic link"}
                </button>
              </form>
            ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] text-af2-ink-3">
            <span className="rounded-full border border-af2-line px-2.5 py-0.5">Bring your own keys</span>
            <span className="rounded-full border border-af2-line px-2.5 py-0.5">Google + GitHub OAuth</span>
            <span className="rounded-full border border-af2-line px-2.5 py-0.5">SOC 2 in progress</span>
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-af2-ink-3">
          New to AutoFlow?{" "}
          <button
            type="button"
            onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
            className="font-medium text-af2-clay hover:underline"
          >
            {mode === "signup" ? "Sign in instead" : "Create a workspace"}
          </button>
        </p>
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="auth-or-divider" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

function SocialButtonRail({
  mode,
  activeProvider,
  disabled,
  onSelect,
}: {
  mode: "signin" | "signup";
  activeProvider: SupabaseOAuthProvider | null;
  disabled: boolean;
  onSelect: (provider: SupabaseOAuthProvider) => void;
}) {
  return (
    <div className="space-y-3">
      {socialProviders.map((provider) => {
        const isActive = activeProvider === provider.key;
        const actionLabel = mode === "signin" ? "Sign in" : "Sign up";

        return (
          <button
            key={provider.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(provider.key)}
            className="auth-microsoft-button"
            aria-label={`${actionLabel} with ${provider.label}`}
          >
            <span className="flex h-6 w-6 items-center justify-center">
              {isActive ? <Loader2 size={18} className="animate-spin text-af2-ink-3" /> : <ProviderIcon provider={provider.key} disabled={disabled} />}
            </span>
            <span>{isActive ? "Redirecting…" : `${actionLabel} with ${provider.label}`}</span>
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,
  delay,
  children,
}: {
  label: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <label className="block animate-auth-field-in" style={{ animationDelay: `${delay}ms` }}>
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">{label}</span>
      {children}
    </label>
  );
}

function ProviderIcon({ provider, disabled }: { provider: SupabaseOAuthProvider; disabled: boolean }) {
  const { resolvedTheme } = useTheme();
  const label = provider === "google" ? "Google" : "GitHub";

  return (
    <CompanyLogo
      integrationId={provider}
      name={label}
      size={24}
      theme={resolvedTheme}
      className={disabled ? "grayscale opacity-60" : undefined}
    />
  );
}
