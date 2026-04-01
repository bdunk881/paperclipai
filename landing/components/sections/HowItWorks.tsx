"use client";

import { motion } from "framer-motion";

// TODO: Refine copy with CMO input from ALT-93
const STEPS = [
  {
    step: "01",
    title: "Hire",
    description:
      "Choose from a library of pre-built AI agents or define your own. Each agent is purpose-built for a specific business function.",
    icon: "🤖",
  },
  {
    step: "02",
    title: "Deploy",
    description:
      "AutoFlow wires up your agents into automated workflows and deploys them to production in one click. No DevOps required.",
    icon: "🚀",
  },
  {
    step: "03",
    title: "Earn",
    description:
      "Watch your autonomous business run 24/7 — taking orders, delivering work, and generating revenue while you sleep.",
    icon: "💰",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-indigo-600">
              How It Works
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Three steps to an autonomous business
            </p>
          </motion.div>
        </div>

        <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:max-w-none">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="relative flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
              >
                <div className="flex items-center gap-4 mb-6">
                  <span className="text-4xl">{step.icon}</span>
                  <span className="text-5xl font-bold text-indigo-100">
                    {step.step}
                  </span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900">
                  {step.title}
                </h3>
                <p className="mt-3 text-gray-600 leading-7">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
