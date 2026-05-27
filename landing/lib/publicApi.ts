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
    // Express backend default port (src/index.ts). The FastAPI dev port
    // (8000) it used to target was retired in HEL-97.
    return `http://localhost:3000${normalizedPath}`;
  }

  return normalizedPath;
}
