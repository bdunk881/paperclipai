// @cloudflare/vitest-pool-workers v0.16 (vitest v4) replaced the
// `defineWorkersConfig` + `test.poolOptions.workers` API with a
// `cloudflareTest()` Vite plugin that takes the pool options directly.
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      // Pin to the same DO bindings the dev deploy uses. Tests never reach
      // production secrets.
      miniflare: {
        compatibilityDate: "2026-05-20",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
});
