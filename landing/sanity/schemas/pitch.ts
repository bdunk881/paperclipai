import { defineType, defineField } from "sanity";

export const pitchSchema = defineType({
  name: "pitch",
  title: "Pitch Section",
  type: "document",
  fields: [
    defineField({
      name: "line1",
      title: "First Line",
      type: "string",
      description: "First comparative line (e.g. 'n8n gave you nodes.')",
      validation: (Rule) => Rule.required().max(100),
    }),
    defineField({
      name: "line2",
      title: "Second Line",
      type: "string",
      description: "Second comparative line (e.g. 'Zapier gave you triggers.')",
      validation: (Rule) => Rule.required().max(100),
    }),
    defineField({
      name: "line3Prefix",
      title: "Third Line Prefix",
      type: "string",
      description: "Text before the underlined highlight (e.g. 'AutoFlow gives you')",
      validation: (Rule) => Rule.required().max(100),
    }),
    defineField({
      name: "line3Highlight",
      title: "Third Line Highlight",
      type: "string",
      description: "The underlined word (e.g. 'people')",
      validation: (Rule) => Rule.required().max(50),
    }),
    defineField({
      name: "line3Suffix",
      title: "Third Line Suffix",
      type: "string",
      description:
        "Text after the highlight (e.g. '— a team you can brief, budget, and trust with a paper trail.')",
      validation: (Rule) => Rule.required().max(200),
    }),
  ],
});
