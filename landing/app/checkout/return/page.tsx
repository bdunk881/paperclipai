"use client";

import { useEffect, useState } from "react";

export default function CheckoutReturn() {
  const [status, setStatus] = useState<"loading" | "complete" | "open">(
    "loading"
  );

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get(
      "session_id"
    );
    if (!sessionId) return;

    fetch(`/api/checkout/session-status?session_id=${sessionId}`)
      .then((res) => res.json())
      .then((data: { status?: string }) => {
        setStatus(data.status === "complete" ? "complete" : "open");
      })
      .catch(() => setStatus("open"));
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-gray-500">Confirming your payment...</p>
      </div>
    );
  }

  if (status === "open") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Payment incomplete
          </h1>
          <p className="text-gray-500 mb-6">
            Your checkout session is still open. Please try again.
          </p>
          <a
            href="/#pricing"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Back to pricing
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-7 w-7 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          You&apos;re all set!
        </h1>
        <p className="text-gray-500 mb-8">
          Your subscription is active. Welcome to AutoFlow — we&apos;ll send a
          receipt to your email.
        </p>
        <a
          href="/"
          className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
