"use client";

import { useState } from "react";

// Simulated workflow templates matching the real backend
const TEMPLATES = [
  {
    id: "tpl-lead-enrich",
    name: "Lead Enrichment",
    description: "Enrich leads with company context, score them with AI, and push to CRM.",
    category: "sales",
    icon: "🎯",
    fields: [
      { key: "name", label: "Full Name", placeholder: "Jane Smith", type: "text" },
      { key: "email", label: "Email", placeholder: "jane@acme.com", type: "email" },
      { key: "company", label: "Company", placeholder: "Acme Corp", type: "text" },
    ],
    steps: [
      { label: "Receive lead input", type: "trigger", duration: 200 },
      { label: "Fetch company info", type: "action", duration: 800 },
      { label: "Fetch social signals", type: "action", duration: 700 },
      { label: "Score lead with AI (0–100)", type: "llm", duration: 1200 },
      { label: "Route: hot vs nurture", type: "condition", duration: 300 },
      { label: "Upsert into CRM", type: "action", duration: 500 },
      { label: "Emit lead-processed event", type: "output", duration: 200 },
    ],
    buildOutput: (input: Record<string, string>) => ({
      lead: { name: input.name || "Jane Smith", email: input.email || "jane@acme.com", company: input.company || "Acme Corp" },
      enriched: {
        company: { industry: "SaaS", size: "51–200", funding: "Series A", techStack: ["AWS", "React", "Stripe"] },
        social: { linkedinFollowers: 1240, recentPosts: 3, engagement: "high" },
      },
      score: 84,
      routing: "hot",
      crmResult: { action: "upserted", dealValue: "$12,000", pipeline: "Enterprise" },
    }),
  },
  {
    id: "tpl-content-gen",
    name: "Content Generator",
    description: "Generate AI-written content with brand voice, SEO meta, and auto-publish routing.",
    category: "content",
    icon: "✍️",
    fields: [
      { key: "topic", label: "Topic / Brief", placeholder: "How to reduce SaaS churn by 30%", type: "text" },
      { key: "audience", label: "Target Audience", placeholder: "B2B SaaS founders", type: "text" },
      { key: "format", label: "Format", placeholder: "Blog post (1200 words)", type: "text" },
    ],
    steps: [
      { label: "Receive content brief", type: "trigger", duration: 200 },
      { label: "Generate initial draft", type: "llm", duration: 1500 },
      { label: "Apply brand voice + SEO meta", type: "llm", duration: 1000 },
      { label: "Assemble final document", type: "transform", duration: 400 },
      { label: "Route: auto-publish vs review", type: "condition", duration: 300 },
      { label: "Push to publishing queue", type: "action", duration: 400 },
      { label: "Emit content-generated event", type: "output", duration: 200 },
    ],
    buildOutput: (input: Record<string, string>) => ({
      brief: { topic: input.topic || "How to reduce SaaS churn", audience: input.audience || "B2B SaaS founders", format: input.format || "Blog post" },
      draft: {
        title: `${input.topic || "How to Reduce SaaS Churn"}: A Data-Driven Guide`,
        wordCount: 1247,
        readingTime: "6 min",
        slug: "reduce-saas-churn-guide",
      },
      seo: { metaTitle: "Reduce SaaS Churn by 30% — Proven Strategies", metaDescription: "Learn the exact playbook top SaaS companies use to slash churn.", tags: ["saas", "retention", "growth"] },
      routing: "auto-publish",
      publishedAt: new Date().toISOString(),
    }),
  },
  {
    id: "tpl-support-bot",
    name: "Customer Support Bot",
    description: "Classify inbound tickets, generate AI replies, and escalate edge cases to humans.",
    category: "support",
    icon: "🤖",
    fields: [
      { key: "subject", label: "Ticket Subject", placeholder: "My billing is wrong this month", type: "text" },
      { key: "body", label: "Customer Message", placeholder: "I was charged twice for my Pro plan...", type: "text" },
      { key: "plan", label: "Customer Plan", placeholder: "Pro", type: "text" },
    ],
    steps: [
      { label: "Receive inbound ticket", type: "trigger", duration: 200 },
      { label: "Classify intent + urgency", type: "llm", duration: 900 },
      { label: "Fetch customer account context", type: "action", duration: 600 },
      { label: "Generate AI reply", type: "llm", duration: 1100 },
      { label: "Route: auto-resolve vs escalate", type: "condition", duration: 300 },
      { label: "Send reply / assign to agent", type: "action", duration: 400 },
      { label: "Emit ticket-resolved event", type: "output", duration: 200 },
    ],
    buildOutput: (input: Record<string, string>) => ({
      ticket: { subject: input.subject || "Billing issue", body: input.body || "I was charged twice", plan: input.plan || "Pro" },
      classification: { intent: "billing_dispute", urgency: "high", sentiment: "frustrated" },
      context: { accountAge: "14 months", mrr: "$149", previousTickets: 1 },
      reply: "Hi! I can see the duplicate charge — I've already processed a refund of $149 to your card ending in 4242. It'll appear within 3–5 business days. Sorry for the hassle!",
      routing: "auto-resolved",
      resolutionTime: "3.2s",
    }),
  },
];

type StepStatus = "pending" | "running" | "done";

interface StepState {
  status: StepStatus;
}

