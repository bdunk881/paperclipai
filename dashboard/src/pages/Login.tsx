import { useState } from "react";
import { Zap, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login, signup } = useAuth();
  const [loadingAction, setLoadingAction] = useState<"signin" | "signup" | null>(null);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setError("");
    setLoadingAction("signin");
    try {
      await login();
      // login() triggers a redirect — execution does not continue past this point
    } catch {
      setError("Sign-in failed. Please try again.");
      setLoadingAction(null);
    }
  }

  async function handleSignUp() {
    setError("");
    setLoadingAction("signup");
    try {
      await signup();
      // signup() triggers a redirect — execution does not continue past this point
    } catch {
      setError("Sign-up failed. Please try again.");
      setLoadingAction(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 mb-4">
            <Zap size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Sign in to AutoFlow</h1>
          <p className="text-gray-500 mt-1">AI-powered workflow automation</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleSignIn}
            disabled={loadingAction !== null}
            className="w-full flex items-center justify-center gap-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-60"
          >
            {loadingAction === "signin" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <MicrosoftIcon />
            )}
            {loadingAction === "signin" ? "Redirecting…" : "Continue with Microsoft"}
          </button>

          <button
            onClick={handleSignUp}
            disabled={loadingAction !== null}
            className="mt-3 w-full flex items-center justify-center gap-3 py-2.5 border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 font-medium rounded-lg transition disabled:opacity-60"
          >
            {loadingAction === "signup" ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <MicrosoftIcon />
            )}
            {loadingAction === "signup"
              ? "Redirecting to Sign-up…"
              : "Create account with email"}
          </button>

          <p className="text-xs text-center text-gray-400 mt-4">
            Use Continue to sign in, or Create account to register with a personal email.
          </p>
        </div>
      </div>
    </div>
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
