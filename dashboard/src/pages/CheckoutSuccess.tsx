import { CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";

export default function CheckoutSuccess() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-12 max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <CheckCircle size={56} className="text-green-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">You're all set!</h1>
        <p className="text-gray-500 mb-8">
          Your subscription is active. Welcome to AutoFlow — unlimited executions, zero surprises.
        </p>
        <Link
          to="/"
          className="inline-block w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition"
        >
          Go to Dashboard
        </Link>
        <p className="mt-4 text-xs text-gray-400">
          A receipt has been sent to your email. Questions? Contact{" "}
          <a href="mailto:support@autoflow.ai" className="underline">
            support@autoflow.ai
          </a>
        </p>
      </div>
    </div>
  );
}
