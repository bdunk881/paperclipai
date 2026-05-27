import { defineType, defineField } from "sanity";

/**
 * Pricing tier overlay (HEL-278).
 *
 * Editorial overlay on top of the DB-driven `subscription_tiers` rows
 * shipped in HEL-267. Sanity owns marketing copy that wants to evolve
 * faster than the deploy cadence (eyebrow tag, bullet copy, CTA label,
 * price-unit label). The DB stays the source of truth for *structural*
 * pricing (price, currency, trial days, isPopular, stripePriceEnv).
 *
 * Documents are keyed by `tierId` matching `subscription_tiers.id`
 * (`explore` / `flow` / `automate` / `scale`). All overlay fields are
 * optional — when omitted, the loader falls through to the DB value
 * (or the inline EYEBROW_BY_ID fallback in landing/app/page.tsx).
 */
export const pricingSchema = defineType({
  name: "pricingTierOverlay",
  title: "Pricing Tier Overlay",
  type: "document",
  fields: [
    defineField({
      name: "tierId",
      title: "Tier ID",
      description:
        "Matches subscription_tiers.id in the DB. One of: explore, flow, automate, scale.",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "eyebrow",
      title: "Eyebrow tagline",
      description:
        "Short label above the tier name (e.g. \"Most teams\"). Falls back to the inline map in page.tsx when omitted.",
      type: "string",
    }),
    defineField({
      name: "bullets",
      title: "Bullet copy",
      description:
        "Marketing bullet points for this tier. When present, REPLACES the API's features[] for this tier. Leave empty to use the DB list.",
      type: "array",
      of: [{ type: "string" }],
    }),
    defineField({
      name: "ctaLabel",
      title: "CTA label override",
      description:
        "Optional override for the API's cta_label. Useful for A/B testing copy without a DB write.",
      type: "string",
    }),
    defineField({
      name: "priceUnit",
      title: "Price unit override",
      description:
        "Optional override for the API's price_unit (e.g. \"/seat/mo\", \"/mo\").",
      type: "string",
    }),
  ],
  preview: {
    select: {
      title: "tierId",
      subtitle: "eyebrow",
    },
  },
});
