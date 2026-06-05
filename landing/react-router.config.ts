import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Required for the Cloudflare Vite plugin (runs the SSR server in workerd).
  future: {
    v8_viteEnvironmentApi: true,
  },
  // Static marketing pages stay prerendered; dynamic routes (/blog/:slug,
  // /sitemap.xml, /robots.txt) render at runtime in the Worker.
  prerender: ["/", "/blog", "/demo", "/signup", "/privacy", "/terms"],
} satisfies Config;
