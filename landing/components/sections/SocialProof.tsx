"use client";

import { motion } from "framer-motion";

// TODO: Replace with real testimonials from Sanity CMS once available
const TESTIMONIALS = [
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

export function SocialProof() {
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
              Social Proof
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Loved by founders and operators
            </p>
          </motion.div>
        </div>

        <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-8 lg:mx-0 lg:max-w-none lg:grid-cols-3">
          {TESTIMONIALS.map((testimonial, i) => (
            <motion.figure
              key={testimonial.author}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-900/5"
            >
              <blockquote className="text-gray-900">
                <p className="text-sm leading-7">&ldquo;{testimonial.quote}&rdquo;</p>
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-x-4">
                <div className="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-semibold">
                  {testimonial.initials}
                </div>
                <div>
                  <div className="font-semibold text-gray-900">
                    {testimonial.author}
                  </div>
                  <div className="text-gray-600 text-sm">{testimonial.title}</div>
                </div>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
