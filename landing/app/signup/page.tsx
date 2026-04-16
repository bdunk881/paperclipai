import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign Up | AutoFlow",
  description: "Create your AutoFlow account and launch your first workflow.",
};

export default function SignupPage() {
  return (
    <main className="bg-gray-50">
      <section className="mx-auto max-w-3xl px-6 py-20 lg:px-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm sm:p-10">
          <h1 className="text-3xl font-bold text-gray-900">Get Started With AutoFlow</h1>
          <p className="mt-4 text-gray-600">
            Choose a plan and begin your free trial. You can also explore the
            interactive product demo before starting.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/#pricing"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              View pricing and start trial
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Try interactive demo
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
