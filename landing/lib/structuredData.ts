import type { BlogPost } from "./sanity";

/**
 * Canonical production domain — the ONLY valid canonical for AutoFlow (never
 * autoflow.app / autoflow.ai). Hardcoded so canonical URLs + JSON-LD always
 * point at production, even from preview (*.pages.dev) deploys.
 */
export const SITE_URL = "https://helloautoflow.com";
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

type LdJson = Record<string, unknown>;

const ORG_DESCRIPTION =
  "Open-source AI agent orchestration platform for small and mid-sized businesses — hire and manage AI agent teams instead of wiring up brittle automations.";

function organizationLd(): LdJson {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "AutoFlow",
    url: SITE_URL,
    logo: `${SITE_URL}/og.svg`,
    description: ORG_DESCRIPTION,
  };
}

function webSiteLd(): LdJson {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: "AutoFlow",
    url: SITE_URL,
    publisher: { "@id": ORG_ID },
  };
}

function softwareApplicationLd(): LdJson {
  // Offers/prices intentionally omitted — pricing is owned by Supabase, not
  // duplicated into structured data. Name/category/OS only.
  return {
    "@type": "SoftwareApplication",
    name: "AutoFlow",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    publisher: { "@id": ORG_ID },
    description: ORG_DESCRIPTION,
  };
}

/** Sitewide entity graph (Organization + WebSite + SoftwareApplication) — rendered in the root layout on every page. */
export function siteGraphLd(): LdJson {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationLd(), webSiteLd(), softwareApplicationLd()],
  };
}

/** Serialize JSON-LD for a <script> tag, escaping `<` so a stray `</script>` can't break out. */
export function serializeLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** BlogPosting node for a post — author Person (or Organization fallback), publisher → org @id. */
export function blogPostingLd(post: BlogPost, opts: { url: string; imageUrl: string }): LdJson {
  const author = post.author
    ? {
        "@type": "Person",
        name: post.author.name,
        ...(post.author.role ? { jobTitle: post.author.role } : {}),
        ...(post.author.avatarUrl ? { image: post.author.avatarUrl } : {}),
        ...(post.author.links && post.author.links.length ? { sameAs: post.author.links } : {}),
      }
    : { "@id": ORG_ID };
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${opts.url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": opts.url },
    headline: post.title,
    description: post.seo?.metaDescription ?? post.excerpt,
    image: opts.imageUrl,
    datePublished: post.publishedAt,
    dateModified: post.dateModified ?? post.publishedAt,
    author,
    publisher: { "@id": ORG_ID },
    isPartOf: { "@id": WEBSITE_ID },
  };
}

/** Home › Blog › Post breadcrumb (category archive pages don't exist yet, so it's 3 levels). */
export function breadcrumbLd(post: BlogPost, opts: { url: string }): LdJson {
  const crumbs = [
    { name: "Home", item: SITE_URL },
    { name: "Blog", item: `${SITE_URL}/blog` },
    { name: post.title, item: opts.url },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.item,
    })),
  };
}

/** Nested FAQPage (AI extraction; no SERP rich result since 2026) — only when the post has FAQs. */
export function faqPageLd(post: BlogPost): LdJson | null {
  if (!post.faqs || post.faqs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: post.faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}
