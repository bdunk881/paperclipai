import { AlertCircle, CheckCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { confirmAutoTopupSetup } from "../api/creditsApi";
import { useAuth } from "../context/AuthContext";

type Status =
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

/**
 * Landing page after Stripe redirects back from auto-topup setup
 * checkout (mode='setup'). Calls /api/credits/wallet/setup-checkout/confirm
 * to attach the new payment method synchronously. The setup_intent.succeeded
 * webhook also processes the same session — both writers are idempotent.
 */
export default function AutoTopupSetupSuccess() {
  const { requireAccessToken } = useAuth();
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    if (!sessionId) {
      setStatus({ kind: "error", message: "Missing session_id in the redirect URL." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await requireAccessToken();
        await confirmAutoTopupSetup(token, sessionId);
        if (!cancelled) setStatus({ kind: "ok" });
      } catch (err) {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : "Could not confirm the setup",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, requireAccessToken]);

  return (
    <div className="min-h-screen bg-af2-paper flex items-center justify-center p-8">
      <div className="af2-card max-w-md w-full p-12 text-center shadow-af2-lg">
        {status.kind === "loading" ? (
          <>
            <h1 className="font-af2-serif text-2xl font-bold text-af2-ink mb-3">
              Saving your card…
            </h1>
            <p className="text-af2-ink-2">Almost done — attaching the payment method.</p>
          </>
        ) : status.kind === "ok" ? (
          <>
            <div className="flex justify-center mb-6">
              <CheckCircle size={56} className="text-af2-sage" />
            </div>
            <h1 className="font-af2-serif text-2xl font-bold text-af2-ink mb-3">
              Card saved
            </h1>
            <p className="text-af2-ink-2 mb-8">
              Your payment method is now on file. Head back to billing to enable auto-topup and
              set your threshold and amount.
            </p>
            <Link
              to="/billing"
              className="inline-block w-full py-2.5 rounded-md bg-af2-clay hover:bg-af2-clay/85 text-white text-sm font-semibold transition"
            >
              Back to billing
            </Link>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-6">
              <AlertCircle size={56} className="text-af2-clay" />
            </div>
            <h1 className="font-af2-serif text-2xl font-bold text-af2-ink mb-3">
              Setup didn't finalize
            </h1>
            <p className="text-af2-ink-2 mb-2">{status.message}</p>
            <p className="text-af2-ink-3 text-sm mb-8">
              If Stripe accepted the card, the webhook will still attach it within a minute or
              two. Refresh /billing to confirm — or try adding the card again.
            </p>
            <Link
              to="/billing"
              className="inline-block w-full py-2.5 rounded-md bg-af2-clay hover:bg-af2-clay/85 text-white text-sm font-semibold transition"
            >
              Go to billing
            </Link>
          </>
        )}
        <p className="mt-4 text-xs text-af2-ink-3">
          Questions?{" "}
          <a href="mailto:support@autoflow.ai" className="underline">
            support@autoflow.ai
          </a>
        </p>
      </div>
    </div>
  );
}
