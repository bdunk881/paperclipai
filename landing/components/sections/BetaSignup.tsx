"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface FormData {
  name: string;
  email: string;
  company: string;
  currentTools: string;
  useCase: string;
  caseStudyInterest: boolean;
}

const INITIAL_FORM: FormData = {
  name: "",
  email: "",
  company: "",
  currentTools: "",
  useCase: "",
  caseStudyInterest: false,
};

export function BetaSignup() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  function update<K extends keyof FormData>(field: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setStatus("success");
        setForm(INITIAL_FORM);
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  const inputClasses =
    "block w-full rounded-lg border-0 bg-white px-4 py-3 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6";

  return (
    <section id="beta-signup" className="bg-gray-50 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl text-center"
        >
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
            Limited spots available
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Apply for the AutoFlow Beta
          </h2>
          <p className="mt-4 text-lg leading-8 text-gray-600">
            Get early access to AutoFlow and help shape the future of autonomous
            AI businesses. Beta users receive priority support and lifetime
            discounts.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mx-auto mt-12 max-w-xl"
        >
          {status === "success" ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <svg
                  className="h-6 w-6 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900">
                Application received!
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                We&apos;ll review your application and get back to you within 48
                hours.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-200"
            >
              <div className="space-y-5">
                <div>
                  <label
                    htmlFor="beta-name"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="beta-name"
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="Jane Smith"
                    className={`mt-1.5 ${inputClasses}`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="beta-email"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="beta-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="jane@company.com"
                    className={`mt-1.5 ${inputClasses}`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="beta-company"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Company <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="beta-company"
                    type="text"
                    required
                    value={form.company}
                    onChange={(e) => update("company", e.target.value)}
                    placeholder="Acme Inc."
                    className={`mt-1.5 ${inputClasses}`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="beta-tools"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Current tool(s) <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="beta-tools"
                    type="text"
                    required
                    value={form.currentTools}
                    onChange={(e) => update("currentTools", e.target.value)}
                    placeholder="Zapier, Make, n8n, custom scripts..."
                    className={`mt-1.5 ${inputClasses}`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="beta-usecase"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Use case <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="beta-usecase"
                    required
                    rows={3}
                    value={form.useCase}
                    onChange={(e) => update("useCase", e.target.value)}
                    placeholder="Describe how you'd use AutoFlow..."
                    className={`mt-1.5 ${inputClasses} resize-none`}
                  />
                </div>

                <div className="flex items-start gap-3">
                  <input
                    id="beta-casestudy"
                    type="checkbox"
                    checked={form.caseStudyInterest}
                    onChange={(e) =>
                      update("caseStudyInterest", e.target.checked)
                    }
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  <label
                    htmlFor="beta-casestudy"
                    className="text-sm text-gray-600"
                  >
                    I&apos;m interested in participating in a case study and
                    sharing my experience with AutoFlow.
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={status === "loading"}
                className="mt-8 w-full rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-70 transition-colors"
              >
                {status === "loading"
                  ? "Submitting..."
                  : "Apply for Beta Access"}
              </button>

              {status === "error" && (
                <p className="mt-3 text-center text-sm text-red-600">
                  Something went wrong. Please try again.
                </p>
              )}

              <p className="mt-4 text-center text-xs text-gray-500">
                By applying, you agree to provide feedback during the beta
                period.
              </p>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  );
}
