"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Calculator, TrendingUp, Clock } from "lucide-react";

const HOURLY_RATE = 25;
const AUTOFLOW_MONTHLY = 49; // Automate tier

export function ROICalculator() {
  const [hoursPerWeek, setHoursPerWeek] = useState(10);

  const monthlySavings =
    hoursPerWeek * 4 * HOURLY_RATE - AUTOFLOW_MONTHLY;
  const annualSavings = monthlySavings * 12;
  const hoursSavedPerYear = hoursPerWeek * 52;
  const paybackMonths =
    monthlySavings > 0
      ? Math.max(1, Math.ceil(AUTOFLOW_MONTHLY / (hoursPerWeek * 4 * HOURLY_RATE)))
      : 0;

  return (
    <section className="bg-obsidian-dark py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-brand-teal">
              ROI Calculator
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              See how much you&apos;ll save
            </p>
            <p className="mt-6 text-lg leading-8 text-slate-400">
              How many hours per week do you spend on repetitive tasks?
            </p>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-12 max-w-3xl"
        >
          <div className="rounded-2xl bg-slate-900/50 p-8 shadow-xl ring-1 ring-white/10 sm:p-10 backdrop-blur-sm">
            {/* Slider */}
            <div className="text-center">
              <label
                htmlFor="hours-slider"
                className="text-sm font-medium text-slate-300"
              >
                Hours spent on manual tasks per week
              </label>
              <div className="mt-4 flex items-center justify-center gap-4">
                <span className="text-sm text-slate-500">1</span>
                <input
                  id="hours-slider"
                  type="range"
                  min={1}
                  max={40}
                  value={hoursPerWeek}
                  onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                  className="h-2 w-full max-w-md cursor-pointer appearance-none rounded-lg bg-slate-800 accent-brand-teal"
                />
                <span className="text-sm text-slate-500">40</span>
              </div>
              <p className="mt-3 text-4xl font-bold text-brand-teal">
                {hoursPerWeek} hrs/week
              </p>
            </div>

            {/* Results */}
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div className="rounded-xl bg-white/5 border border-white/10 p-6 text-center">
                <TrendingUp
                  className="mx-auto h-8 w-8 text-brand-teal"
                  aria-hidden="true"
                />
                <p className="mt-3 text-3xl font-bold text-white">
                  ${monthlySavings > 0 ? monthlySavings.toLocaleString() : 0}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Monthly savings
                </p>
              </div>

              <div className="rounded-xl bg-white/5 border border-white/10 p-6 text-center">
                <Clock
                  className="mx-auto h-8 w-8 text-brand-teal"
                  aria-hidden="true"
                />
                <p className="mt-3 text-3xl font-bold text-white">
                  {hoursSavedPerYear.toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Hours saved per year
                </p>
              </div>

              <div className="rounded-xl bg-white/5 border border-white/10 p-6 text-center">
                <Calculator
                  className="mx-auto h-8 w-8 text-brand-teal"
                  aria-hidden="true"
                />
                <p className="mt-3 text-3xl font-bold text-white">
                  ${annualSavings > 0 ? annualSavings.toLocaleString() : 0}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Annual savings
                </p>
              </div>
            </div>

            {paybackMonths > 0 && (
              <p className="mt-8 text-center text-sm text-slate-500">
                AutoFlow pays for itself in{" "}
                <span className="font-semibold text-brand-teal">
                  {paybackMonths} {paybackMonths === 1 ? "month" : "months"}
                </span>
                . Based on $25/hr average labor cost.
              </p>
            )}

            <div className="mt-8 text-center">
              <a
                href="#pricing"
                className="inline-flex items-center rounded-lg bg-brand-teal px-6 py-3 text-sm font-semibold text-obsidian-dark shadow-sm hover:bg-teal-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
              >
                Start your free trial
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
