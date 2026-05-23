import express, { Request, Response } from "express";
import type { EmailOtpType } from "@supabase/supabase-js";
import {
  getApiPublicOrigin,
  getAuthCookieDomain,
  getAuthSessionCookieName,
  getDashboardPublicUrl,
  isEmailAuthConfigured,
  parseOtpType,
  shouldReturnTokensInBody,
  type EmailAuthSessionRecord,
} from "./emailAuthConfig";
import {
  deleteEmailAuthSession,
  loadEmailAuthSession,
  refreshEmailAuthSession,
  saveEmailAuthSession,
  updateEmailAuthSession,
} from "./emailAuthSessionStore";
import { getSupabaseServiceClient, sessionRecordFromSupabaseSession } from "./supabaseServiceClient";

const router = express.Router();

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const trimmed = part.trim();
    if (!trimmed) {
      return acc;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      return acc;
    }

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function readSessionId(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[getAuthSessionCookieName()];
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
}

function isSecureCookie(): boolean {
  const runtimeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
  return runtimeEnv === "production" || runtimeEnv === "staging";
}

function appendSessionCookie(res: Response, sessionId: string): void {
  const parts = [
    `${getAuthSessionCookieName()}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];

  if (isSecureCookie()) {
    parts.push("Secure");
  }

  const domain = getAuthCookieDomain();
  if (domain) {
    parts.push(`Domain=${domain}`);
  }

  res.append("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res: Response): void {
  const parts = [
    `${getAuthSessionCookieName()}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (isSecureCookie()) {
    parts.push("Secure");
  }

  const domain = getAuthCookieDomain();
  if (domain) {
    parts.push(`Domain=${domain}`);
  }

  res.append("Set-Cookie", parts.join("; "));
}

function encodeLoginError(message: string): string {
  return encodeURIComponent(message).replace(/%20/g, "+");
}

function redirectToLogin(res: Response, message: string): void {
  const dashboard = getDashboardPublicUrl();
  res.redirect(302, `${dashboard}/login?authError=${encodeLoginError(message)}`);
}

function redirectToDashboard(res: Response, path = "/"): void {
  const dashboard = getDashboardPublicUrl().replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  res.redirect(302, `${dashboard}${suffix}`);
}

function publicSessionPayload(record: EmailAuthSessionRecord) {
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    expiresAt: record.expiresAt,
    user: record.user,
    authProvider: "supabase" as const,
  };
}

async function establishSession(
  record: EmailAuthSessionRecord,
  res: Response,
): Promise<{ sessionId: string; payload: ReturnType<typeof publicSessionPayload> }> {
  const sessionId = await saveEmailAuthSession(record);
  appendSessionCookie(res, sessionId);
  return { sessionId, payload: publicSessionPayload(record) };
}

function readTokenHash(req: Request): string | null {
  const fromQuery = req.query.token_hash;
  if (typeof fromQuery === "string" && fromQuery.trim()) {
    return fromQuery.trim();
  }

  return null;
}

function ensureEmailAuthReady(res: Response): boolean {
  if (!isEmailAuthConfigured()) {
    res.status(503).json({
      error:
        "Email auth is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the API.",
    });
    return false;
  }

  return true;
}

router.get("/email/callback", async (req, res) => {
  if (!ensureEmailAuthReady(res)) {
    return;
  }

  const errorDescription =
    typeof req.query.error_description === "string"
      ? req.query.error_description
      : typeof req.query.error === "string"
        ? req.query.error
        : null;
  if (errorDescription) {
    redirectToLogin(res, errorDescription);
    return;
  }

  const tokenHash = readTokenHash(req);
  if (!tokenHash) {
    redirectToLogin(res, "The sign-in link is invalid or missing a verification token.");
    return;
  }

  const otpType = parseOtpType(req.query.type);
  const client = getSupabaseServiceClient();
  if (!client) {
    redirectToLogin(res, "Email auth is not configured on the server.");
    return;
  }

  const { data, error } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: otpType as EmailOtpType,
  });

  if (error || !data.session) {
    redirectToLogin(res, error?.message ?? "The sign-in link is invalid or expired.");
    return;
  }

  try {
    const record = sessionRecordFromSupabaseSession(data.session);
    await establishSession(record, res);

    if (otpType === "recovery") {
      redirectToDashboard(res, "/reset-password");
      return;
    }

    redirectToDashboard(res, "/");
  } catch {
    redirectToLogin(res, "Could not persist your sign-in session. Try again.");
  }
});

router.post("/verify-otp", async (req, res) => {
  if (!ensureEmailAuthReady(res)) {
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!email || !token) {
    res.status(400).json({ error: "Email and verification code are required." });
    return;
  }

  const client = getSupabaseServiceClient();
  if (!client) {
    res.status(503).json({ error: "Email auth is not configured on the server." });
    return;
  }

  const { data, error } = await client.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error || !data.session) {
    res.status(401).json({ error: error?.message ?? "Invalid or expired verification code." });
    return;
  }

  const record = sessionRecordFromSupabaseSession(data.session);
  const { payload } = await establishSession(record, res);

  if (shouldReturnTokensInBody()) {
    res.status(200).json({
      session: {
        ...payload,
        refreshToken: record.refreshToken,
      },
    });
    return;
  }

  res.status(200).json({ session: payload });
});

router.get("/session", async (req, res) => {
  if (!ensureEmailAuthReady(res)) {
    return;
  }

  const sessionId = readSessionId(req);
  if (!sessionId) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  let record = await loadEmailAuthSession(sessionId);
  if (!record) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Session expired. Sign in again." });
    return;
  }

  if (record.expiresAt <= Date.now() + 60_000) {
    const refreshed = await refreshEmailAuthSession(record);
    if (refreshed) {
      record = refreshed;
      await updateEmailAuthSession(sessionId, record);
    }
  }

  res.json({ session: publicSessionPayload(record) });
});

router.post("/logout", async (req, res) => {
  const sessionId = readSessionId(req);
  if (sessionId) {
    await deleteEmailAuthSession(sessionId);
  }

  clearSessionCookie(res);
  res.status(204).send();
});

/** @internal For tests and diagnostics */
export function getEmailAuthRouteMetadata() {
  return {
    callbackUrl: `${getApiPublicOrigin()}/api/auth/email/callback`,
    dashboardUrl: getDashboardPublicUrl(),
  };
}

export default router;
