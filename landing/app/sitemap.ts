import { getAllArticles } from "@/lib/articles";
import { getBlogSitemapEntries } from "@/lib/sanity";

export async function loader() {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL ?? "https://helloautoflow.com";
  const now = new Date().toISOString();

  // CMS posts carry a per-post lastmod (coalesce(dateModified,_updatedAt)) and
  // already exclude `seo.noIndex`. Static fallback articles use their published
  // date; CMS slugs win on overlap.
  const cmsEntries = (await getBlogSitemapEntries()) ?? [];
  const cmsSlugs = new Set(cmsEntries.map((e) => e.slug));
  const articleEntries = getAllArticles()
    .filter((a) => !cmsSlugs.has(a.slug))
    .map((a) => ({ slug: a.slug, lastmod: a.publishedAt }));

  const blogEntries = [...cmsEntries, ...articleEntries].map((e) => ({
    url: `${base}/blog/${e.slug}`,
    lastmod: e.lastmod ?? now,
    priority: "0.6",
    changeFrequency: "monthly",
  }));

  const entries = [
    { url: `${base}`, lastmod: now, priority: "1.0", changeFrequency: "weekly" },
    { url: `${base}/blog`, lastmod: now, priority: "0.8", changeFrequency: "weekly" },
    { url: `${base}/demo`, lastmod: now, priority: "0.8", changeFrequency: "monthly" },
    { url: `${base}/signup`, lastmod: now, priority: "0.7", changeFrequency: "monthly" },
    { url: `${base}/privacy`, lastmod: now, priority: "0.3", changeFrequency: "yearly" },
    { url: `${base}/terms`, lastmod: now, priority: "0.3", changeFrequency: "yearly" },
    ...blogEntries,
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${entry.url}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n    <changefreq>${entry.changeFrequency}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`,
    )
    .join("\n")}\n</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
