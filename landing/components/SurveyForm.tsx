"use client";

import { useState } from "react";

export interface SurveyQuestion {
  key: string;
  label: string;
  type: "nps" | "scale-5" | "text-short" | "text-long" | "yes-no" | "dropdown" | "yes-no-maybe";
  required: boolean;
  options?: string[];
}

interface SurveyFormProps {
  surveyId: string;
  title: string;
  subtitle: string;
  estimatedTime: string;
  questions: SurveyQuestion[];
  confirmationMessage: string;
}

function NpsScale({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex gap-1.5 flex-wrap">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={`w-10 h-10 rounded-lg text-sm font-medium transition-all ${
              value === i
                ? "bg-indigo-600 text-white ring-2 ring-indigo-600 ring-offset-2"
                : "bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"
            }`}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-400 px-1">
        <span>Not likely</span>
        <span>Extremely likely</span>
      </div>
    </div>
  );
}

function Scale5({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const labels = ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"];
  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={`flex-1 min-w-[56px] py-2.5 rounded-lg text-sm font-medium transition-all ${
              value === i
                ? "bg-indigo-600 text-white ring-2 ring-indigo-600 ring-offset-2"
                : "bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"
            }`}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-400 px-1">
        <span>{labels[0]}</span>
        <span>{labels[4]}</span>
      </div>
    </div>
  );
}

export default function SurveyForm({
  surveyId,
  title,
  subtitle,
  estimatedTime,
  questions,
  confirmationMessage,
}: SurveyFormProps) {
  const [responses, setResponses] = useState<Record<string, string | number>>({});
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setValue = (key: string, value: string | number) => {
    setResponses((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    for (const q of questions) {
      if (q.required && (responses[q.key] === undefined || responses[q.key] === "")) {
        setError(`Please answer: "${q.label}"`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/survey/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveyId, email, responses }),
      });

      if (res.status === 409) {
        setError("You have already submitted this survey. Thank you!");
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Submission failed");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Response recorded</h2>
          <p className="text-gray-500">{confirmationMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <div className="flex flex-col gap-2">
            <span className="inline-flex w-fit items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
              {estimatedTime}
            </span>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            <p className="text-gray-500">{subtitle}</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-10">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Email */}
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <label className="block text-sm font-semibold text-gray-900 mb-1">
              Email address <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-3">Used to match your feedback to your account</p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Questions */}
          {questions.map((q, idx) => (
            <div key={q.key} className="rounded-xl border border-gray-200 bg-white p-6">
              <label className="block text-sm font-semibold text-gray-900 mb-1">
                {idx + 1}. {q.label} {q.required && <span className="text-red-500">*</span>}
              </label>

              {q.type === "nps" && (
                <NpsScale
                  value={responses[q.key] as number | undefined}
                  onChange={(v) => setValue(q.key, v)}
                />
              )}

              {q.type === "scale-5" && (
                <Scale5
                  value={responses[q.key] as number | undefined}
                  onChange={(v) => setValue(q.key, v)}
                />
              )}

              {q.type === "text-short" && (
                <input
                  type="text"
                  value={(responses[q.key] as string) || ""}
                  onChange={(e) => setValue(q.key, e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="Your answer"
                />
              )}

              {q.type === "text-long" && (
                <textarea
                  value={(responses[q.key] as string) || ""}
                  onChange={(e) => setValue(q.key, e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
                  placeholder="Your answer"
                />
              )}

              {q.type === "yes-no" && (
                <div className="flex gap-3">
                  {["Yes", "No"].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setValue(q.key, opt)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        responses[q.key] === opt
                          ? "bg-indigo-600 text-white ring-2 ring-indigo-600 ring-offset-2"
                          : "bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {q.type === "yes-no-maybe" && (
                <div className="flex gap-3">
                  {["Yes", "No", "Maybe later"].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setValue(q.key, opt)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        responses[q.key] === opt
                          ? "bg-indigo-600 text-white ring-2 ring-indigo-600 ring-offset-2"
                          : "bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {q.type === "dropdown" && q.options && (
                <select
                  value={(responses[q.key] as string) || ""}
                  onChange={(e) => setValue(q.key, e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Select an option</option>
                  {q.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )}
            </div>
          ))}

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Submitting..." : "Submit feedback"}
          </button>
        </form>
      </div>
    </div>
  );
}
