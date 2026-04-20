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
  primaryCta: "Apply for beta",
  primaryCtaUrl: "#beta-signup",
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
    <section className="relative isolate overflow-hidden bg-white">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
      >
        <div
          className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-indigo-200 to-violet-400 opacity-30 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
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
            <span className="mb-6 inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
              Now in beta — limited spots available
            </span>

            <h1 className="mt-4 text-5xl font-bold tracking-tight text-gray-900 sm:text-7xl">
              {headline}
            </h1>

            <p className="mt-6 text-lg leading-8 text-gray-600">{subheadline}</p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href={primaryCtaUrl}
                className="rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
              >
                {primaryCta}
              </Link>
              <Link
                href="#demo"
                className="text-base font-semibold text-gray-900 hover:text-indigo-600 transition-colors"
              >
                {secondaryCta} <span aria-hidden="true">→</span>
              </Link>
            </div>

            {socialProofLine && (
              <p className="mt-6 text-sm text-gray-500">{socialProofLine}</p>
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
          <div className="-m-2 rounded-xl bg-gray-900/5 p-2 ring-1 ring-inset ring-gray-900/10 lg:-m-4 lg:rounded-2xl lg:p-4">
            <div className="aspect-[16/9] rounded-md bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center text-gray-400 text-sm shadow-2xl ring-1 ring-gray-900/10">
              {/* TODO: Replace with actual product screenshot once available */}
              Product screenshot / demo
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
