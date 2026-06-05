import { defineType, defineField } from "sanity";

function isValidPath(value?: string): true | string {
  if (!value) return "Required";
  if (!value.startsWith("/")) return "Must start with /";
  if (/[^a-zA-Z0-9\-_/:]/.test(value)) return "Invalid characters in path";
  return true;
}

/**
 * Editor-managed 301/302 redirect. Consumed at runtime (splat route) or
 * emitted to a Cloudflare _redirects file at build time.
 */
export const redirectSchema = defineType({
  name: "redirect",
  title: "Redirect",
  type: "document",
  validation: (Rule) =>
    Rule.custom((doc) => {
      const d = doc as { source?: string; destination?: string } | undefined;
      return d?.source && d.source === d.destination
        ? "Source and destination cannot match"
        : true;
    }),
  fields: [
    defineField({
      name: "source",
      title: "Source path",
      type: "string",
      description: "Path to redirect from, e.g. /blog/old-slug",
      validation: (Rule) => Rule.required().custom(isValidPath),
    }),
    defineField({
      name: "destination",
      title: "Destination",
      type: "string",
      description: "Path or absolute URL to redirect to.",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "permanent",
      title: "Permanent (301)",
      type: "boolean",
      initialValue: true,
      description: "301 permanent vs 302 temporary.",
    }),
    defineField({
      name: "isEnabled",
      title: "Enabled",
      type: "boolean",
      initialValue: true,
    }),
  ],
  preview: { select: { title: "source", subtitle: "destination" } },
});
