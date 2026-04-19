import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMsal } from "@azure/msal-react";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const { instance } = useMsal();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function completeRedirect() {
      try {
        const result = await instance.handleRedirectPromise();
        let resolvedAccount = null;
        if (result?.account) {
          instance.setActiveAccount(result.account);
          resolvedAccount = result.account;
        } else {
          const account = instance.getAllAccounts()[0];
          if (account) {
            instance.setActiveAccount(account);
            resolvedAccount = account;
          }
        }
        if (!cancelled) {
          navigate(resolvedAccount ? "/" : "/login", { replace: true });
        }
      } catch {
        if (!cancelled) navigate("/login", { replace: true });
      }
    }

    void completeRedirect();
    return () => {
      cancelled = true;
    };
  }, [instance, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600 shadow-sm">
        <Loader2 size={18} className="animate-spin" />
        Completing Microsoft sign-in...
      </div>
    </div>
  );
}
