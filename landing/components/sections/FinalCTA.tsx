"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

export function FinalCTA() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {  // POST → Zapier webhook → Attio
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setStatus("success");
        setEmail("");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="bg-brand-teal py-24 sm:py-32 relative overflow-hidden">
      {/* Decorative elements */}
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
         <div className="absolute top-[10%] left-[5%] w-64 h-64 rounded-full bg-white blur-3xl" />
         <div className="absolute bottom-[10%] right-[5%] w-64 h-64 rounded-full bg-white blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl text-center"
        >
          <h2 className="text-3xl font-bold tracking-tight text-obsidian-dark sm:text-4xl">
            Ready to build your autonomous business?
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-obsidian-dark/70">
            Join the waitlist or start your free trial today. No credit card
            required.
          </p>

          {status === "success" ? (
            <p className="mt-10 text-lg font-semibold text-obsidian-dark">
              ✓ You&apos;re on the list! We&apos;ll be in touch soon.
            </p>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="min-w-0 flex-auto rounded-md border-0 bg-obsidian-dark/10 px-3.5 py-2 text-obsidian-dark shadow-sm ring-1 ring-inset ring-obsidian-dark/20 placeholder:text-obsidian-dark/50 focus:ring-2 focus:ring-inset focus:ring-obsidian-dark sm:text-sm sm:leading-6"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="flex-none rounded-md bg-obsidian-dark px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-obsidian-dark disabled:opacity-70 transition-all"
              >
                {status === "loading" ? "Joining…" : "Join waitlist"}
              </button>
            </form>
          )}

          {status === "error" && (
            <p className="mt-3 text-sm text-red-700">
              Something went wrong. Please try again.
            </p>
          )}

          <div className="mt-8">
            <Link
              href="#pricing"
              className="text-sm font-semibold text-obsidian-dark/80 hover:text-obsidian-dark transition-colors"
            >
              Or start free trial →
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
