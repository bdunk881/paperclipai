import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const logoDevPublishableKey =
    env.VITE_LOGO_DEV_PUBLISHABLE_KEY ||
    env.LOGO_DEV_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY ||
    process.env.VITE_LOGO_DEV_PUBLISHABLE_KEY ||
    process.env.LOGO_DEV_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY ||
    "";

  return {
    define: {
      "import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY":
        JSON.stringify(logoDevPublishableKey),
    },
    plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), reactRouter()],
    resolve: {
      tsconfigPaths: true,
      alias: {
        "@autoflow/logo-dev": path.resolve(__dirname, "../shared/logoDev/index.ts"),
      },
    },
  };
});
