import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: path.join(__dirname),
    resolveAlias: {
      "@autoflow/logo-dev": path.join(__dirname, "../shared/logoDev/index.ts"),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@autoflow/logo-dev": path.join(__dirname, "../shared/logoDev/index.ts"),
    };
    return config;
  },
};

export default nextConfig;
