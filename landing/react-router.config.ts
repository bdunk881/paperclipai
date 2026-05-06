import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  prerender: ["/", "/blog", "/demo", "/signup", "/privacy", "/terms"],
} satisfies Config;
