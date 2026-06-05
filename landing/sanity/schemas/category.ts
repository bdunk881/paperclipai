import { defineType, defineField } from "sanity";

/**
 * Shared taxonomy for blog posts — powers topic clusters, related-post
 * modules, and archive pages. Seed values: Comparisons, Guides, Tutorials,
 * Trends & Insights.
 */
export const categorySchema = defineType({
  name: "category",
  title: "Category",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "title", maxLength: 96 },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "description",
      title: "Description",
      type: "text",
      rows: 2,
      description: "Used on the archive page + its meta description.",
    }),
  ],
  preview: { select: { title: "title", subtitle: "slug.current" } },
});
