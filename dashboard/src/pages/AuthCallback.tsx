import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { writeStoredAuthUser } from "../auth/authStorage";
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

        writeStoredAuthUser(session.user);
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
    <div className="flex min-h-screen items-center justify-center bg-af2-paper px-6 text-af2-ink">
      <div className="flex items-center gap-3 rounded-md border border-af2-line bg-af2-card px-5 py-4 text-sm shadow-[0_18px_40px_rgba(26,20,16,0.08)]">
        <Loader2 size={18} className="animate-spin text-af2-clay" />
        <span className="font-af2-serif text-base text-af2-ink">Signing you in…</span>
      </div>
    </div>
  );
}
