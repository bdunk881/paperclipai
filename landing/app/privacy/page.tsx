import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | AutoFlow",
  description: "How AutoFlow collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <main className="bg-white">
      <section className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
        <p className="mt-3 text-sm text-gray-500">
          Last updated: April 15, 2026
        </p>

        <div className="mt-10 space-y-8 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              Information We Collect
            </h2>
            <p className="mt-2">
              We collect account details, billing information, usage telemetry,
              and support communications so we can provide and improve AutoFlow.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              How We Use Information
            </h2>
            <p className="mt-2">
              We use data to operate the service, process payments, protect
              accounts, and communicate product updates or support responses.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">
              Data Retention and Security
            </h2>
            <p className="mt-2">
              We keep data only as long as needed for business, legal, and
              security requirements and apply technical and organizational
              safeguards to protect it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">Your Choices</h2>
            <p className="mt-2">
              You can request access, correction, or deletion of personal data
              by contacting{" "}
              <a href="mailto:hello@autoflow.app" className="text-indigo-600 hover:text-indigo-700">
                hello@autoflow.app
              </a>
              .
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