const STEP_TYPE_COLORS: Record<string, string> = {
  trigger: "bg-emerald-100 text-emerald-700 border-emerald-200",
  action: "bg-blue-100 text-blue-700 border-blue-200",
  llm: "bg-violet-100 text-violet-700 border-violet-200",
  condition: "bg-amber-100 text-amber-700 border-amber-200",
  transform: "bg-cyan-100 text-cyan-700 border-cyan-200",
  output: "bg-gray-100 text-gray-700 border-gray-200",
};

export default function DemoPage() {
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [stepStates, setStepStates] = useState<StepState[]>([]);
  const [output, setOutput] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const handleTemplateChange = (tpl: typeof TEMPLATES[0]) => {
    setSelectedTemplate(tpl);
    setFormValues({});
    setStepStates([]);
    setOutput(null);
    setElapsed(null);
  };

  const handleRun = async () => {
    setRunning(true);
    setOutput(null);
    setElapsed(null);
    const steps = selectedTemplate.steps;
    const states: StepState[] = steps.map(() => ({ status: "pending" }));
    setStepStates([...states]);

    const startTime = Date.now();

    for (let i = 0; i < steps.length; i++) {
      states[i] = { status: "running" };
      setStepStates([...states]);
      await new Promise((r) => setTimeout(r, steps[i].duration));
      states[i] = { status: "done" };
      setStepStates([...states]);
    }

    setElapsed(Date.now() - startTime);
    setOutput(selectedTemplate.buildOutput(formValues));
    setRunning(false);
  };

  const handleReset = () => {
    setStepStates([]);
    setOutput(null);
    setElapsed(null);
    setFormValues({});
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
          <div className="flex flex-col gap-2">
            <span className="inline-flex w-fit items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
              Interactive Demo
            </span>
            <h1 className="text-3xl font-bold text-gray-900">
              See AutoFlow in action
            </h1>
            <p className="text-gray-500 max-w-2xl">
              Pick a workflow template, fill in your inputs, and watch the AI pipeline execute step-by-step. No sign-up required.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Left: Template picker + form */}
          <div className="lg:col-span-1 space-y-6">
            {/* Template selector */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                Choose a template
              </h2>
              <div className="space-y-2">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => handleTemplateChange(tpl)}
                    className={`w-full text-left rounded-xl border p-4 transition-all ${
                      selectedTemplate.id === tpl.id
                        ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600"
                        : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{tpl.icon}</span>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{tpl.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{tpl.description}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Input form */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
                Workflow input
              </h2>
              <div className="space-y-4">
                {selectedTemplate.fields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {field.label}
                    </label>
                    <input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={formValues[field.key] || ""}
                      onChange={(e) =>
                        setFormValues((v) => ({ ...v, [field.key]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleRun}
                  disabled={running}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {running ? "Running…" : "▶ Run workflow"}
                </button>
                {(output || stepStates.length > 0) && !running && (
                  <button
                    onClick={handleReset}
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right: Execution view */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step pipeline */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Pipeline
                </h2>
                {elapsed !== null && (
                  <span className="text-xs text-gray-500">
                    Completed in {(elapsed / 1000).toFixed(1)}s
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {selectedTemplate.steps.map((step, i) => {
                  const state = stepStates[i];
                  const status = state?.status ?? "pending";

                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-all ${
                        status === "running"
                          ? "bg-indigo-50 ring-1 ring-indigo-300"
                          : status === "done"
                          ? "bg-emerald-50"
                          : "bg-gray-50"
                      }`}
                    >
                      {/* Status icon */}
                      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                        {status === "done" ? (
                          <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : status === "running" ? (
                          <svg className="w-4 h-4 text-indigo-600 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3V4a10 10 0 100 20v-2a8 8 0 01-8-8z" />
                          </svg>
                        ) : (
                          <span className="text-gray-300 text-sm font-mono">{String(i + 1).padStart(2, "0")}</span>
                        )}
                      </div>

                      {/* Step label */}
                      <span className={`flex-1 text-sm font-medium ${status === "done" ? "text-gray-700" : status === "running" ? "text-indigo-700" : "text-gray-400"}`}>
                        {step.label}
                      </span>

                      {/* Type badge */}
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STEP_TYPE_COLORS[step.type]}`}>
                        {step.type}
                      </span>
                    </div>
                  );
                })}

                {/* Idle state */}
                {stepStates.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-6">
                    Fill in inputs and click <strong>Run workflow</strong> to start.
                  </p>
                )}
              </div>
            </div>

            {/* Output */}
            {output && (
              <div className="rounded-xl border border-emerald-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h2 className="text-sm font-semibold text-emerald-700 uppercase tracking-wide">
                    Workflow output
                  </h2>
                </div>
                <pre className="text-xs text-gray-700 bg-gray-50 rounded-lg p-4 overflow-auto max-h-80 leading-relaxed">
                  {JSON.stringify(output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="border-t border-gray-200 bg-white mt-10">
        <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            Ready to run this in production?
          </h2>
          <p className="mt-2 text-gray-500">
            Deploy your own AutoFlow instance in minutes. No DevOps required.
          </p>
          <div className="mt-6 flex justify-center gap-4">
            <a
              href="#pricing"
              className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
            >
              Start free
            </a>
            <a
              href="https://docs.autoflow.app/getting-started"
              className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Read the docs →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
