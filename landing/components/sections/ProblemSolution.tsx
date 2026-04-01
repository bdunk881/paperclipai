"use client";

import { motion } from "framer-motion";

// TODO: Replace placeholder copy with CMO-approved messaging from ALT-93
const PROBLEMS = [
  {
    emoji: "⏱️",
    problem: "Building a business takes months",
    solution: "AutoFlow deploys in minutes",
  },
  {
    emoji: "💸",
    problem: "Hiring teams is expensive",
    solution: "AI agents cost pennies per task",
  },
  {
    emoji: "🔧",
    problem: "Ops complexity kills momentum",
    solution: "Fully automated workflows out of the box",
  },
];

export function ProblemSolution() {
  return (
    <section className="bg-gray-50 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-indigo-600">
              The Problem
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Building a business is hard.
              <br />
              <span className="text-indigo-600">AutoFlow makes it easy.</span>
            </p>
            <p className="mt-6 text-lg leading-8 text-gray-600">
              Most founders spend 80% of their time on operations, not growth.
              AutoFlow flips that ratio — AI handles the ops so you can focus on
              what matters.
            </p>
          </motion.div>
        </div>

        <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-4xl">
          <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-10 lg:max-w-none lg:grid-cols-3 lg:gap-y-16">
            {PROBLEMS.map((item, i) => (
              <motion.div
                key={item.problem}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative pl-16"
              >
                <dt className="text-base font-semibold leading-7 text-gray-900">
                  <div className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-2xl">
                    {item.emoji}
                  </div>
                  <span className="line-through text-gray-400">
                    {item.problem}
                  </span>
                </dt>
                <dd className="mt-2 text-base leading-7 text-indigo-700 font-semibold">
                  ✓ {item.solution}
                </dd>
              </motion.div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
