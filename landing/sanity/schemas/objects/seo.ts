import { defineType, defineField } from "sanity";

/**
 * Reusable, document-specific SEO + social object. Hand-rolled per Sanity's
 * official SEO guidance — every field is optional and the frontend fills
 * smart defaults via GROQ coalesce() (metaTitle→title, metaDescription→excerpt,
 * ogImage→coverImage, canonical→the page itself on helloautoflow.com).
 */
export const seoSchema = defineType({
  name: "seo",
  title: "SEO & Social",
  type: "object",
  options: { collapsible: true, collapsed: true },
  fields: [
    defineField({
      name: "metaTitle",
      title: "Meta title",
      description:
        "Overrides the page <title>. Aim ≤ 60 chars. Falls back to the post title when empty.",
      type: "string",
      validation: (Rule) =>
        Rule.max(60).warning("Keep under 60 characters to avoid SERP truncation"),
    }),
    defineField({
      name: "metaDescription",
      title: "Meta description",
      description: "Aim 150–160 chars. Falls back to the excerpt when empty.",
      type: "text",
      rows: 3,
      validation: (Rule) => Rule.max(160).warning("Keep under 160 characters"),
    }),
    defineField({
      name: "focusKeyword",
      title: "Focus keyword / query",
      description:
        "Primary query this page should win. Internal QA only — not output to the page.",
      type: "string",
    }),
    defineField({
      name: "ogImage",
      title: "Social share image",
      description: "1200×630 recommended. Falls back to the cover image, then /og.svg.",
      type: "image",
      options: { hotspot: true },
      fields: [defineField({ name: "alt", title: "Alt text", type: "string" })],
    }),
    defineField({
      name: "canonicalUrl",
      title: "Canonical URL (override)",
      description:
        "Only set to point at a different canonical. Default is the page itself on helloautoflow.com.",
      type: "url",
      validation: (Rule) =>
        Rule.uri({ scheme: ["https"] }).warning("Canonical should be an absolute https URL"),
    }),
    defineField({
      name: "noIndex",
      title: "Hide from search engines",
      type: "boolean",
      initialValue: false,
    }),
  ],
});
