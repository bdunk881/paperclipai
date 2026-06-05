export async function loader() {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL ?? "https://helloautoflow.com";

  // Explicitly welcome AI / answer-engine crawlers (AEO) — being cited by
  // ChatGPT Search, Perplexity, Claude, Gemini/AI Overviews, etc. requires
  // letting their crawlers in. `User-agent: *` already allows them, but listing
  // them is an unambiguous signal.
  const aiCrawlers = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-Web",
    "anthropic-ai",
    "PerplexityBot",
    "Perplexity-User",
    "Google-Extended",
    "Applebot-Extended",
  ];

  const blocks = [
    ...aiCrawlers.map((ua) => `User-agent: ${ua}\nAllow: /`),
    ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /studio/"].join("\n"),
    `Sitemap: ${base}/sitemap.xml`,
  ];

  const body = `${blocks.join("\n\n")}\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
