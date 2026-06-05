import { defineType, defineField, defineArrayMember } from "sanity";

/**
 * Brand-entity singleton. Source for the sitewide Organization + WebSite +
 * SoftwareApplication JSON-LD. Exactly one instance is expected (created in
 * the backfill step). `products` carries the Flow / Automate / Scale tiers;
 * leave `price` blank unless a tier price is publicly fixed.
 */
export const siteSettingsSchema = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  fields: [
    defineField({
      name: "orgName",
      title: "Organization name",
      type: "string",
      initialValue: "AutoFlow",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "logo",
      title: "Logo",
      type: "image",
      options: { hotspot: true },
      fields: [defineField({ name: "alt", title: "Alt text", type: "string" })],
    }),
    defineField({
      name: "defaultOgImage",
      title: "Default social image",
      type: "image",
      options: { hotspot: true },
      fields: [defineField({ name: "alt", title: "Alt text", type: "string" })],
    }),
    defineField({
      name: "defaultMetaDescription",
      title: "Default meta description",
      type: "text",
      rows: 3,
      validation: (Rule) => Rule.max(160).warning("Keep under 160 characters"),
    }),
    defineField({
      name: "sameAs",
      title: "Social profiles (sameAs)",
      description: "Org social/profile URLs — emitted as schema.org sameAs.",
      type: "array",
      of: [{ type: "url" }],
    }),
    defineField({
      name: "products",
      title: "Products (SoftwareApplication offers)",
      description: "AutoFlow pricing tiers for SoftwareApplication structured data.",
      type: "array",
      of: [
        defineArrayMember({
          type: "object",
          name: "product",
          fields: [
            defineField({
              name: "name",
              title: "Tier name",
              type: "string",
              validation: (Rule) => Rule.required(),
            }),
            defineField({ name: "description", title: "Description", type: "string" }),
            defineField({
              name: "price",
              title: "Price",
              type: "string",
              description: "Leave blank if not publicly fixed. Numbers only (no currency symbol).",
            }),
            defineField({
              name: "priceCurrency",
              title: "Currency",
              type: "string",
              initialValue: "USD",
            }),
            defineField({ name: "url", title: "URL", type: "url" }),
          ],
          preview: { select: { title: "name", subtitle: "price" } },
        }),
      ],
    }),
  ],
  preview: { select: { title: "orgName" } },
});
