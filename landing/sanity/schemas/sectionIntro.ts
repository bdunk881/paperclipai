import { defineType, defineField } from "sanity";

export const sectionIntroSchema = defineType({
  name: "sectionIntro",
  title: "Section Introduction",
  type: "document",
  fields: [
    defineField({
      name: "sectionKey",
      title: "Section Key",
      type: "string",
      description:
        "Unique identifier: how-it-works, workforce, integrations, pricing, credit-packs, testimonials, faq",
      validation: (Rule) =>
        Rule.required().custom((value) => {
          const validKeys = [
            "how-it-works",
            "workforce",
            "integrations",
            "pricing",
            "credit-packs",
            "testimonials",
            "faq",
          ];
          return value && validKeys.includes(value)
            ? true
            : `Must be one of: ${validKeys.join(", ")}`;
        }),
    }),
    defineField({
      name: "eyebrow",
      title: "Eyebrow",
      type: "string",
      description: "Small label above the heading",
      validation: (Rule) => Rule.required().max(120),
    }),
    defineField({
      name: "heading",
      title: "Heading (H2)",
      type: "text",
      rows: 3,
      description:
        "Main section heading. Optional — the testimonials section has an eyebrow only.",
      validation: (Rule) => Rule.max(200),
    }),
  ],
});
