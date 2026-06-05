import { defineType, defineField } from "sanity";

/**
 * Author entity for E-E-A-T. Replaces the legacy plain-string `author` on
 * blogPost. Feeds the schema.org Person node (name, bio, sameAs from links).
 */
export const authorSchema = defineType({
  name: "author",
  title: "Author",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "name", maxLength: 96 },
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: "role", title: "Role / title", type: "string" }),
    defineField({
      name: "bio",
      title: "Bio (E-E-A-T)",
      description: "Real credentials / relevant experience. Feeds the author Person schema.",
      type: "array",
      of: [{ type: "block" }],
    }),
    defineField({
      name: "avatar",
      title: "Avatar",
      type: "image",
      options: { hotspot: true },
      fields: [defineField({ name: "alt", title: "Alt text", type: "string" })],
    }),
    defineField({
      name: "links",
      title: "Profiles (sameAs)",
      description: "LinkedIn, X, GitHub, etc. — emitted as schema.org sameAs.",
      type: "array",
      of: [{ type: "url" }],
    }),
  ],
  preview: { select: { title: "name", subtitle: "role", media: "avatar" } },
});
