import { createClient } from "@sanity/client";
import { createImageUrlBuilder } from "@sanity/image-url";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SanityImageSource = any;

const isSanityConfigured =
  !!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID &&
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID !== "replace-me";

export const sanityClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "replace-me",
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production",
  apiVersion: "2024-01-01",
  useCdn: process.env.NODE_ENV === "production",
  token: process.env.SANITY_API_TOKEN,
});

const builder = createImageUrlBuilder(sanityClient);

export function urlFor(source: SanityImageSource) {
  return builder.image(source);
}

/** Run a GROQ query against Sanity, returning `null` when the CMS is not yet configured. */
export async function sanityFetch<T>(
  query: string,
  params: Record<string, unknown> = {},
): Promise<T | null> {
  if (!isSanityConfigured) return null;
  try {
    return await sanityClient.fetch<T>(query, params);
  } catch {
    return null;
  }
}

/* ── GROQ queries ─────────────────────────────────────────── */

export async function getTestimonials() {
  return sanityFetch<
    { quote: string; authorName: string; authorTitle: string; authorPhoto: SanityImageSource | null; order: number }[]
  >(`*[_type == "testimonial" && featured == true] | order(order asc) { quote, authorName, authorTitle, authorPhoto, order }`);
}

export async function getFeatures() {
  return sanityFetch<
    { title: string; description: string; icon: string | null; order: number }[]
  >(`*[_type == "feature"] | order(order asc) { title, description, icon, order }`);
}

export async function getFaqItems() {
  return sanityFetch<
    { question: string; answer: string; order: number }[]
  >(`*[_type == "faqItem"] | order(order asc) { question, answer, order }`);
}

export async function getBlogPosts() {
  return sanityFetch<
    { title: string; slug: string; author: string; publishedAt: string; excerpt: string; coverImage: SanityImageSource | null }[]
  >(`*[_type == "blogPost"] | order(publishedAt desc) { title, "slug": slug.current, author, publishedAt, excerpt, coverImage }`);
}

export async function getBlogPost(slug: string) {
  return sanityFetch<{
    title: string;
    slug: string;
    author: string;
    publishedAt: string;
    body: unknown[];
    excerpt: string;
    coverImage: SanityImageSource | null;
  }>(
    `*[_type == "blogPost" && slug.current == $slug][0] { title, "slug": slug.current, author, publishedAt, body, excerpt, coverImage }`,
    { slug },
  );
}
