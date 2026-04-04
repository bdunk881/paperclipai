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
              ROI Calculator
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              See how much you&apos;ll save
            </p>
            <p className="mt-6 text-lg leading-8 text-gray-600">
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
          <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-900/5 sm:p-10">
            {/* Slider */}
            <div className="text-center">
              <label
                htmlFor="hours-slider"
                className="text-sm font-medium text-gray-700"
              >
                Hours spent on manual tasks per week
              </label>
              <div className="mt-4 flex items-center justify-center gap-4">
                <span className="text-sm text-gray-500">1</span>
                <input
                  id="hours-slider"
                  type="range"
                  min={1}
                  max={40}
                  value={hoursPerWeek}
                  onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                  className="h-2 w-full max-w-md cursor-pointer appearance-none rounded-lg bg-gray-200 accent-indigo-600"
                />
                <span className="text-sm text-gray-500">40</span>
              </div>
              <p className="mt-3 text-4xl font-bold text-indigo-600">
                {hoursPerWeek} hrs/week
              </p>
            </div>

            {/* Results */}
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div className="rounded-xl bg-indigo-50 p-6 text-center">
                <TrendingUp
                  className="mx-auto h-8 w-8 text-indigo-600"
                  aria-hidden="true"
                />
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  ${monthlySavings > 0 ? monthlySavings.toLocaleString() : 0}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Monthly savings
                </p>
              </div>

              <div className="rounded-xl bg-indigo-50 p-6 text-center">
                <Clock
                  className="mx-auto h-8 w-8 text-indigo-600"
                  aria-hidden="true"
                />
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  {hoursSavedPerYear.toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Hours saved per year
                </p>
              </div>

              <div className="rounded-xl bg-indigo-50 p-6 text-center">
                <Calculator
                  className="mx-auto h-8 w-8 text-indigo-600"
                  aria-hidden="true"
                />
                <p className="mt-3 text-3xl font-bold text-gray-900">
                  ${annualSavings > 0 ? annualSavings.toLocaleString() : 0}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Annual savings
                </p>
              </div>
            </div>

            {paybackMonths > 0 && (
              <p className="mt-8 text-center text-sm text-gray-500">
                AutoFlow pays for itself in{" "}
                <span className="font-semibold text-indigo-600">
                  {paybackMonths} {paybackMonths === 1 ? "month" : "months"}
                </span>
                . Based on $25/hr average labor cost.
              </p>
            )}

            <div className="mt-8 text-center">
              <a
                href="#pricing"
                className="inline-flex items-center rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
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
