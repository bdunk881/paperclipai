function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export function buildLandingApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const configuredBase = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  if (configuredBase) {
    return `${configuredBase}${normalizedPath}`;
  }

  if (process.env.NODE_ENV !== "production") {
    return `http://localhost:8000${normalizedPath}`;
  }

  return normalizedPath;
}
