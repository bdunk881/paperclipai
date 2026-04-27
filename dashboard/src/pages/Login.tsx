import { FormEvent, useMemo, useRef, useState } from "react";
import type { AuthenticationResult } from "@azure/msal-browser";
import { BrowserAuthError, BrowserAuthErrorCodes } from "@azure/msal-browser";
import { Loader2, ArrowRight, CheckCircle2, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { loginRequest, signupRequest } from "../auth/msalConfig";
import { initializeMsalInstance, msalInstance } from "../auth/msalInstance";
import {
  NativeAuthError,
  challengePasswordReset,
  challengeSignUp,
  continuePasswordReset,
  continueSignUp,
  exchangeContinuationToken,
  pollPasswordResetCompletion,
  sessionFromTokenResponse,
  signInWithPassword,
  startPasswordReset,
  startSignUp,
  submitPasswordReset,
} from "../auth/nativeAuthClient";
import { StoredAuthSession, writeStoredAuthSession } from "../auth/authStorage";

type AuthMode = "signin" | "signup" | "reset";

type PendingSignUp = {
  continuationToken: string;
  email: string;
  password: string;
  name: string;
  challengeTargetLabel?: string;
  codeLength?: number;
};

type PendingReset = {
  continuationToken: string;
  email: string;
  newPassword: string;
  challengeTargetLabel?: string;
  codeLength?: number;
};

const lockupUrl = new URL("../../../infra/brand-assets/payload/logos/product/lockup.svg", import.meta.url).href;
const noiseUrl = new URL("../../../infra/brand-assets/payload/textures/noise-overlay.svg", import.meta.url).href;

function resolveMode(value: string | null): AuthMode {
  if (value === "signup") return "signup";
  if (value === "reset") return "reset";
  return "signin";
}

function prettyTarget(target: string | undefined, fallback: string): string {
  if (!target?.trim()) return fallback;
  return target.trim();
}

function mapNativeAuthError(error: unknown): string {
  if (!(error instanceof NativeAuthError)) {
    console.error("[NativeAuth] Non-auth error (possible CORS/network issue):", error);
    if (error instanceof TypeError) {
      return "Unable to reach the authentication server. This may be a network or CORS issue — check the browser console for details.";
    }
    return "Authentication failed. Check your details and try again.";
  }

  const normalized = `${error.code ?? ""} ${error.description ?? ""} ${error.message}`.toLowerCase();

  if (normalized.includes("password") && normalized.includes("invalid")) {
    return "The password you entered is incorrect.";
  }

  if (normalized.includes("verification")) {
    return "The verification code is invalid or expired.";
  }

  if (normalized.includes("rate") || normalized.includes("throttle")) {
    return "Too many attempts. Wait a moment before trying again.";
  }

  if (error.code === "user_not_found" || normalized.includes("user_not_found") || normalized.includes("user not found")) {
    return "We couldn’t find an account for that email address.";
  }

  if (error.code === "unsupported_challenge_type") {
    return "This sign-in method is not supported. Contact your administrator.";
  }

  // Surface the actual Azure error for unrecognized codes so they can be diagnosed.
  console.warn("[NativeAuth] Unhandled error:", error.code, error.description ?? error.message);
  return error.description ?? error.message;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (!Array.isArray(value)) return undefined;

  const candidate = value.find((entry) => typeof entry === "string" && entry.trim());
  return typeof candidate === "string" ? candidate : undefined;
}

function sessionFromMicrosoftResult(result: AuthenticationResult): StoredAuthSession {
  const claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;
  const email =
    result.account?.username ??
    firstString(claims.email) ??
    firstString(claims.preferred_username) ??
    firstString(claims.emails) ??
    "unknown@autoflow.local";
  const name =
    result.account?.name ??
    firstString(claims.name) ??
    firstString(claims.given_name) ??
    email;

  return {
    accessToken: result.accessToken || result.idToken,
    idToken: result.idToken || undefined,
    expiresAt: result.expiresOn?.getTime() ?? Date.now() + 60 * 60 * 1000,
    scope: result.scopes.join(" "),
    user: {
      id: result.account?.homeAccountId ?? result.account?.localAccountId ?? email,
      email,
      name,
      tenantId: result.account?.tenantId ?? firstString(claims.tid),
    },
  };
}

function mapMicrosoftAuthError(error: unknown): string {
  if (!(error instanceof BrowserAuthError)) {
    return "Microsoft sign-in failed. Try again in a new browser tab.";
  }

  switch (error.errorCode) {
    case BrowserAuthErrorCodes.popupWindowError:
    case BrowserAuthErrorCodes.emptyWindowError:
    case BrowserAuthErrorCodes.timedOut:
      return "Microsoft sign-in needs a popup window. Allow popups for AutoFlow and try again.";
    case BrowserAuthErrorCodes.userCancelled:
      return "Microsoft sign-in was canceled before completion.";
    case "interaction_in_progress":
      return "Microsoft sign-in is already in progress. Finish the open popup or close it before trying again.";
    default:
      return error.message || "Microsoft sign-in failed. Please try again.";
  }
}

function cardTitle(mode: AuthMode, pendingSignUp: PendingSignUp | null, pendingReset: PendingReset | null): string {
  if (mode === "signup" && pendingSignUp) return "Verify your email";
  if (mode === "reset" && pendingReset) return "Confirm reset code";
  if (mode === "signup") return "Create your AutoFlow account";
  if (mode === "reset") return "Reset your password";
  return "Sign in to AutoFlow";
}

function cardCopy(mode: AuthMode, pendingSignUp: PendingSignUp | null, pendingReset: PendingReset | null): string {
  if (mode === "signup" && pendingSignUp) {
    return `Enter the code we sent to ${prettyTarget(pendingSignUp.challengeTargetLabel, pendingSignUp.email)}.`;
  }
  if (mode === "reset" && pendingReset) {
    return `Use the code sent to ${prettyTarget(pendingReset.challengeTargetLabel, pendingReset.email)} to finish resetting your password.`;
  }
  if (mode === "signup") return "Launch secure automation workspaces without leaving the dashboard shell.";
  if (mode === "reset") return "Verify your identity, choose a new password, and get back into your command center.";
  return "Native authentication keeps the entire sign-in journey inside AutoFlow.";
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = resolveMode(searchParams.get("mode"));
  const qaPreviewError = searchParams.get("qaPreviewError") === "invalid";

  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [signupCode, setSignupCode] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [pendingSignUp, setPendingSignUp] = useState<PendingSignUp | null>(null);
  const [pendingReset, setPendingReset] = useState<PendingReset | null>(null);
  const [busy, setBusy] = useState(false);
  const [microsoftAction, setMicrosoftAction] = useState<"signin" | "signup" | null>(null);
  const microsoftInteractionInFlightRef = useRef(false);
  const [error, setError] = useState(
    qaPreviewError ? "Preview access link is invalid, expired, or not enabled for this deployment." : ""
  );
  const [notice, setNotice] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const isAnyBusy = busy || microsoftAction !== null;

  const signals = useMemo(
    () => [
      { icon: ShieldCheck, label: "First-party CIAM session" },
      { icon: KeyRound, label: "JWT access for dashboard APIs" },
      { icon: Mail, label: "Email verification for account actions" },
    ],
    []
  );

  function triggerError(message: string) {
    setError(message);
    setNotice("");
    setShakeKey((value) => value + 1);
  }

  function switchMode(nextMode: AuthMode) {
    const nextParams = new URLSearchParams(searchParams);
    if (nextMode === "signin") {
      nextParams.delete("mode");
    } else {
      nextParams.set("mode", nextMode);
    }
    nextParams.delete("qaPreviewError");
    setSearchParams(nextParams);
    setError("");
    setNotice("");
  }

  async function finalizeSession(tokenResponsePromise: Promise<ReturnType<typeof exchangeContinuationToken> extends Promise<infer T> ? T : never>) {
    const tokens = await tokenResponsePromise;
    writeStoredAuthSession(sessionFromTokenResponse(tokens));
    navigate("/", { replace: true });
  }

  async function handleMicrosoftAuth(action: "signin" | "signup") {
    if (microsoftInteractionInFlightRef.current) {
      triggerError("Microsoft sign-in is already in progress. Finish the open popup or close it before trying again.");
      return;
    }

    microsoftInteractionInFlightRef.current = true;
    setMicrosoftAction(action);
    setError("");
    setNotice("");

    try {
      await initializeMsalInstance();
      const result = await msalInstance.loginPopup(action === "signup" ? signupRequest : loginRequest);
      if (result.account) {
        msalInstance.setActiveAccount(result.account);
      }
      writeStoredAuthSession(sessionFromMicrosoftResult(result));
      navigate("/", { replace: true });
    } catch (authError) {
      triggerError(mapMicrosoftAuthError(authError));
    } finally {
      microsoftInteractionInFlightRef.current = false;
      setMicrosoftAction(null);
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signinEmail.trim() || !signinPassword.trim()) {
      triggerError("Enter both your email and password.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      await finalizeSession(signInWithPassword(signinEmail.trim(), signinPassword));
    } catch (authError) {
      triggerError(mapNativeAuthError(authError));
      setBusy(false);
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pendingSignUp) {
      if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim()) {
        triggerError("Enter your name, email, and password to continue.");
        return;
      }
      if (signupPassword !== signupConfirmPassword) {
        triggerError("Password confirmation does not match.");
        return;
      }

      setBusy(true);
      setError("");
      setNotice("");

      try {
        const started = await startSignUp(signupEmail.trim(), signupPassword, signupName.trim());
        const continuationToken = started.continuation_token;
        if (!continuationToken) {
          throw new NativeAuthError("Sign-up did not provide a continuation token.", 500);
        }

        const challenged = await challengeSignUp(continuationToken);
        setPendingSignUp({
          continuationToken: challenged.continuation_token ?? continuationToken,
          email: signupEmail.trim(),
          password: signupPassword,
          name: signupName.trim(),
          challengeTargetLabel: typeof challenged.challenge_target_label === "string" ? challenged.challenge_target_label : undefined,
          codeLength: typeof challenged.code_length === "number" ? challenged.code_length : undefined,
        });
        setNotice("Verification code sent. Enter it below to complete account creation.");
      } catch (authError) {
        triggerError(mapNativeAuthError(authError));
      } finally {
        setBusy(false);
      }

      return;
    }

    if (!signupCode.trim()) {
      triggerError("Enter the verification code from your email.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const continued = await continueSignUp(pendingSignUp.continuationToken, signupCode.trim());
      const continuationToken = continued.continuation_token ?? pendingSignUp.continuationToken;
      await finalizeSession(exchangeContinuationToken(continuationToken));
    } catch (authError) {
      triggerError(mapNativeAuthError(authError));
      setBusy(false);
    }
  }

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pendingReset) {
      if (!resetEmail.trim() || !resetPassword.trim()) {
        triggerError("Enter your account email and the new password you want to use.");
        return;
      }
      if (resetPassword !== resetConfirmPassword) {
        triggerError("New password confirmation does not match.");
        return;
      }

      setBusy(true);
      setError("");
      setNotice("");

      try {
        const started = await startPasswordReset(resetEmail.trim());
        const continuationToken = started.continuation_token;
        if (!continuationToken) {
          throw new NativeAuthError("Password reset did not provide a continuation token.", 500);
        }

        const challenged = await challengePasswordReset(continuationToken);
        setPendingReset({
          continuationToken: challenged.continuation_token ?? continuationToken,
          email: resetEmail.trim(),
          newPassword: resetPassword,
          challengeTargetLabel: typeof challenged.challenge_target_label === "string" ? challenged.challenge_target_label : undefined,
          codeLength: typeof challenged.code_length === "number" ? challenged.code_length : undefined,
        });
        setNotice("Reset code sent. Enter the code to apply your new password.");
      } catch (authError) {
        triggerError(mapNativeAuthError(authError));
      } finally {
        setBusy(false);
      }

      return;
    }

    if (!resetCode.trim()) {
      triggerError("Enter the password reset code from your email.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const continued = await continuePasswordReset(pendingReset.continuationToken, resetCode.trim());
      const submitted = await submitPasswordReset(continued.continuation_token ?? pendingReset.continuationToken, pendingReset.newPassword);
      const completed = await pollPasswordResetCompletion(
        submitted.continuation_token ?? continued.continuation_token ?? pendingReset.continuationToken
      );
      const continuationToken = completed.continuation_token ?? submitted.continuation_token;
      if (!continuationToken) {
        throw new NativeAuthError("Password reset completed without a continuation token.", 500);
      }

      await finalizeSession(exchangeContinuationToken(continuationToken));
    } catch (authError) {
      triggerError(mapNativeAuthError(authError));
      setBusy(false);
    }
  }

  const headerText = cardTitle(mode, pendingSignUp, pendingReset);
  const helperText = cardCopy(mode, pendingSignUp, pendingReset);
  const showSignupVerification = mode === "signup" && pendingSignUp;
  const showResetVerification = mode === "reset" && pendingReset;

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(20,184,166,0.16),_transparent_38%)]" />
        <div className="absolute inset-0 opacity-[0.16]" style={{ backgroundImage: `url("${noiseUrl}")` }} />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col justify-center gap-10 px-6 py-10 lg:flex-row lg:items-center lg:gap-16">
        <section className="max-w-xl space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
            Native Authentication
          </div>
          <div className="space-y-5">
            <img src={lockupUrl} alt="AutoFlow" className="h-auto w-40" />
            <h1 className="max-w-lg text-4xl font-semibold tracking-[-0.04em] text-slate-50 sm:text-5xl">
              Secure account access without leaving the dashboard shell.
            </h1>
            <p className="max-w-lg text-base leading-7 text-slate-300">
              AutoFlow now runs sign-in, registration, and password recovery as first-party native flows with
              CIAM-backed tokens that work directly against the dashboard API.
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

        <section
          key={`${mode}-${shakeKey}`}
          className={`animate-auth-card-in relative w-full max-w-xl overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.5)] ${error ? "animate-auth-shake" : ""}`}
        >
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
                onClick={() => switchMode("reset")}
                className={`rounded-full px-4 py-2 transition ${mode === "reset" ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                Reset
              </button>
            </div>

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

            {mode === "signin" ? (
              <form onSubmit={handleSignIn} className="space-y-4 transition-all duration-300">
                <Field label="Work email" delay={0}>
                  <input
                    type="email"
                    autoComplete="email"
                    value={signinEmail}
                    onChange={(event) => setSigninEmail(event.target.value)}
                    disabled={isAnyBusy}
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
                    disabled={isAnyBusy}
                    className="auth-input"
                    placeholder="Enter your password"
                  />
                </Field>
                <button
                  type="button"
                  disabled={isAnyBusy}
                  onClick={() => void handleMicrosoftAuth("signin")}
                  className="auth-microsoft-button"
                >
                  {microsoftAction === "signin" ? <Loader2 size={18} className="animate-spin" /> : <MicrosoftIcon />}
                  {microsoftAction === "signin" ? "Opening Microsoft..." : "Sign in with Microsoft"}
                </button>
                <OrDivider />
                <button type="submit" disabled={isAnyBusy} className="auth-primary-button mt-2">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                  {busy ? "Authorizing..." : "Sign in"}
                </button>
              </form>
            ) : null}

            {mode === "signup" ? (
              <form onSubmit={handleSignUp} className="space-y-4 transition-all duration-300">
                {!showSignupVerification ? (
                  <>
                    <Field label="Full name" delay={0}>
                      <input
                        type="text"
                        autoComplete="name"
                        value={signupName}
                        onChange={(event) => setSignupName(event.target.value)}
                        disabled={isAnyBusy}
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
                        disabled={isAnyBusy}
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
                        disabled={isAnyBusy}
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
                        disabled={isAnyBusy}
                        className="auth-input"
                        placeholder="Repeat your password"
                      />
                    </Field>
                  </>
                ) : (
                  <Field label="Verification code" delay={0}>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={signupCode}
                      onChange={(event) => setSignupCode(event.target.value)}
                      disabled={isAnyBusy}
                      className="auth-input"
                      placeholder={
                        pendingSignUp?.codeLength ? `${pendingSignUp.codeLength}-digit code` : "Enter email code"
                      }
                    />
                  </Field>
                )}
                {!showSignupVerification ? (
                  <>
                    <button
                      type="button"
                      disabled={isAnyBusy}
                      onClick={() => void handleMicrosoftAuth("signup")}
                      className="auth-microsoft-button"
                    >
                      {microsoftAction === "signup" ? <Loader2 size={18} className="animate-spin" /> : <MicrosoftIcon />}
                      {microsoftAction === "signup" ? "Opening Microsoft..." : "Sign up with Microsoft"}
                    </button>
                    <OrDivider />
                  </>
                ) : null}
                <button type="submit" disabled={isAnyBusy} className="auth-primary-button mt-2">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : showSignupVerification ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                  {busy ? "Processing..." : showSignupVerification ? "Verify and create account" : "Send verification code"}
                </button>
              </form>
            ) : null}

            {mode === "reset" ? (
              <form onSubmit={handlePasswordReset} className="space-y-4 transition-all duration-300">
                {!showResetVerification ? (
                  <>
                    <Field label="Account email" delay={0}>
                      <input
                        type="email"
                        autoComplete="email"
                        value={resetEmail}
                        onChange={(event) => setResetEmail(event.target.value)}
                        disabled={isAnyBusy}
                        className="auth-input"
                        placeholder="operator@company.com"
                      />
                    </Field>
                    <Field label="New password" delay={50}>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                        disabled={isAnyBusy}
                        className="auth-input"
                        placeholder="Choose a new password"
                      />
                    </Field>
                    <Field label="Confirm new password" delay={100}>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={resetConfirmPassword}
                        onChange={(event) => setResetConfirmPassword(event.target.value)}
                        disabled={isAnyBusy}
                        className="auth-input"
                        placeholder="Repeat the new password"
                      />
                    </Field>
                  </>
                ) : (
                  <Field label="Reset code" delay={0}>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={resetCode}
                      onChange={(event) => setResetCode(event.target.value)}
                      disabled={isAnyBusy}
                      className="auth-input"
                      placeholder={pendingReset?.codeLength ? `${pendingReset.codeLength}-digit code` : "Enter email code"}
                    />
                  </Field>
                )}
                <button type="submit" disabled={isAnyBusy} className="auth-primary-button mt-2">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : showResetVerification ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                  {busy ? "Processing..." : showResetVerification ? "Apply new password" : "Send reset code"}
                </button>
              </form>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="rounded-full border border-slate-800 px-3 py-1">Obsidian Secure Gateway</span>
              <span className="rounded-full border border-slate-800 px-3 py-1">AutoFlow Indigo Actions</span>
              <span className="rounded-full border border-slate-800 px-3 py-1">JWT-backed API session</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function OrDivider() {
  return (
    <div className="auth-or-divider" aria-hidden="true">
      <span>or</span>
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

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
