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
        // HEL-427 auth-gates the rate-limit routes on this shared secret; the
        // functional tests authenticate with this fixed test value (prod sets
        // the real secret via `wrangler secret put`, never in the toml).
        // HEL-801 SUPABASE_URL lets the ydoc edge derive its JWT config in tests
        // (a structurally-invalid token is then rejected without any network).
        bindings: {
          CF_WORKER_SHARED_SECRET: "test-shared-secret",
          SUPABASE_URL: "https://test-project.supabase.co",
        },
      },
    }),
  ],
});
