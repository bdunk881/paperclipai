import { defineType, defineField } from "sanity";

export const finalCtaSchema = defineType({
  name: "finalCta",
  title: "Final CTA Section",
  type: "document",
  fields: [
    defineField({
      name: "headline",
      title: "Headline",
      type: "string",
      description: "Main CTA headline (e.g. 'Hire your first agent today.')",
      validation: (Rule) => Rule.required().max(100),
    }),
    defineField({
      name: "description",
      title: "Description",
      type: "text",
      rows: 3,
      description: "Supporting text below the headline",
      validation: (Rule) => Rule.required().max(250),
    }),
    defineField({
      name: "primaryCtaLabel",
      title: "Primary CTA Label",
      type: "string",
      description: "Primary button text (e.g. 'Start free →')",
      validation: (Rule) => Rule.required().max(40),
    }),
    defineField({
      name: "primaryCtaUrl",
      title: "Primary CTA URL",
      type: "string",
      description: "Primary button target URL or path (e.g. '/signup')",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "secondaryCtaLabel",
      title: "Secondary CTA Label",
      type: "string",
      description: "Secondary button text (e.g. 'Watch a 90s demo')",
      validation: (Rule) => Rule.required().max(40),
    }),
    defineField({
      name: "secondaryCtaUrl",
      title: "Secondary CTA URL",
      type: "string",
      description: "Secondary button target URL or path (e.g. '/demo')",
      validation: (Rule) => Rule.required(),
    }),
  ],
});
