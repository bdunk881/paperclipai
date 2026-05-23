import { useState, type FormEvent } from "react";
import { Link, useLoaderData } from "react-router";
import {
  createSupabaseBrowserClient,
  isSupabasePublicConfigured,
  readSupabasePublicConfig,
  type SupabasePublicConfig,
} from "../../lib/supabaseClient";

export function meta() {
  return [
    { title: "Sign Up | AutoFlow" },
    {
      name: "description",
      content: "Create your AutoFlow account and launch your first workflow.",
    },
  ];
}

export async function loader(): Promise<{ config: SupabasePublicConfig }> {
  return { config: readSupabasePublicConfig() };
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Sign-up failed. Please try again.";
  const normalized = message.toLowerCase();

  if (normalized.includes("already registered") || normalized.includes("user already")) {
    return "An account with that email already exists. Sign in instead.";
  }
  if (normalized.includes("rate limit")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (normalized.includes("password") && normalized.includes("short")) {
    return "Choose a password with at least 8 characters.";
  }
  return message;
}

export default function SignupPage() {
  const { config } = useLoaderData() as { config: SupabasePublicConfig };
  const configured = isSupabasePublicConfigured(config);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configured) {
      setError("Sign-up is temporarily unavailable. Please try again shortly.");
      return;
    }
    if (!email.trim() || password.length < 8) {
      setError("Enter your email and a password of at least 8 characters.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const supabase = createSupabaseBrowserClient(config);
      const emailRedirectTo = `${config.dashboardOrigin}/auth/confirm?next=/`;

      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo,
          data: name.trim() ? { full_name: name.trim() } : undefined,
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      setSent(true);
    } catch (signUpError) {
      setError(friendlyError(signUpError));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="bg-gray-50">
        <section className="mx-auto max-w-3xl px-6 py-20 lg:px-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm sm:p-10">
            <h1 className="text-3xl font-bold text-gray-900">Check your inbox</h1>
            <p className="mt-4 text-gray-600">
              We sent a confirmation link to <strong>{email}</strong>. Click it to finish creating your
              AutoFlow account. You can close this tab.
            </p>
            <p className="mt-6 text-sm text-gray-500">
              Didn&apos;t see it? Check your spam folder, then try again with a fresh link.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const signInHref = `${config.dashboardOrigin}/login`;

  return (
    <main className="bg-gray-50">
      <section className="mx-auto max-w-md px-6 py-20 lg:px-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm sm:p-10">
          <h1 className="text-3xl font-bold text-gray-900">Create your AutoFlow account</h1>
          <p className="mt-3 text-sm text-gray-600">
            Sign up with email + password. We&apos;ll send a confirmation link to verify your inbox.
          </p>

          {!configured ? (
            <div
              role="status"
              className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              Sign-up is temporarily unavailable. Please try again shortly.
            </div>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                Full name
              </span>
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy || !configured}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
                placeholder="Avery Quinn"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                Work email
              </span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy || !configured}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
                placeholder="avery@company.com"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                Password
              </span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy || !configured}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
                placeholder="At least 8 characters"
              />
            </label>

            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy || !configured}
              className="inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-sm text-gray-600">
            Already have an account?{" "}
            <Link to={signInHref} reloadDocument className="font-semibold text-indigo-600 hover:underline">
              Sign in
            </Link>
            .
          </p>
          <p className="mt-4 text-xs text-gray-500">
            Prefer to explore first?{" "}
            <Link to="/demo" className="font-medium text-indigo-600 hover:underline">
              Try the interactive demo
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
