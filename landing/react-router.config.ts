import { vercelPreset } from "@vercel/react-router/vite";
import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  prerender: ["/", "/blog", "/demo", "/signup", "/privacy", "/terms"],
  presets: [vercelPreset()],
} satisfies Config;
