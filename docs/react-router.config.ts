import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  prerender: ["/", "/getting-started", "/api-reference", "/integrations-sdk-v1"],
} satisfies Config;
