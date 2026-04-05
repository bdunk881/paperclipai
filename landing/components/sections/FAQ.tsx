"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface FaqItem {
  question: string;
  answer: string;
}

const FALLBACK_FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is AutoFlow?",
    answer:
      "AutoFlow is a platform for deploying fully autonomous AI-powered businesses. You define the business, AutoFlow handles the infrastructure, agents, and operations.",
  },
  {
    question: "Do I need to know how to code?",
    answer:
      "No. AutoFlow is designed for founders and operators, not engineers. You configure your business through a simple UI, and the platform handles all the technical complexity.",
  },
  {
    question: "How much does it cost?",
    answer:
      "AutoFlow has a free Explore tier to get started. Paid plans start at $19/month (Flow). See the Pricing section above for full details.",
  },
  {
    question: "Can I run multiple businesses?",
    answer:
      "Yes. The Automate and Scale plans support multiple autonomous companies from a single account, each with its own isolated agents, workflows, and billing.",
  },
  {
    question: "How does the AI agent work?",
    answer:
      "Each agent is a purpose-built AI model fine-tuned for a specific business function (sales, support, ops, etc.). Agents execute tasks autonomously, communicate with each other, and escalate to you only when needed.",
  },
  {
    question: "What integrations are available?",
    answer:
      "AutoFlow integrates with Stripe (billing), Resend (email), GitHub (code), Notion, Slack, and more. Custom integrations are available on Enterprise.",
  },
  {
    question: "Can I use my own LLM API keys?",
    answer:
      "Yes \u2014 this is a core feature. AutoFlow supports OpenAI, Anthropic, Google Gemini, and Mistral out of the box. Connect your own API keys and traffic routes directly to the provider. AutoFlow never sees your prompts or completions, and you pay providers at their standard rates with no markup.",
  },
  {
    question: "Which AI model should I use for my agents?",
    answer:
      "It depends on your use case. For complex reasoning tasks (legal, finance, strategy), we recommend Claude Opus or GPT-4o. For high-volume, cost-sensitive tasks (support, classification), Mistral or Claude Haiku are great choices. You can set a different model per agent and switch anytime without changing your workflows.",
  },
];

export function FAQ({ items }: { items?: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const faqItems = items ?? FALLBACK_FAQ_ITEMS;

  return (
    <section id="faq" className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-indigo-600">
              FAQ
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Common questions
            </p>
          </motion.div>
        </div>

        <dl className="mt-16 space-y-4">
          {faqItems.map((item, i) => (
            <motion.div
              key={item.question}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="rounded-xl border border-gray-200 overflow-hidden"
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-5 text-left text-gray-900 hover:bg-gray-50 transition-colors"
              >
                <span className="font-semibold">{item.question}</span>
                <span className="ml-6 text-indigo-600 text-xl">
                  {open === i ? "\u2212" : "+"}
                </span>
              </button>
              <AnimatePresence>
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="px-6 pb-5 text-gray-600 leading-7">
                      {item.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </dl>
      </div>
    </section>
  );
}
