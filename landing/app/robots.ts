export async function loader() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL ?? "https://helloautoflow.com";
  const body = [`User-agent: *`, `Allow: /`, `Disallow: /api/`, `Disallow: /studio/`, `Sitemap: ${base}/sitemap.xml`].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
