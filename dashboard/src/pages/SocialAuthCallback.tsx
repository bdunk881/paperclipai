import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

function encodeErrorMessage(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export default function SocialAuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(
      `/login?socialAuthError=${encodeErrorMessage("Legacy social callback is disabled. Use Google or GitHub from the login page.")}`,
      { replace: true }
    );
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-af2-paper px-6 text-af2-ink">
      <div className="flex items-center gap-3 rounded-md border border-af2-line bg-af2-card px-5 py-4 text-sm shadow-[0_18px_40px_rgba(26,20,16,0.08)]">
        <Loader2 size={18} className="animate-spin text-af2-clay" />
        <span className="font-af2-serif text-base text-af2-ink">Redirecting to the current sign-in flow…</span>
      </div>
    </div>
  );
}
