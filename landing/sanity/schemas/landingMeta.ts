import { defineType, defineField } from "sanity";

/**
 * Homepage meta tags (SEO) singleton. Editors set page title, descriptions,
 * and social image; when absent, the loader falls back to hardcoded copy.
 * Social image is a single OG/Twitter image; width/height are fixed (1200x630).
 */
export const landingMetaSchema = defineType({
  name: "landingMeta",
  title: "Homepage Meta Tags",
  type: "document",
  fields: [
    defineField({
      name: "pageTitle",
      title: "Page Title (browser tab)",
      type: "string",
      validation: (Rule) => Rule.max(60).warning("Aim for 50-60 characters"),
      description:
        'Shown in browser tab and search results. Current: "AutoFlow — Hire your first team of agents"',
    }),
    defineField({
      name: "metaDescription",
      title: "Meta Description",
      type: "text",
      rows: 2,
      validation: (Rule) => Rule.max(160).warning("Aim for under 160 characters"),
      description:
        'Shown in search results. Current: "Write a mission. AutoFlow drafts a hiring plan, an org, a budget, and the first week of work. Approve what matters. Watch the rest run."',
    }),
    defineField({
      name: "ogTitle",
      title: "OG Title (social share headline)",
      type: "string",
      validation: (Rule) => Rule.max(70),
      description:
        'Used when sharing on social media. Current: "AutoFlow — Hire your first team of agents"',
    }),
    defineField({
      name: "ogDescription",
      title: "OG Description (social share text)",
      type: "text",
      rows: 2,
      validation: (Rule) => Rule.max(160),
      description:
        'Shown in the preview card when shared. Current: "Workforce automation, by the role — not by the node. Bring your own keys, ship on day one."',
    }),
    defineField({
      name: "ogImage",
      title: "Social Image (OG + Twitter)",
      type: "image",
      options: { hotspot: true },
      description:
        'Single image for both og:image and twitter:image. Recommended size 1200x630px. Current: "https://helloautoflow.com/og.svg"',
      fields: [defineField({ name: "alt", title: "Alt text", type: "string" })],
    }),
    defineField({
      name: "twitterTitle",
      title: "Twitter Title",
      type: "string",
      validation: (Rule) => Rule.max(70),
      description:
        'If blank, falls back to ogTitle. Current: "AutoFlow — Hire your first team of agents"',
    }),
    defineField({
      name: "twitterDescription",
      title: "Twitter Description",
      type: "text",
      rows: 2,
      validation: (Rule) => Rule.max(200),
      description:
        'If blank, falls back to ogDescription. Current: "Workforce automation, by the role — not by the node. Bring your own keys, ship on day one."',
    }),
    defineField({
      name: "ogUrl",
      title: "OG URL (canonical)",
      type: "url",
      description: 'Current: "https://helloautoflow.com/"',
    }),
    defineField({
      name: "siteName",
      title: "Site Name (og:site_name)",
      type: "string",
      description: 'Current: "AutoFlow"',
    }),
  ],
  preview: { select: { title: "pageTitle" } },
});
