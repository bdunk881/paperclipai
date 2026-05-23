import express, { type CookieOptions, type Request, type Response } from "express";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asyncHandler } from "../middleware/asyncHandler";

const router = express.Router();

interface ParsedCookie {
  name: string;
  value: string;
}

function parseRequestCookies(req: Request): ParsedCookie[] {
  const header = req.headers.cookie;
  if (typeof header !== "string" || !header.trim()) {
    return [];
  }

  const cookies: ParsedCookie[] = [];
  for (const segment of header.split(";")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const name = segment.slice(0, eq).trim();
    if (!name) continue;
    const value = segment.slice(eq + 1).trim();
    cookies.push({ name, value });
  }
  return cookies;
}

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

function resolveServerSupabase(req: Request, res: Response): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!url || !key) {
    return null;
  }

  const cookieAdapter: CookieMethodsServer = {
    getAll() {
      return parseRequestCookies(req);
    },
    setAll(cookiesToSet) {
      for (const { name, value, options } of cookiesToSet) {
        if (value === "") {
          res.clearCookie(name, { ...baseCookieOptions(), ...(options ?? {}) });
          continue;
        }
        res.cookie(name, value, { ...baseCookieOptions(), ...(options ?? {}) });
      }
    },
  };

  return createServerClient(url, key, { cookies: cookieAdapter });
}

function resolveDashboardOrigin(): string {
  const raw = (process.env.DASHBOARD_ORIGIN ?? "https://app.helloautoflow.com").trim();
  return raw.replace(/\/+$/, "");
}

function notConfigured(res: Response): void {
  res.status(503).json({ error: "Auth service not configured." });
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

router.post(
  "/sign-up",
  asyncHandler(async (req, res) => {
    const client = resolveServerSupabase(req, res);
    if (!client) {
      notConfigured(res);
      return;
    }

    const body = (req.body ?? {}) as { email?: unknown; password?: unknown; name?: unknown };
    if (!isNonEmptyString(body.email) || !isNonEmptyString(body.password)) {
      badRequest(res, "email and password are required.");
      return;
    }

    const dashboardOrigin = resolveDashboardOrigin();
    const fullName = isNonEmptyString(body.name) ? body.name.trim() : undefined;

    const { data, error } = await client.auth.signUp({
      email: body.email.trim(),
      password: body.password,
      options: {
        emailRedirectTo: `${dashboardOrigin}/auth/confirm?next=/`,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });

    if (error) {
      badRequest(res, error.message);
      return;
    }

    res.status(200).json({
      pendingConfirmation: !data.session,
      user: data.user,
    });
  }),
);

router.post(
  "/sign-in",
  asyncHandler(async (req, res) => {
    const client = resolveServerSupabase(req, res);
    if (!client) {
      notConfigured(res);
      return;
    }

    const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
    if (!isNonEmptyString(body.email) || !isNonEmptyString(body.password)) {
      badRequest(res, "email and password are required.");
      return;
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: body.email.trim(),
      password: body.password,
    });

    if (error) {
      badRequest(res, error.message);
      return;
    }

    res.status(200).json({ user: data.user });
  }),
);

router.post(
  "/sign-out",
  asyncHandler(async (req, res) => {
    const client = resolveServerSupabase(req, res);
    if (!client) {
      notConfigured(res);
      return;
    }

    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) {
      badRequest(res, error.message);
      return;
    }

    res.status(204).end();
  }),
);

router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const client = resolveServerSupabase(req, res);
    if (!client) {
      notConfigured(res);
      return;
    }

    const body = (req.body ?? {}) as { email?: unknown };
    if (!isNonEmptyString(body.email)) {
      badRequest(res, "email is required.");
      return;
    }

    const dashboardOrigin = resolveDashboardOrigin();
    const { error } = await client.auth.resetPasswordForEmail(body.email.trim(), {
      redirectTo: `${dashboardOrigin}/reset-password`,
    });

    if (error) {
      badRequest(res, error.message);
      return;
    }

    res.status(202).json({ ok: true });
  }),
);

export default router;
