"use client";

import { motion } from "framer-motion";

export interface Feature {
  title: string;
  description: string;
  icon: string;
}

const FALLBACK_FEATURES: Feature[] = [
  {
    title: "Autonomous Agents",
    description:
      "Pre-built AI agents for every business function: sales, support, ops, marketing, and more.",
    icon: "\u{1F916}",
  },
  {
    title: "One-Click Deploy",
    description:
      "Go from zero to production in minutes. AutoFlow handles infra, CI/CD, and scaling automatically.",
    icon: "\u26A1",
  },
  {
    title: "Revenue Infrastructure",
    description:
      "Stripe billing, invoicing, and subscription management built in. Start earning from day one.",
    icon: "\u{1F4B3}",
  },
  {
    title: "Real-Time Analytics",
    description:
      "Track agent performance, task throughput, and revenue metrics in a unified dashboard.",
    icon: "\u{1F4CA}",
  },
  {
    title: "Multi-Company",
    description:
      "Run multiple autonomous businesses from a single account. Each gets its own isolated environment.",
    icon: "\u{1F3E2}",
  },
  {
    title: "Open by Design",
    description:
      "No vendor lock-in. Fork your stack, self-host, and customize every layer of your business.",
    icon: "\u{1F513}",
  },
  {
    title: "Bring Your LLM",
    description:
      "Use your own OpenAI, Anthropic, Gemini, or Mistral API keys. Full model flexibility with zero markup on token usage.",
    icon: "\u{1F9E0}",
  },
];

export function Features({ features }: { features?: Feature[] }) {
  const items = features ?? FALLBACK_FEATURES;

  return (
    <section id="features" className="bg-gray-50 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-indigo-600">
              Features
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Everything you need to run a business on autopilot
            </p>
          </motion.div>
        </div>

        <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
          <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-10 lg:max-w-none lg:grid-cols-3">
            {items.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="flex flex-col"
              >
                <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-gray-900">
                  <span className="text-2xl">{feature.icon}</span>
                  {feature.title}
                </dt>
                <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                  <p className="flex-auto">{feature.description}</p>
                </dd>
              </motion.div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
