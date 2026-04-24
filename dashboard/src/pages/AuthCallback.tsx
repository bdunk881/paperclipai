import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const id = window.setTimeout(() => {
      navigate("/login", { replace: true });
    }, 250);

    return () => window.clearTimeout(id);
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-5 py-4 text-sm shadow-2xl shadow-black/30">
        <Loader2 size={18} className="animate-spin text-indigo-400" />
        Redirect-based sign-in is disabled. Returning to the native auth screen...
      </div>
    </div>
  );
}
