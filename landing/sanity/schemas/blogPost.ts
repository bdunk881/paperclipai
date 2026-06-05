import { defineType, defineField, defineArrayMember } from "sanity";

export const blogPostSchema = defineType({
  name: "blogPost",
  title: "Blog Post",
  type: "document",
  groups: [
    { name: "content", title: "Content", default: true },
    { name: "seo", title: "SEO" },
    { name: "settings", title: "Settings" },
  ],
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      group: "content",
      validation: (Rule) => Rule.required().max(120),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      group: "content",
      options: { source: "title", maxLength: 96 },
      validation: (Rule) => Rule.required(),
    }),
    // Legacy string author — superseded by `authorRef`. Kept (read-only) so
    // existing content and the frontend's string fallback keep working until
    // every post carries an authorRef; then this field can be removed.
    defineField({
      name: "author",
      title: "Author (legacy)",
      type: "string",
      group: "content",
      readOnly: true,
      deprecated: { reason: "Use the Author reference instead. Retained for migration/fallback." },
    }),
    defineField({
      name: "authorRef",
      title: "Author",
      type: "reference",
      to: [{ type: "author" }],
      group: "content",
      description: "E-E-A-T author entity. Replaces the legacy string author.",
    }),
    defineField({
      name: "publishedAt",
      title: "Published At",
      type: "datetime",
      group: "content",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "dateModified",
      title: "Last updated",
      type: "datetime",
      group: "settings",
      description:
        "Editorial last-reviewed date. Feeds Article.dateModified + sitemap lastmod. Distinct from system _updatedAt.",
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt",
      type: "text",
      rows: 3,
      group: "content",
      validation: (Rule) => Rule.required().max(300),
    }),
    defineField({
      name: "coverImage",
      title: "Cover Image",
      type: "image",
      group: "content",
      options: { hotspot: true },
      description: "Hero image + default social/OG card.",
      fields: [
        defineField({
          name: "alt",
          title: "Alt Text",
          type: "string",
          validation: (Rule) =>
            Rule.required().warning("Alt text matters for SEO + accessibility"),
        }),
      ],
    }),
    defineField({
      name: "categories",
      title: "Categories",
      type: "array",
      group: "content",
      of: [defineArrayMember({ type: "reference", to: [{ type: "category" }] })],
      validation: (Rule) =>
        Rule.min(1).warning("Assign at least one category for topic clustering"),
    }),
    defineField({
      name: "body",
      title: "Body",
      type: "array",
      group: "content",
      of: [
        defineArrayMember({
          type: "block",
          marks: {
            annotations: [
              {
                name: "link",
                type: "object",
                title: "Link",
                fields: [
                  defineField({
                    name: "linkType",
                    title: "Link type",
                    type: "string",
                    options: {
                      list: [
                        { title: "Internal (blog post)", value: "internal" },
                        { title: "External URL", value: "external" },
                      ],
                      layout: "radio",
                    },
                    initialValue: "external",
                  }),
                  defineField({
                    name: "href",
                    title: "URL",
                    type: "url",
                    hidden: ({ parent }) =>
                      (parent as { linkType?: string } | undefined)?.linkType === "internal",
                    validation: (Rule) =>
                      Rule.uri({ scheme: ["https", "http", "mailto"] }),
                  }),
                  defineField({
                    name: "reference",
                    title: "Internal post",
                    type: "reference",
                    to: [{ type: "blogPost" }],
                    hidden: ({ parent }) =>
                      (parent as { linkType?: string } | undefined)?.linkType !== "internal",
                  }),
                  defineField({
                    name: "openInNewTab",
                    title: "Open in new tab",
                    type: "boolean",
                    initialValue: false,
                  }),
                ],
              },
            ],
          },
        }),
        defineArrayMember({
          type: "image",
          options: { hotspot: true },
          fields: [
            defineField({
              name: "alt",
              title: "Alt Text",
              type: "string",
              validation: (Rule) =>
                Rule.required().warning("Alt text matters for SEO + accessibility"),
            }),
            defineField({ name: "caption", title: "Caption", type: "string" }),
          ],
        }),
      ],
    }),
    defineField({
      name: "faqs",
      title: "FAQs",
      type: "array",
      group: "content",
      description: "On-page FAQ + FAQPage JSON-LD (AI extraction).",
      of: [defineArrayMember({ type: "blogFaq" })],
    }),
    defineField({
      name: "relatedPosts",
      title: "Related posts (manual override)",
      type: "array",
      group: "settings",
      description: "Optional. Otherwise related posts derive from shared categories.",
      of: [defineArrayMember({ type: "reference", to: [{ type: "blogPost" }] })],
    }),
    defineField({
      name: "seo",
      title: "SEO & Social",
      type: "seo",
      group: "seo",
    }),
  ],
  validation: (Rule) =>
    Rule.custom((doc) => {
      const d = doc as { author?: string; authorRef?: unknown } | undefined;
      if (d && !d.author && !d.authorRef) return "Assign an author";
      return true;
    }).warning(),
  orderings: [
    {
      title: "Published Date (newest)",
      name: "publishedAtDesc",
      by: [{ field: "publishedAt", direction: "desc" }],
    },
  ],
  preview: {
    select: { title: "title", subtitle: "author", media: "coverImage" },
  },
});
