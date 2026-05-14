function normalizeConfiguredOrigin(value?: string): string {
  if (!value) return "";

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

/**
 * Hostname → API origin map.
 *
 * Keep in sync with the Fly app + Cloudflare DNS:
 *   - production dashboard (app.helloautoflow.com) → production Fly
 *   - staging dashboard    (staging.app.helloautoflow.com) → staging Fly
 *   - dev dashboard        (dev.helloautoflow.com OR dev.app.helloautoflow.com
 *                            OR <hash>.autoflow-dashboard-dev-git.pages.dev) → dev Fly
 *
 * Any hostname not in this map falls through to `VITE_API_BASE_URL` /
 * `VITE_API_URL` (baked at build time by the dashboard Cloudflare Pages
 * workflow) and finally to a relative `/api` path.
 */
function getHostedApiOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const hostname = window.location.hostname;

  // Production
  if (hostname === "app.helloautoflow.com") {
    return "https://api.helloautoflow.com";
  }

  // Staging
  if (hostname === "staging.app.helloautoflow.com") {
    return "https://staging-api.helloautoflow.com";
  }

  // Dev — three valid surfaces (custom domain, alias custom domain, raw Pages URL)
  if (hostname === "dev.helloautoflow.com" || hostname === "dev.app.helloautoflow.com") {
    return "https://autoflow-fastapi-dev.fly.dev";
  }
  if (hostname.endsWith(".autoflow-dashboard-dev-git.pages.dev")) {
    return "https://autoflow-fastapi-dev.fly.dev";
  }

  // Bare Cloudflare Pages prod preview
  if (hostname.endsWith(".autoflow-dashboard.pages.dev")) {
    return "https://api.helloautoflow.com";
  }

  return "";
}

export function getConfiguredApiOrigin(): string {
  const hosted = getHostedApiOrigin();
  if (hosted) {
    return hosted;
  }

  const configured = normalizeConfiguredOrigin(
    import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL
  );
  return configured;
}

export function getApiBasePath(): string {
  const origin = getConfiguredApiOrigin();
  return origin ? `${origin}/api` : "/api";
}
