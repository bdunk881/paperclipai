import { defineType, defineField } from "sanity";

/**
 * Per-post FAQ entry (inline object). NOTE: the document type name `faqItem`
 * is already taken by the marketing-FAQ section, so this is named `blogFaq`.
 * Answers are plain text (kept concise + self-contained) so they drop straight
 * into the nested FAQPage JSON-LD without Portable-Text flattening.
 */
export const blogFaqSchema = defineType({
  name: "blogFaq",
  title: "FAQ entry",
  type: "object",
  fields: [
    defineField({
      name: "question",
      title: "Question",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "answer",
      title: "Answer",
      type: "text",
      rows: 4,
      description:
        "Keep concise and self-contained — feeds the on-page FAQ and the FAQPage JSON-LD (AI extraction).",
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: { select: { title: "question", subtitle: "answer" } },
});
