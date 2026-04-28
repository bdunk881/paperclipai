import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { writeStoredAuthSession } from "../auth/authStorage";
import {
  sessionFromAppToken,
  type SocialAuthProvider,
} from "../auth/nativeAuthClient";

function readFragmentParams(): URLSearchParams {
  if (typeof window === "undefined") {
    return new URLSearchParams();
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(hash);
}

function parseProvider(value: string | null): SocialAuthProvider | undefined {
  if (value === "google" || value === "facebook" || value === "apple") {
    return value;
  }
  return undefined;
}

function encodeErrorMessage(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export default function SocialAuthCallback() {
  const navigate = useNavigate();
  const params = useMemo(() => readFragmentParams(), []);
  const provider = parseProvider(params.get("provider"));
  const token = params.get("token");
  const errorDescription = params.get("error_description");
  const errorCode = params.get("error");

  useEffect(() => {
    if (token) {
      try {
        writeStoredAuthSession(sessionFromAppToken(token, provider));
        navigate("/", { replace: true });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Social sign-in could not be completed.";
        navigate(`/login?socialAuthError=${encodeErrorMessage(message)}`, { replace: true });
        return;
      }
    }

    const message =
      errorDescription?.trim() ||
      errorCode?.trim() ||
      "Social sign-in could not be completed.";
    navigate(`/login?socialAuthError=${encodeErrorMessage(message)}`, { replace: true });
  }, [errorCode, errorDescription, navigate, provider, token]);

  const label = provider
    ? `Completing ${provider[0].toUpperCase()}${provider.slice(1)} sign-in...`
    : "Completing social sign-in...";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-5 py-4 text-sm shadow-2xl shadow-black/30">
        <Loader2 size={18} className="animate-spin text-indigo-400" />
        {label}
      </div>
    </div>
  );
}
