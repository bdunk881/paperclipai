"use client";

import { motion } from "framer-motion";

const PROVIDERS = [
  {
    name: "OpenAI",
    logo: "🟢",
    models: ["GPT-4o", "GPT-4 Turbo", "GPT-3.5 Turbo"],
    description: "Industry-leading models with broad capability coverage.",
  },
  {
    name: "Anthropic",
    logo: "🟣",
    models: ["Claude Opus", "Claude Sonnet", "Claude Haiku"],
    description: "Safety-focused models with exceptional reasoning and long context.",
  },
  {
    name: "Google Gemini",
    logo: "🔵",
    models: ["Gemini 1.5 Pro", "Gemini 1.5 Flash", "Gemini 1.0 Pro"],
    description: "Multimodal models with deep Google ecosystem integration.",
  },
  {
    name: "Mistral",
    logo: "🟠",
    models: ["Mistral Large", "Mistral Medium", "Mixtral 8x7B"],
    description: "Efficient open-weight models with European data residency.",
  },
];

const BENEFITS = [
  {
    icon: "🔑",
    title: "Your keys, your costs",
    description:
      "Use your own API keys. Pay providers directly at their rates — no AutoFlow markup on token usage.",
  },
  {
    icon: "🔄",
    title: "Switch anytime",
    description:
      "Change the model powering any agent without rewriting a single workflow. Hot-swap between providers.",
  },
  {
    icon: "🔒",
    title: "Data stays yours",
    description:
      "Traffic routes directly to your chosen provider. AutoFlow never sees your prompts or completions.",
  },
];

export function BringYourLLM() {
  return (
    <section id="bring-your-llm" className="bg-obsidian-dark py-24 sm:py-32 relative overflow-hidden">
      {/* Visual flair */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-brand-teal/5 to-transparent -z-10" />
      
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-brand-teal">
              Bring Your LLM
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Your models. Your rules. Zero lock-in.
            </p>
            <p className="mt-6 text-lg leading-8 text-slate-400">
              AutoFlow works with every major AI provider out of the box. Plug in your
              own API keys and keep full control over cost, performance, and data privacy.
            </p>
          </motion.div>
        </div>

        {/* Provider grid */}
        <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-6 sm:mt-20 lg:max-w-none lg:grid-cols-4">
          {PROVIDERS.map((provider, i) => (
            <motion.div
              key={provider.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="flex flex-col rounded-2xl bg-white/5 ring-1 ring-white/10 p-6 hover:bg-white/10 transition-colors border border-transparent hover:border-brand-teal/20 group"
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{provider.logo}</span>
                <span className="font-semibold text-white group-hover:text-brand-teal transition-colors">{provider.name}</span>
              </div>
              <p className="text-sm text-slate-400 mb-4 flex-auto">{provider.description}</p>
              <ul className="space-y-1">
                {provider.models.map((model) => (
                  <li key={model} className="text-xs text-brand-teal/70 font-mono">
                    {model}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Benefits */}
        <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-8 sm:mt-20 lg:max-w-none lg:grid-cols-3">
          {BENEFITS.map((benefit, i) => (
            <motion.div
              key={benefit.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="flex gap-4 p-4 rounded-xl border border-transparent hover:bg-white/5 transition-all"
            >
              <span className="text-2xl shrink-0">{benefit.icon}</span>
              <div>
                <h3 className="font-semibold text-white">{benefit.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  {benefit.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
