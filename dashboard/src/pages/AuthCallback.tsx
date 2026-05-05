import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { writeStoredAuthSession } from "../auth/authStorage";
import { getSupabaseStoredSession } from "../auth/supabaseAuth";

function encodeErrorMessage(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    void getSupabaseStoredSession()
      .then((session) => {
        if (cancelled) {
          return;
        }

        if (!session) {
          navigate(
            `/login?authError=${encodeErrorMessage("The sign-in link is invalid, expired, or missing a session.")}`,
            { replace: true }
          );
          return;
        }

        writeStoredAuthSession(session);
        navigate("/", { replace: true });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "Supabase sign-in could not be completed.";
        navigate(`/login?authError=${encodeErrorMessage(message)}`, { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-5 py-4 text-sm shadow-2xl shadow-black/30">
        <Loader2 size={18} className="animate-spin text-indigo-400" />
        Completing Supabase sign-in...
      </div>
    </div>
  );
}
