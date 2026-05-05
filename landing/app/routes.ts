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
  route("api/waitlist-signup", "api/waitlist-signup/route.ts"),
  route("api/subscribe", "api/subscribe/route.ts"),
  route("api/beta-signup", "api/beta-signup/route.ts"),
  route("api/checkout", "api/checkout/route.ts"),
  route("api/stripe/webhook", "api/stripe/webhook/route.ts"),
] satisfies RouteConfig;
