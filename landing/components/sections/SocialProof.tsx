"use client";

import { motion } from "framer-motion";

export interface Testimonial {
  quote: string;
  author: string;
  title: string;
  initials: string;
}

const FALLBACK_TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "AutoFlow cut our operational overhead by 80%. We launched a new product line in two weeks instead of six months.",
    author: "Sarah K.",
    title: "Founder, TechCo",
    initials: "SK",
  },
  {
    quote:
      "The autonomous agents handle our entire customer support pipeline. Response times went from hours to seconds.",
    author: "Marcus R.",
    title: "CTO, DataStream",
    initials: "MR",
  },
  {
    quote:
      "We run three separate revenue-generating businesses from one AutoFlow account. The multi-company support is a game changer.",
    author: "Elena V.",
    title: "Serial Entrepreneur",
    initials: "EV",
  },
];

export function SocialProof({
  testimonials,
}: {
  testimonials?: Testimonial[];
}) {
  const items = testimonials ?? FALLBACK_TESTIMONIALS;

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
              Social Proof
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Loved by founders and operators
            </p>
          </motion.div>
        </div>

        <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-8 lg:mx-0 lg:max-w-none lg:grid-cols-3">
          {items.map((testimonial, i) => (
            <motion.figure
              key={testimonial.author}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl bg-white/5 p-8 shadow-xl ring-1 ring-white/10 backdrop-blur-sm"
            >
              <blockquote className="text-white">
                <p className="text-sm leading-7 italic text-slate-300">
                  &ldquo;{testimonial.quote}&rdquo;
                </p>
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-x-4 border-t border-white/5 pt-6">
                <div className="h-10 w-10 rounded-full bg-brand-teal flex items-center justify-center text-obsidian-dark text-sm font-semibold shadow-[0_0_15px_rgba(20,184,166,0.3)]">
                  {testimonial.initials}
                </div>
                <div>
                  <div className="font-semibold text-white">
                    {testimonial.author}
                  </div>
                  <div className="text-slate-500 text-sm">
                    {testimonial.title}
                  </div>
                </div>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
