import { CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";

export default function CheckoutSuccess() {
  return (
    <div className="min-h-screen bg-af2-paper flex items-center justify-center p-8">
      <div className="af2-card max-w-md w-full p-12 text-center shadow-af2-lg">
        <div className="flex justify-center mb-6">
          <CheckCircle size={56} className="text-af2-sage" />
        </div>
        <h1 className="font-af2-serif text-2xl font-bold text-af2-ink mb-3">You're all set!</h1>
        <p className="text-af2-ink-2 mb-8">
          Your subscription is active. Welcome to AutoFlow — unlimited executions, zero surprises.
        </p>
        <Link
          to="/"
          className="inline-block w-full py-2.5 rounded-md bg-af2-clay hover:bg-af2-clay/85 text-white text-sm font-semibold transition"
        >
          Go to Dashboard
        </Link>
        <p className="mt-4 text-xs text-af2-ink-3">
          A receipt has been sent to your email. Questions? Contact{" "}
          <a href="mailto:support@autoflow.ai" className="underline">
            support@autoflow.ai
          </a>
        </p>
      </div>
    </div>
  );
}
