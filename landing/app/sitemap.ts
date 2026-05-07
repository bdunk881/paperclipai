import { getAllArticles } from "@/lib/articles";
import { getBlogPosts } from "@/lib/sanity";

export async function loader() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL ?? "https://helloautoflow.com";
  const now = new Date().toISOString();
  const cmsPosts = await getBlogPosts();
  const articleSlugs = getAllArticles().map((article) => article.slug);
  const cmsSlugs = cmsPosts?.map((post) => post.slug) ?? [];
  const blogSlugs = [...new Set([...cmsSlugs, ...articleSlugs])];

  const entries = [
    { url: `${base}`, priority: "1.0", changeFrequency: "weekly" },
    { url: `${base}/blog`, priority: "0.8", changeFrequency: "weekly" },
    { url: `${base}/demo`, priority: "0.8", changeFrequency: "monthly" },
    { url: `${base}/signup`, priority: "0.7", changeFrequency: "monthly" },
    { url: `${base}/privacy`, priority: "0.3", changeFrequency: "yearly" },
    { url: `${base}/terms`, priority: "0.3", changeFrequency: "yearly" },
    ...blogSlugs.map((slug) => ({
      url: `${base}/blog/${slug}`,
      priority: "0.6",
      changeFrequency: "monthly",
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${entry.url}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${entry.changeFrequency}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`,
    )
    .join("\n")}\n</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
