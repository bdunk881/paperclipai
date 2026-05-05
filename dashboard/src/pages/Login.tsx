import { FormEvent, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, Link2, Loader2, Mail, ShieldCheck } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { writeStoredAuthSession } from "../auth/authStorage";
import {
  isSupabaseAuthConfigured,
  sendSupabaseMagicLink,
  signInWithSupabaseOAuth,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  type SupabaseOAuthProvider,
} from "../auth/supabaseAuth";

type AuthMode = "signin" | "signup" | "magic-link";

const lockupUrl = new URL("../../../infra/brand-assets/payload/logos/product/lockup.svg", import.meta.url).href;
const noiseUrl = new URL("../../../infra/brand-assets/payload/textures/noise-overlay.svg", import.meta.url).href;
const googleLogoUrl = new URL("../../../infra/brand-assets/payload/logos/integrations/google/logo.svg", import.meta.url).href;
const githubLogoUrl = new URL("../assets/integrations/github.svg", import.meta.url).href;

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
  if (mode === "signup") return "Create your AutoFlow account";
  if (mode === "magic-link") return "Email yourself a magic link";
  return "Sign in to AutoFlow";
}

function cardCopy(mode: AuthMode): string {
  if (mode === "signup") {
    return "Create a Supabase-backed dashboard session with email/password or an approved provider.";
  }
  if (mode === "magic-link") {
    return "Send a one-time sign-in link to your inbox for fast access on the current device.";
  }
  return "Use Supabase Auth for email/password access or continue with an approved provider.";
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

  const signals = useMemo(
    () => [
      { icon: ShieldCheck, label: "Supabase JWT for dashboard APIs" },
      { icon: KeyRound, label: "Email/password and PKCE OAuth" },
      { icon: Mail, label: "Magic-link callback through /auth/callback" },
    ],
    []
  );

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
      writeStoredAuthSession(session);
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
        writeStoredAuthSession(session);
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
    <div className="relative flex min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(20,184,166,0.16),_transparent_38%)]" />
        <div className="absolute inset-0 opacity-[0.16]" style={{ backgroundImage: `url("${noiseUrl}")` }} />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col justify-center gap-10 px-6 py-10 lg:flex-row lg:items-center lg:gap-16">
        <section className="max-w-xl space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Supabase Authentication Stub
          </div>
          <div className="space-y-5">
            <img src={lockupUrl} alt="AutoFlow" className="h-auto w-40" />
            <h1 className="max-w-lg text-4xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-5xl">
              Secure dashboard access with a Supabase-backed session.
            </h1>
            <p className="max-w-lg text-base leading-7 text-slate-300">
              This Phase 2c surface removes native CIAM form posts from the dashboard and switches login flows over to
              Supabase email/password, magic link, and approved provider sign-in.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {signals.map(({ icon: Icon, label }, index) => (
              <article
                key={label}
                className="animate-auth-field-in rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-[0_20px_30px_-22px_rgba(0,0,0,0.9)]"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <Icon size={18} className="mb-3 text-indigo-300" />
                <p className="text-sm leading-6 text-slate-300">{label}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="animate-auth-card-in relative w-full max-w-xl overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.5)]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.02]" style={{ backgroundImage: `url("${noiseUrl}")` }} />
          <div className="relative p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Command Center Access</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-50">{headerText}</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">{helperText}</p>
              </div>
            </div>

            <div className="mb-6 inline-flex rounded-full border border-slate-800 bg-slate-950/70 p-1 text-sm">
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className={`rounded-full px-4 py-2 transition ${mode === "signin" ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={`rounded-full px-4 py-2 transition ${mode === "signup" ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                Sign up
              </button>
              <button
                type="button"
                onClick={() => switchMode("magic-link")}
                className={`rounded-full px-4 py-2 transition ${mode === "magic-link" ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                Magic link
              </button>
            </div>

            {!configured ? (
              <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Supabase auth is not configured yet. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before using
                this dashboard surface.
              </div>
            ) : null}
            {error ? (
              <div className="mb-4 rounded-2xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="mb-4 rounded-2xl border border-teal-500/40 bg-teal-500/10 px-4 py-3 text-sm text-teal-100">
                {notice}
              </div>
            ) : null}
            {qaPreviewError ? (
              <p className="mb-4 text-xs leading-5 text-orange-300">
                Request a fresh QA preview-access link if you still need smoke-test access for this deployment.
              </p>
            ) : null}

            {mode !== "magic-link" ? (
              <>
                <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Or continue with</p>
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

            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="rounded-full border border-slate-800 px-3 py-1">Electric Lab auth surface</span>
              <span className="rounded-full border border-slate-800 px-3 py-1">Google + GitHub approved</span>
              <span className="rounded-full border border-slate-800 px-3 py-1">Supabase JWT-backed API session</span>
            </div>
          </div>
        </section>
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
            className="flex h-12 w-full items-center rounded-lg border border-[#3f4655] bg-[#1a1d23] px-4 text-sm font-medium text-[#e8eaee] transition duration-200 ease-out hover:border-[#4f5769] hover:bg-[#242932] hover:text-white active:border-[#5865f2] active:bg-[#0f1117] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5865f2] disabled:cursor-not-allowed disabled:border-[#2d3138] disabled:bg-[#0f1117] disabled:text-[#5a5f6b]"
            aria-label={`${actionLabel} with ${provider.label}`}
          >
            <span className="mr-4 flex h-6 w-6 items-center justify-center">
              {isActive ? <Loader2 size={18} className="animate-spin text-[#8a8e99]" /> : <ProviderIcon provider={provider.key} disabled={disabled} />}
            </span>
            <span>{isActive ? "Redirecting..." : `${actionLabel} with ${provider.label}`}</span>
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
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-slate-400">{label}</span>
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
