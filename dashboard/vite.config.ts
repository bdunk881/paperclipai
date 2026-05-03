import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProd = mode === "production";

  return {
    plugins: [
      react(),
      // sentryVitePlugin must come last; only runs when SENTRY_AUTH_TOKEN is set
      ...(isProd && env.SENTRY_AUTH_TOKEN
        ? [
            sentryVitePlugin({
              org: "autoflow-mo",
              project: "javascript-react",
              authToken: env.SENTRY_AUTH_TOKEN,
              sourcemaps: {
                filesToDeleteAfterUpload: ["./dist/**/*.map"],
              },
            }),
          ]
        : []),
    ],
    build: {
      sourcemap: "hidden",
    },
    server: {
      port: 5173,
      fs: {
        allow: [
          path.resolve(__dirname),
          path.resolve(__dirname, "../infra/brand-assets"),
        ],
      },
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
  };
});
