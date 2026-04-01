import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Introduction",
};

export default function DocsHomePage() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">AutoFlow Documentation</h1>
      <p className="text-lg text-gray-500 mb-8">
        Everything you need to deploy and run autonomous AI workflows.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-12">
        <Link
          href="/getting-started"
          className="group rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all"
        >
          <div className="text-2xl mb-2">⚡</div>
          <h2 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
            Quick Start
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Get AutoFlow running locally in under 5 minutes.
          </p>
        </Link>

        <Link
          href="/api-reference"
          className="group rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all"
        >
          <div className="text-2xl mb-2">📖</div>
          <h2 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
            API Reference
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Full REST API documentation with request/response examples.
          </p>
        </Link>

        <a
          href="https://autoflow.app/demo"
          className="group rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all"
        >
          <div className="text-2xl mb-2">🎬</div>
          <h2 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
            Interactive Demo
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Run workflows in the browser — no sign-up required.
          </p>
        </a>

        <a
          href="https://github.com/autoflow-hq/autoflow"
          className="group rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all"
        >
          <div className="text-2xl mb-2">⭐</div>
          <h2 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
            GitHub
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Source code, issues, and contribution guide.
          </p>
        </a>
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mb-4">What is AutoFlow?</h2>
      <p className="text-gray-600 leading-7 mb-4">
        AutoFlow is an open-source AI workflow automation platform. It gives you a library of
        pre-built workflow templates — each one a multi-step pipeline that combines triggers,
        AI (LLM) steps, data transforms, conditional routing, and action steps into a single
        autonomous agent.
      </p>
      <p className="text-gray-600 leading-7 mb-4">
        You configure a template with your own credentials and parameters, then run it via the
        REST API or webhook triggers. AutoFlow handles execution, retries, and emitting output
        events — you just consume the results.
      </p>

      <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Built-in templates</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Template</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Category</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">What it does</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {[
              { id: "tpl-lead-enrich", name: "Lead Enrichment", cat: "sales", desc: "Enriches leads, scores with AI, routes to CRM" },
              { id: "tpl-content-gen", name: "Content Generator", cat: "content", desc: "Generates AI drafts with brand voice + SEO meta" },
              { id: "tpl-support-bot", name: "Customer Support Bot", cat: "support", desc: "Classifies tickets, generates replies, escalates edge cases" },
            ].map((tpl) => (
              <tr key={tpl.id}>
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{tpl.id}</td>
                <td className="px-4 py-3 text-gray-600">{tpl.cat}</td>
                <td className="px-4 py-3 text-gray-600">{tpl.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
