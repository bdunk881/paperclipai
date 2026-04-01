import { defineType, defineField } from "sanity";

export const heroSchema = defineType({
  name: "hero",
  title: "Hero Section",
  type: "document",
  fields: [
    defineField({
      name: "headline",
      title: "Headline",
      type: "string",
      description: "Main hero headline (e.g. 'Hire AI. Deploy Fast. Earn More.')",
      validation: (Rule) => Rule.required().max(100),
    }),
    defineField({
      name: "subheadline",
      title: "Subheadline",
      type: "text",
      rows: 3,
      validation: (Rule) => Rule.required().max(250),
    }),
    defineField({
      name: "primaryCta",
      title: "Primary CTA Label",
      type: "string",
      validation: (Rule) => Rule.required().max(40),
    }),
    defineField({
      name: "primaryCtaUrl",
      title: "Primary CTA URL",
      type: "url",
    }),
    defineField({
      name: "secondaryCta",
      title: "Secondary CTA Label",
      type: "string",
    }),
    defineField({
      name: "heroImage",
      title: "Hero Image / Product Screenshot",
      type: "image",
      options: { hotspot: true },
    }),
    defineField({
      name: "socialProofLine",
      title: "Social Proof Line (below CTA)",
      type: "string",
      description: "e.g. 'Trusted by 500+ teams. No credit card required.'",
    }),
  ],
});
