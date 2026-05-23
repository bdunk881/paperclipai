import { getConfiguredApiOrigin } from "../api/baseUrl";
import type { StoredAuthSession, StoredAuthUser } from "./authStorage";

export type ServerAuthSessionPayload = {
  accessToken: string;
  expiresAt: number;
  user: StoredAuthUser;
  authProvider?: "supabase";
  refreshToken?: string;
};

function apiAuthPath(suffix: string): string {
  const origin = getConfiguredApiOrigin();
  const base = origin ? `${origin}/api/auth` : "/api/auth";
  return `${base}${suffix}`;
}

export function getEmailAuthCallbackUrl(): string {
  return apiAuthPath("/email/callback");
}

export async function fetchServerAuthSession(): Promise<StoredAuthSession | null> {
  const response = await fetch(apiAuthPath("/session"), {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not load your server sign-in session.");
  }

  const payload = (await response.json()) as { session?: ServerAuthSessionPayload };
  if (!payload.session?.accessToken) {
    return null;
  }

  return {
    accessToken: payload.session.accessToken,
    refreshToken: payload.session.refreshToken,
    expiresAt: payload.session.expiresAt,
    user: payload.session.user,
    authProvider: "supabase",
  };
}

export async function verifyServerEmailOtp(email: string, token: string): Promise<StoredAuthSession> {
  const response = await fetch(apiAuthPath("/verify-otp"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, token }),
  });

  const body = (await response.json().catch(() => null)) as {
    error?: string;
    session?: ServerAuthSessionPayload;
  } | null;

  if (!response.ok || !body?.session?.accessToken) {
    throw new Error(body?.error ?? "Invalid or expired verification code.");
  }

  return {
    accessToken: body.session.accessToken,
    refreshToken: body.session.refreshToken,
    expiresAt: body.session.expiresAt,
    user: body.session.user,
    authProvider: "supabase",
  };
}

export async function logoutServerAuthSession(): Promise<void> {
  await fetch(apiAuthPath("/logout"), {
    method: "POST",
    credentials: "include",
  }).catch(() => {
    // Best-effort — local cleanup still runs in AuthContext.
  });
}
