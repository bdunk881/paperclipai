"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Check, X } from "lucide-react";

type CompetitorKey = "zapier" | "make" | "n8n";

interface ComparisonRow {
  feature: string;
  autoflow: string | boolean;
  competitor: string | boolean;
}

const COMPETITORS: Record<
  CompetitorKey,
  { name: string; pitch: string; rows: ComparisonRow[] }
> = {
  zapier: {
    name: "Zapier",
    pitch: "20x more tasks at lower price + built-in API",
    rows: [
      { feature: "Free tier tasks", autoflow: "50/mo", competitor: "100/mo" },
      { feature: "Paid tier tasks (starter)", autoflow: "500/mo", competitor: "750/mo" },
      { feature: "REST API access", autoflow: true, competitor: false },
      { feature: "AI-native agents", autoflow: true, competitor: false },
      { feature: "Multi-step workflows", autoflow: true, competitor: true },
      { feature: "Custom integrations", autoflow: true, competitor: true },
      { feature: "Starter price", autoflow: "$19/mo", competitor: "$29.99/mo" },
      { feature: "Team plan price", autoflow: "$99/mo", competitor: "$103.50/mo" },
    ],
  },
  make: {
    name: "Make.com",
    pitch: "Same power, simpler UX. Learn in minutes, not weeks.",
    rows: [
      { feature: "Setup time", autoflow: "~5 min", competitor: "30+ min" },
      { feature: "AI-native (Claude/GPT)", autoflow: true, competitor: false },
      { feature: "Visual builder", autoflow: true, competitor: true },
      { feature: "Error handling", autoflow: "Automatic", competitor: "Manual" },
      { feature: "REST API", autoflow: true, competitor: true },
      { feature: "Self-service onboarding", autoflow: true, competitor: true },
      { feature: "Starter price", autoflow: "$19/mo", competitor: "$10.59/mo" },
      { feature: "Team collaboration", autoflow: true, competitor: true },
    ],
  },
  n8n: {
    name: "n8n",
    pitch: "Hosted, no DevOps needed. Works for SMBs AND developers.",
    rows: [
      { feature: "Hosted solution", autoflow: true, competitor: false },
      { feature: "No DevOps required", autoflow: true, competitor: false },
      { feature: "Open source", autoflow: false, competitor: true },
      { feature: "SMB-friendly pricing", autoflow: true, competitor: false },
      { feature: "AI-native agents", autoflow: true, competitor: false },
      { feature: "Team collaboration", autoflow: true, competitor: true },
      { feature: "Self-hosting option", autoflow: false, competitor: true },
      { feature: "REST API", autoflow: true, competitor: true },
    ],
  },
};

function CellValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="mx-auto h-5 w-5 text-brand-teal" aria-label="Yes" />
    ) : (
      <X className="mx-auto h-5 w-5 text-slate-700" aria-label="No" />
    );
  }
  return <span>{value}</span>;
}

export function CompetitorComparison() {
  const [selected, setSelected] = useState<CompetitorKey>("zapier");
  const competitor = COMPETITORS[selected];

  return (
    <section className="bg-slate-950 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-brand-teal">
              Compare
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              How AutoFlow stacks up
            </p>
            <p className="mt-6 text-lg leading-8 text-slate-400">
              See how we compare to other automation platforms.
            </p>
          </motion.div>
        </div>

        {/* Competitor Tabs */}
        <div className="mt-10 flex justify-center">
          <nav className="flex gap-1 rounded-full bg-slate-900 p-1 ring-1 ring-white/10" aria-label="Competitor">
            {(Object.keys(COMPETITORS) as CompetitorKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                  selected === key
                    ? "bg-brand-teal text-obsidian-dark shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                vs {COMPETITORS[key].name}
              </button>
            ))}
          </nav>
        </div>

        {/* Switch Pitch */}
        <motion.p
          key={selected}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-6 text-center text-sm font-medium text-brand-teal"
        >
          AutoFlow: {competitor.pitch}
        </motion.p>

        {/* Comparison Table */}
        <motion.div
          key={`table-${selected}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl ring-1 ring-white/10"
        >
          <table className="w-full text-sm text-slate-300">
            <thead>
              <tr className="bg-white/5">
                <th className="px-6 py-4 text-left font-semibold text-white">
                  Feature
                </th>
                <th className="px-6 py-4 text-center font-semibold text-brand-teal">
                  AutoFlow
                </th>
                <th className="px-6 py-4 text-center font-semibold text-slate-500">
                  {competitor.name}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {competitor.rows.map((row, i) => (
                <tr
                  key={row.feature}
                  className={i % 2 === 0 ? "bg-transparent" : "bg-white/5"}
                >
                  <td className="px-6 py-3">{row.feature}</td>
                  <td className="px-6 py-3 text-center font-medium text-white">
                    <CellValue value={row.autoflow} />
                  </td>
                  <td className="px-6 py-3 text-center text-slate-500">
                    <CellValue value={row.competitor} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        <div className="mt-10 text-center">
          <a
            href="#pricing"
            className="inline-flex items-center rounded-lg bg-brand-teal px-6 py-3 text-sm font-semibold text-obsidian-dark shadow-sm hover:bg-teal-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
          >
            Switch to AutoFlow
          </a>
        </div>
      </div>
    </section>
  );
}
