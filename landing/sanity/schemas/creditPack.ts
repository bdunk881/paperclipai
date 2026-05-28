import { defineType, defineField } from "sanity";

/**
 * Credit-pack overlay (HEL-285) — Phase 2 of the Sanity-overlay pattern.
 *
 * Editorial overlay on top of the DB-driven `credit_packs` rows. Sanity
 * owns marketing copy (tagline, CTA copy) and the "Most popular" badge
 * targeting. The DB stays the source of truth for structural pack data
 * (price, credits granted, bonus percent, sort order).
 *
 * Documents are keyed by `packId` matching `credit_packs.id`
 * (`pack_25` / `pack_50` / `pack_100` / `pack_250` / `pack_500`). All
 * overlay fields are optional — when omitted, the renderer falls
 * through to the current default behavior (auto-featured = highest
 * bonusPercent, "Most popular" badge text, "Buy {displayName}" CTA).
 */
export const creditPackSchema = defineType({
  name: "creditPackOverlay",
  title: "Credit Pack Overlay",
  type: "document",
  fields: [
    defineField({
      name: "packId",
      title: "Pack ID",
      description:
        "Matches credit_packs.id in the DB. One of: pack_25, pack_50, pack_100, pack_250, pack_500.",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "tagline",
      title: "Tagline",
      description:
        "Optional editorial subhead under the pack name (e.g. \"For weekend builders\"). Hidden when empty.",
      type: "string",
    }),
    defineField({
      name: "isFeatured",
      title: '"Most popular" override',
      description:
        "true → this pack is featured (overrides auto highest-bonusPercent). false → suppress even if auto would pick it. Leave undefined to keep the auto logic.",
      type: "boolean",
    }),
    defineField({
      name: "featuredLabel",
      title: "Featured badge label",
      description:
        'Override the "Most popular" badge text (e.g. "Best value", "Limited time"). Only applied to a pack that IS featured.',
      type: "string",
    }),
    defineField({
      name: "ctaLabel",
      title: "CTA label override",
      description:
        'Override the default "Buy {displayName}" CTA copy.',
      type: "string",
    }),
  ],
  preview: {
    select: {
      title: "packId",
      subtitle: "tagline",
    },
  },
});
