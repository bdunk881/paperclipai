import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://autoflow.ai";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/studio/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
