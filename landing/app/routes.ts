import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("page.tsx"),
  route("blog", "blog/page.tsx"),
  route("blog/:slug", "blog/[slug]/page.tsx"),
  route("demo", "demo/page.tsx"),
  route("signup", "signup/page.tsx"),
  route("privacy", "privacy/page.tsx"),
  route("terms", "terms/page.tsx"),
  route("robots.txt", "robots.ts"),
  route("sitemap.xml", "sitemap.ts"),
  // API endpoints (waitlist-signup, subscribe, beta-signup, checkout, stripe webhook)
  // live in the FastAPI backend under /api/public/landing/* and /api/stripe/webhook.
  // They're invoked via buildLandingApiUrl() against NEXT_PUBLIC_API_URL — not via
  // React Router routes.
] satisfies RouteConfig;
