import { CheckCircle, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { confirmCreditPackPurchase, formatCredits } from "../api/creditsApi";
import { useAuth } from "../context/AuthContext";

type Status =
  | { kind: "loading" }
  | { kind: "ok"; creditsGranted: string | null; alreadyGranted: boolean }
  | { kind: "error"; message: string };

/**
 * Landing target for Stripe Checkout success redirect from a credit-pack
 * purchase. Calls /api/credits/checkout/confirm to grant credits
 * synchronously before the webhook lands. Safe to retry — the backend
 * dedupes by stripe_session_id in credit_purchase_events.
 *
 * Note: the webhook also processes the same session and runs the same
 * dedupe, so if the user closes this page mid-confirm or refreshes, the
 * grant still happens — they just see it on the next /billing visit.
 */
export default function CreditPackSuccess() {
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
        const result = await confirmCreditPackPurchase(token, sessionId);
        if (cancelled) return;
        setStatus({
          kind: "ok",
          creditsGranted: result.creditsGranted ?? null,
          alreadyGranted: result.alreadyGranted === true,
        });
      } catch (err) {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : "Could not confirm the purchase",
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
              Finalizing your purchase…
            </h1>
            <p className="text-af2-ink-2">Crediting your wallet. This usually takes a second.</p>
          </>
        ) : status.kind === "ok" ? (
          <>
            <div className="flex justify-center mb-6">
              <CheckCircle size={56} className="text-af2-sage" />
            </div>
            <h1 className="font-af2-serif text-2xl font-bold text-af2-ink mb-3">
              {status.alreadyGranted ? "Credits ready" : "Credits added"}
            </h1>
            <p className="text-af2-ink-2 mb-8">
              {status.creditsGranted
                ? `${formatCredits(status.creditsGranted)} credits are now in your wallet.`
                : "Your purchase is confirmed and your wallet has been topped up."}
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
              Confirmation failed
            </h1>
            <p className="text-af2-ink-2 mb-2">{status.message}</p>
            <p className="text-af2-ink-3 text-sm mb-8">
              Don't worry — if Stripe charged you, the webhook will still credit your wallet within a
              few minutes. Refresh /billing to check.
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
