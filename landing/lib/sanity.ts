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
  apiVersion: "2026-02-01",
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
  >(`*[_type == "blogPost"] | order(publishedAt desc) { title, "slug": slug.current, "author": coalesce(authorRef->name, author), publishedAt, excerpt, coverImage }`);
}

export interface BlogAuthor {
  name: string;
  slug?: string | null;
  role?: string | null;
  bio?: unknown[] | null;
  avatarUrl?: string | null;
  links?: string[] | null;
}

export interface BlogCategory {
  title: string;
  slug: string;
}

export interface BlogFaq {
  question: string;
  answer: string;
}

export interface BlogSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  ogImage: SanityImageSource | null;
  canonicalUrl: string | null;
  noIndex: boolean;
}

export interface BlogPost {
  title: string;
  slug: string;
  author: BlogAuthor | null;
  publishedAt: string;
  dateModified: string | null;
  body: unknown[];
  excerpt: string;
  coverImage: SanityImageSource | null;
  categories: BlogCategory[] | null;
  faqs: BlogFaq[] | null;
  seo: BlogSeo;
}

export async function getBlogPost(slug: string) {
  // Internal-link markDefs expand `reference` to the target slug so the
  // PortableText link renderer (PR-4) can build /blog/<slug> hrefs. `author`
  // coalesces the new authorRef entity over the legacy string fallback, and
  // `seo` fills smart defaults (title/excerpt/coverImage) at the query layer.
  return sanityFetch<BlogPost>(
    `*[_type == "blogPost" && slug.current == $slug][0]{
      title,
      "slug": slug.current,
      "author": coalesce(authorRef->{ name, "slug": slug.current, role, bio, "avatarUrl": avatar.asset->url, links }, { "name": author }),
      publishedAt,
      "dateModified": coalesce(dateModified, _updatedAt),
      body[]{
        ...,
        markDefs[]{
          ...,
          reference->{ "slug": slug.current }
        }
      },
      excerpt,
      coverImage,
      "categories": categories[]->{ title, "slug": slug.current },
      "faqs": faqs[]{ question, answer },
      "seo": {
        "metaTitle": coalesce(seo.metaTitle, title),
        "metaDescription": coalesce(seo.metaDescription, excerpt),
        "ogImage": coalesce(seo.ogImage, coverImage),
        "canonicalUrl": seo.canonicalUrl,
        "noIndex": seo.noIndex == true
      }
    }`,
    { slug },
  );
}

/* ── SEO/AEO support queries (HEL-633) ─────────────────────── */

export interface SiteSettingsProduct {
  name: string;
  description?: string | null;
  price?: string | null;
  priceCurrency?: string | null;
  url?: string | null;
}

export interface SiteSettings {
  orgName: string;
  logoUrl: string | null;
  defaultMetaDescription: string | null;
  sameAs: string[] | null;
  products: SiteSettingsProduct[] | null;
}

/** Brand-entity singleton — source for Organization/WebSite/SoftwareApplication JSON-LD. */
export async function getSiteSettings() {
  return sanityFetch<SiteSettings>(
    `*[_type == "siteSettings"][0]{
      orgName,
      "logoUrl": logo.asset->url,
      defaultMetaDescription,
      sameAs,
      products[]{ name, description, price, priceCurrency, url }
    }`,
  );
}

export interface BlogRedirect {
  source: string;
  destination: string;
  permanent: boolean;
}

/** Enabled editor-managed redirects (consumed by the redirect mechanism in PR-7). */
export async function getEnabledRedirects() {
  return sanityFetch<BlogRedirect[]>(
    `*[_type == "redirect" && isEnabled == true]{ source, destination, permanent }`,
  );
}

export interface BlogSitemapEntry {
  slug: string;
  lastmod: string;
}

/** Indexable blog posts for the sitemap — excludes seo.noIndex, per-post lastmod (PR-5). */
export async function getBlogSitemapEntries() {
  return sanityFetch<BlogSitemapEntry[]>(
    `*[_type == "blogPost" && defined(slug.current) && seo.noIndex != true]{
      "slug": slug.current,
      "lastmod": coalesce(dateModified, _updatedAt)
    }`,
  );
}

/* ── HEL-278: pricing tier marketing overlay ──────────────── */

/**
 * Editorial overlay on top of DB-driven subscription_tiers. Keyed by
 * `tierId` matching `subscription_tiers.id`. All fields except `tierId`
 * are optional — when omitted the loader falls through to the DB value.
 */
export interface PricingTierOverlay {
  tierId: string;
  eyebrow?: string;
  bullets?: string[];
  ctaLabel?: string;
  priceUnit?: string;
}

export async function getPricingOverlays() {
  return sanityFetch<PricingTierOverlay[]>(
    `*[_type == "pricingTierOverlay"]{tierId, eyebrow, bullets, ctaLabel, priceUnit}`,
  );
}

/* ── HEL-285: credit pack marketing overlay ───────────────── */

/**
 * Editorial overlay on top of DB-driven credit_packs. Keyed by `packId`
 * matching `credit_packs.id`. All fields except `packId` are optional —
 * when omitted the renderer falls through to the current default
 * behavior (auto-featured = highest bonusPercent, "Most popular" badge,
 * "Buy {displayName}" CTA).
 */
export interface CreditPackOverlay {
  packId: string;
  tagline?: string;
  isFeatured?: boolean;
  featuredLabel?: string;
  ctaLabel?: string;
}

export async function getCreditPackOverlays() {
  return sanityFetch<CreditPackOverlay[]>(
    `*[_type == "creditPackOverlay"]{packId, tagline, isFeatured, featuredLabel, ctaLabel}`,
  );
}
