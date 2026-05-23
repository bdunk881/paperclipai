export type EmailOtpFlowType = "email" | "recovery" | "signup" | "invite" | "magiclink" | "email_change";

export type EmailAuthSessionUser = {
  id: string;
  email: string;
  name: string;
  tenantId?: string;
};

export type EmailAuthSessionRecord = {
  user: EmailAuthSessionUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function getSessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS;
}

export function getAuthSessionCookieName(): string {
  return (process.env.AUTH_SESSION_COOKIE_NAME ?? "autoflow_session").trim() || "autoflow_session";
}

export function getAuthCookieDomain(): string | undefined {
  const raw = (process.env.AUTH_COOKIE_DOMAIN ?? "").trim();
  return raw || undefined;
}

export function getDashboardPublicUrl(): string {
  const configured = (process.env.DASHBOARD_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }

  const runtimeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
  if (runtimeEnv === "production") {
    return "https://app.helloautoflow.com";
  }

  return "http://localhost:5173";
}

export function getApiPublicOrigin(): string {
  const configured = (process.env.API_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }

  const runtimeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
  if (runtimeEnv === "production") {
    return "https://api.helloautoflow.com";
  }

  return `http://localhost:${process.env.PORT ?? "3000"}`;
}

export function getEmailAuthCallbackUrl(): string {
  return `${getApiPublicOrigin()}/api/auth/email/callback`;
}

export function shouldReturnTokensInBody(): boolean {
  const flag = (process.env.AUTH_RETURN_TOKENS_IN_BODY ?? "").trim().toLowerCase();
  if (flag === "true" || flag === "1") {
    return true;
  }

  const runtimeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
  return runtimeEnv === "development" || runtimeEnv === "test";
}

export function isEmailAuthConfigured(): boolean {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return Boolean(url && serviceKey);
}

export function parseOtpType(value: unknown): EmailOtpFlowType {
  if (typeof value !== "string" || !value.trim()) {
    return "email";
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "recovery" ||
    normalized === "signup" ||
    normalized === "invite" ||
    normalized === "magiclink" ||
    normalized === "email_change"
  ) {
    return normalized;
  }

  return "email";
}

export function firstMetadataString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const candidate = value.find((entry) => typeof entry === "string" && entry.trim());
  return typeof candidate === "string" ? candidate.trim() : undefined;
}
