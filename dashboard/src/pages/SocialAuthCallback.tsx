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
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-5 py-4 text-sm shadow-2xl shadow-black/30">
        <Loader2 size={18} className="animate-spin text-indigo-400" />
        Redirecting to the current login flow...
      </div>
    </div>
  );
}
