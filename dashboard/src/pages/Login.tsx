import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, Link2, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { writeStoredAuthUser } from "../auth/authStorage";
import {
  isSupabaseAuthConfigured,
  sendSupabaseMagicLink,
  signInWithSupabaseOAuth,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  type SupabaseOAuthProvider,
} from "../auth/supabaseAuth";

type AuthMode = "signin" | "signup" | "magic-link";

// HEL-76: noise overlay + obsidian lockup dropped for v2 cream/clay aesthetic.
// Inline AutoFlowMark + cream paper backdrop match the landing's editorial style.
const googleLogoUrl = new URL("../../../infra/brand-assets/payload/logos/integrations/google/logo.svg", import.meta.url).href;
const githubLogoUrl = new URL("../assets/integrations/github.svg", import.meta.url).href;

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

function mapSupabaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Authentication failed. Try again.";
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "The email or password is incorrect.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Check your inbox and confirm your email before signing in.";
  }
  if (normalized.includes("rate limit")) {
    return "Too many attempts. Wait a moment before trying again.";
  }

  return message;
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

  const configured = isSupabaseAuthConfigured();
  const isAnyBusy = busy || activeProvider !== null;

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
      triggerError(mapSupabaseError(authError));
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
      triggerError(mapSupabaseError(authError));
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
      triggerError(mapSupabaseError(authError));
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

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await sendSupabaseMagicLink(magicLinkEmail.trim());
      setNotice("Magic link sent. Open the email on this device to complete sign-in.");
      setBusy(false);
    } catch (authError) {
      setBusy(false);
      triggerError(mapSupabaseError(authError));
    }
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

            {mode === "magic-link" ? (
              <form onSubmit={handleMagicLink} className="space-y-4 transition-all duration-300">
                <Field label="Work email" delay={0}>
                  <input
                    type="email"
                    autoComplete="email"
                    value={magicLinkEmail}
                    onChange={(event) => setMagicLinkEmail(event.target.value)}
                    disabled={isAnyBusy || !configured}
                    className="auth-input"
                    placeholder="operator@company.com"
                  />
                </Field>
                <button type="submit" disabled={isAnyBusy || !configured} className="auth-primary-button mt-2">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <Link2 size={18} />}
                  {busy ? "Sending link..." : "Send magic link"}
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
  const logoSrc = provider === "google" ? googleLogoUrl : githubLogoUrl;

  return (
    <img
      src={logoSrc}
      alt=""
      aria-hidden="true"
      className={`h-6 w-6 object-contain ${disabled ? "grayscale opacity-60" : ""}`}
    />
  );
}
