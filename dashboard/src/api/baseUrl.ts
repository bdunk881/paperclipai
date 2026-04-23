function normalizeConfiguredOrigin(value?: string): string {
  if (!value) return "";

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

export function getConfiguredApiOrigin(): string {
  return normalizeConfiguredOrigin(import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL);
}

export function getApiBasePath(): string {
  const origin = getConfiguredApiOrigin();
  return origin ? `${origin}/api` : "/api";
}
