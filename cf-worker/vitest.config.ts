import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        // Pin to the dev environment so the test imports the same DO bindings
        // the dev deploy uses. Tests never reach production secrets.
        miniflare: {
          compatibilityDate: "2026-05-20",
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
  },
});
