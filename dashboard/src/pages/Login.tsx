import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import logoIcon from "../assets/logo/icon.svg";

export default function Login() {
  const { login, signup } = useAuth();
  const [loading, setLoading] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setError("");
    setLoading(true);
    try {
      await login();
      // login() triggers a redirect — execution does not continue past this point
    } catch {
      setError("Sign-in failed. Please try again.");
      setLoading(false);
    }
  }

  async function handleSignup() {
    setError("");
    setSignupLoading(true);
    try {
      await signup();
      // signup() triggers a redirect — execution does not continue past this point
    } catch {
      setError("Signup failed. Please try again.");
      setSignupLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white border border-gray-200 shadow-sm mb-4">
            <img src={logoIcon} alt="AutoFlow" className="w-10 h-10 object-contain" />
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
            disabled={loading || signupLoading}
            className="w-full flex items-center justify-center gap-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-60"
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <MicrosoftIcon />
            )}
            {loading ? "Redirecting…" : "Continue with Microsoft"}
          </button>

          <button
            onClick={handleSignup}
            disabled={loading || signupLoading}
            className="w-full mt-3 flex items-center justify-center gap-3 py-2.5 border border-blue-600 text-blue-700 hover:bg-blue-50 font-medium rounded-lg transition disabled:opacity-60"
          >
            {signupLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <MicrosoftIcon />
            )}
            {signupLoading ? "Redirecting…" : "Create account with email"}
          </button>

          <p className="text-xs text-center text-gray-400 mt-4">
            New users are automatically registered on first sign-in.
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
