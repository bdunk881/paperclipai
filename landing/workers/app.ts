import { createRequestHandler } from "react-router";

// The RR7 Cloudflare Vite plugin provides this virtual server-build module and
// runs this Worker as the `ssr` environment. Static assets (prerendered HTML +
// client bundles in build/client) are served by the ASSETS binding; anything
// without a matching asset (e.g. /blog/:slug, /sitemap.xml, /robots.txt) falls
// through to here and is server-rendered.
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
