"use client";

import { motion } from "framer-motion";
import Link from "next/link";

interface HeroProps {
  headline?: string;
  subheadline?: string;
  primaryCta?: string;
  primaryCtaUrl?: string;
  secondaryCta?: string;
  socialProofLine?: string;
}

// TODO: Replace placeholder copy with CMO-approved content from ALT-93
const DEFAULTS: Required<HeroProps> = {
  headline: "Hire AI. Deploy Fast. Earn More.",
  subheadline:
    "AutoFlow lets you spin up fully autonomous AI businesses in minutes — complete with agents, workflows, and revenue infrastructure.",
  primaryCta: "Start free",
  primaryCtaUrl: "#pricing",
  secondaryCta: "Book a demo",
  socialProofLine: "Trusted by 500+ teams. No credit card required.",
};

export function Hero(props: HeroProps) {
  const {
    headline,
    subheadline,
    primaryCta,
    primaryCtaUrl,
    secondaryCta,
    socialProofLine,
  } = { ...DEFAULTS, ...props };

  return (
    <section className="relative isolate overflow-hidden bg-obsidian-dark">
      {/* Neon Trace Background Elements */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-[10%] left-[20%] h-[40%] w-[1px] bg-gradient-to-b from-transparent via-brand-teal to-transparent opacity-20 blur-[1px]" />
        <div className="absolute top-[20%] -left-[5%] h-[1px] w-[30%] bg-gradient-to-r from-transparent via-brand-teal to-transparent opacity-30 blur-[2px]" />
        <div className="absolute top-[60%] right-[10%] h-[1px] w-[20%] bg-gradient-to-r from-transparent via-brand-teal to-transparent opacity-20 blur-[1px]" />
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
      >
        <div
          className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-brand-teal to-brand-indigo opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
          style={{
            clipPath:
              "polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)",
          }}
        />
      </div>

      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32 lg:px-8 lg:py-40">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="mb-6 inline-flex items-center rounded-full bg-brand-teal/10 px-3 py-1 text-sm font-medium text-brand-teal ring-1 ring-inset ring-brand-teal/20">
              Now in beta — limited spots available
            </span>

            <h1 className="mt-4 text-5xl font-bold tracking-tight text-white sm:text-7xl">
              {headline}
            </h1>

            <p className="mt-6 text-lg leading-8 text-slate-400">{subheadline}</p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href={primaryCtaUrl}
                className="rounded-lg bg-brand-teal px-6 py-3 text-base font-semibold text-obsidian-dark shadow-sm hover:bg-teal-400 transition-colors"
              >
                {primaryCta}
              </Link>
              <Link
                href="#demo"
                className="text-base font-semibold text-white hover:text-brand-teal transition-colors"
              >
                {secondaryCta} <span aria-hidden="true">→</span>
              </Link>
            </div>

            {socialProofLine && (
              <p className="mt-6 text-sm text-slate-500">{socialProofLine}</p>
            )}
          </motion.div>
        </div>

        {/* Product screenshot placeholder */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-16 flow-root sm:mt-24"
        >
          <div className="-m-2 rounded-xl bg-white/5 p-2 ring-1 ring-inset ring-white/10 lg:-m-4 lg:rounded-2xl lg:p-4">
            <div className="aspect-[16/9] rounded-md bg-gradient-to-br from-slate-800 to-obsidian-dark flex items-center justify-center text-slate-500 text-sm shadow-2xl ring-1 ring-white/10 border border-white/5">
              {/* TODO: Replace with actual product screenshot once available */}
              <div className="flex flex-col items-center gap-2">
                <div className="h-12 w-12 rounded-full border-2 border-brand-teal/30 flex items-center justify-center">
                   <div className="h-6 w-6 rounded-full bg-brand-teal animate-pulse" />
                </div>
                <span>Autonomous Workspace Preview</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
