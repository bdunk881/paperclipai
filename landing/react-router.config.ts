import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Required for the Cloudflare Vite plugin (runs the SSR server in workerd).
  future: {
    v8_viteEnvironmentApi: true,
  },
  // Static marketing pages stay prerendered; dynamic routes (/blog/:slug,
  // /studio, /sitemap.xml, /robots.txt) render at runtime in the Worker.
  // NOTE: "/" is intentionally NOT prerendered — the homepage is Sanity-driven
  // (hero etc.), so it SSRs at runtime + edge-caches (see app/page.tsx headers)
  // so CMS edits go live without a rebuild.
  prerender: ["/blog", "/demo", "/signup", "/privacy", "/terms"],
} satisfies Config;
