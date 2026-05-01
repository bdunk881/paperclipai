function normalizeConfiguredOrigin(value?: string): string {
  if (!value) return "";

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

function getHostedApiOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const hostname = window.location.hostname;
  if (hostname === "app.helloautoflow.com") {
    return "https://api.helloautoflow.com";
  }
  if (hostname === "staging.app.helloautoflow.com") {
    return "https://staging-api.helloautoflow.com";
  }

  return "";
}

export function getConfiguredApiOrigin(): string {
  const configured = normalizeConfiguredOrigin(
    import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL
  );
  return configured || getHostedApiOrigin();
}

export function getApiBasePath(): string {
  const origin = getConfiguredApiOrigin();
  return origin ? `${origin}/api` : "/api";
}
