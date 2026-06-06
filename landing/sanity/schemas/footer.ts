import { defineType, defineField } from "sanity";

export const footerSchema = defineType({
  name: "footer",
  title: "Footer",
  type: "document",
  fields: [
    defineField({
      name: "brandLine",
      title: "Brand Line",
      type: "string",
      description: "Brand name and tagline (e.g. 'AutoFlow · workforce automation')",
      validation: (Rule) => Rule.required().max(100),
    }),
    defineField({
      name: "links",
      title: "Footer Links",
      type: "array",
      of: [
        defineField({
          name: "link",
          title: "Link",
          type: "object",
          fields: [
            defineField({
              name: "label",
              title: "Label",
              type: "string",
              validation: (Rule) => Rule.required().max(50),
            }),
            defineField({
              name: "url",
              title: "URL",
              type: "string",
              description: "Internal path (e.g. '/blog') or external URL",
              validation: (Rule) => Rule.required(),
            }),
            defineField({
              name: "isExternal",
              title: "Is External Link",
              type: "boolean",
              description: "When true, opens in new tab with rel='noreferrer noopener'",
              initialValue: false,
            }),
          ],
        }),
      ],
      validation: (Rule) => Rule.required().min(1),
    }),
    defineField({
      name: "copyrightText",
      title: "Copyright Text",
      type: "string",
      description:
        "Text before the year (e.g. '©'). The year is appended automatically.",
      validation: (Rule) => Rule.required().max(20),
    }),
  ],
});
