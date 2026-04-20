import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | AutoFlow",
  description: "Terms that govern use of AutoFlow services.",
};

export default function TermsPage() {
  return (
    <main className="bg-white">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900">Terms of Service</h1>
        <p className="mt-3 text-sm text-gray-500">
          Last updated: April 15, 2026
        </p>

        <div className="mt-10 space-y-8 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              Acceptance of Terms
            </h2>
            <p className="mt-2">
              By using AutoFlow, you agree to these terms and all applicable
              policies. If you do not agree, do not use the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              Accounts and Billing
            </h2>
            <p className="mt-2">
              You are responsible for account security and payment obligations
              for subscribed plans. Fees are billed according to your selected
              plan and billing period.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              Acceptable Use
            </h2>
            <p className="mt-2">
              You may not use AutoFlow for unlawful activity, abuse of third
              party services, or attempts to disrupt platform operations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              Service Availability
            </h2>
            <p className="mt-2">
              We work to maintain high availability but do not guarantee
              uninterrupted operation. Scheduled maintenance or incidents may
              affect access.
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-gray-200 pt-6">
          <Link href="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            Back to homepage
          </Link>
        </div>
      </section>
    </main>
  );
}
