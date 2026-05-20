import type { PoolClient } from "pg";
import { z } from "zod";
import { auditService } from "../auditing/auditService";
import { isPostgresPersistenceEnabled, queryPostgres } from "../db/postgres";

export type SecurityDeviceType = "desktop" | "mobile" | "browser";

export interface SecuritySession {
  id: string;
  device: string;
  deviceType: SecurityDeviceType;
  ip: string;
  location: string;
  lastActive: string;
  createdAt: string | null;
  current: boolean;
}

export interface SecuritySessionCapabilities {
  canListOtherSessions: boolean;
  canRevokeSelectedSessions: boolean;
  canRevokeOtherSessions: boolean;
}

export interface SecuritySessionsResponse {
  sessions: SecuritySession[];
  total: number;
  capabilities: SecuritySessionCapabilities;
}

export interface SecurityContext {
  workspaceId: string;
  userId: string;
  accessToken: string;
  sessionId?: string;
  userAgent?: string;
  ip?: string;
}

export interface UpdatePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface RevokeSessionResult {
  currentSessionRevoked: boolean;
}

export interface SecurityService {
  listSessions(ctx: SecurityContext): Promise<SecuritySessionsResponse>;
  updatePassword(ctx: SecurityContext, input: UpdatePasswordInput): Promise<void>;
  revokeSession(ctx: SecurityContext, sessionId: string): Promise<RevokeSessionResult>;
  revokeOtherSessions(ctx: SecurityContext): Promise<void>;
}

export class SecurityServiceError extends Error {
  constructor(message: string, readonly statusCode = 500, readonly code = "security_error") {
    super(message);
    this.name = "SecurityServiceError";
  }
}

type SupabaseSignOutScope = "local" | "others";

interface SupabaseAuthApi {
  updatePassword(accessToken: string, input: UpdatePasswordInput): Promise<void>;
  signOut(accessToken: string, scope: SupabaseSignOutScope): Promise<void>;
}

const uuidSchema = z.string().uuid();

function firstEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeProjectUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function resolveSupabaseAuthApiConfig(): { authUrl: string; apiKey: string } {
  const projectUrl = normalizeProjectUrl(
    firstEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"),
  );
  const apiKey = firstEnv(
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
  );

  if (!projectUrl || !apiKey) {
    throw new SecurityServiceError("Supabase Auth is not configured for security settings.", 503, "auth_not_configured");
  }

  return { authUrl: `${projectUrl}/auth/v1`, apiKey };
}

async function readAuthError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as
    | { error?: string; error_description?: string; msg?: string; message?: string }
    | null;
  return (
    payload?.error_description ??
    payload?.message ??
    payload?.msg ??
    payload?.error ??
    `Supabase Auth request failed (${response.status})`
  );
}

export class SupabaseAuthRestApi implements SupabaseAuthApi {
  async updatePassword(accessToken: string, input: UpdatePasswordInput): Promise<void> {
    const { authUrl, apiKey } = resolveSupabaseAuthApiConfig();
    const response = await fetch(`${authUrl}/user`, {
      method: "PUT",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password: input.newPassword,
        current_password: input.currentPassword,
      }),
    });

    if (!response.ok) {
      const message = await readAuthError(response);
      if (response.status === 401 || response.status === 403) {
        throw new SecurityServiceError(message || "Reauthentication is required.", 401, "reauth_required");
      }
      throw new SecurityServiceError(message, response.status, "password_update_failed");
    }
  }

  async signOut(accessToken: string, scope: SupabaseSignOutScope): Promise<void> {
    const { authUrl, apiKey } = resolveSupabaseAuthApiConfig();
    const response = await fetch(`${authUrl}/logout?scope=${scope}`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok && response.status !== 401 && response.status !== 403 && response.status !== 404) {
      throw new SecurityServiceError(await readAuthError(response), response.status, "session_revoke_failed");
    }
  }
}

function inferDeviceType(userAgent: string | null): SecurityDeviceType {
  const ua = (userAgent ?? "").toLowerCase();
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  if (/windows|macintosh|linux|cros/.test(ua)) return "desktop";
  return "browser";
}

function describeDevice(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const browser =
    /edg\//i.test(ua) ? "Edge" :
    /chrome\//i.test(ua) ? "Chrome" :
    /firefox\//i.test(ua) ? "Firefox" :
    /safari\//i.test(ua) ? "Safari" :
    "Browser";
  const platform =
    /iphone|ipad/i.test(ua) ? "iOS" :
    /android/i.test(ua) ? "Android" :
    /windows/i.test(ua) ? "Windows" :
    /macintosh|mac os/i.test(ua) ? "macOS" :
    /linux/i.test(ua) ? "Linux" :
    "Unknown device";
  return `${browser} on ${platform}`;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function currentSessionFromRequest(ctx: SecurityContext): SecuritySession | null {
  if (!ctx.sessionId) return null;
  const now = new Date().toISOString();
  const userAgent = ctx.userAgent ?? null;
  return {
    id: ctx.sessionId,
    device: describeDevice(userAgent),
    deviceType: inferDeviceType(userAgent),
    ip: ctx.ip ?? "Unknown IP",
    location: "Unknown location",
    lastActive: now,
    createdAt: null,
    current: true,
  };
}

async function listAuthSessionColumns(): Promise<Set<string>> {
  const result = await queryPostgres<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'auth'
        AND table_name = 'sessions'`,
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function listAuthSessions(ctx: SecurityContext): Promise<SecuritySession[]> {
  const columns = await listAuthSessionColumns();
  if (!columns.has("id") || !columns.has("user_id")) {
    return [];
  }

  const optionalColumns = ["created_at", "updated_at", "refreshed_at", "not_after", "user_agent", "ip"]
    .filter((column) => columns.has(column));
  const selectColumns = ["id", ...optionalColumns];
  const orderExpr = columns.has("refreshed_at")
    ? "refreshed_at"
    : columns.has("updated_at")
      ? "updated_at"
      : columns.has("created_at")
        ? "created_at"
        : "id";

  const result = await queryPostgres<Record<string, unknown>>(
    `SELECT ${selectColumns.map((column) => `"${column}"`).join(", ")}
       FROM auth.sessions
      WHERE user_id::text = $1
      ORDER BY ${orderExpr === "id" ? "id" : `"${orderExpr}" DESC NULLS LAST`}
      LIMIT 50`,
    [ctx.userId],
  );

  return result.rows.map((row) => {
    const userAgent = typeof row.user_agent === "string" ? row.user_agent : null;
    const createdAt = toIso(row.created_at);
    const lastActive = toIso(row.refreshed_at) ?? toIso(row.updated_at) ?? createdAt ?? new Date().toISOString();
    return {
      id: String(row.id),
      device: describeDevice(userAgent),
      deviceType: inferDeviceType(userAgent),
      ip: typeof row.ip === "string" && row.ip ? row.ip : "Unknown IP",
      location: "Unknown location",
      lastActive,
      createdAt,
      current: Boolean(ctx.sessionId && String(row.id) === ctx.sessionId),
    };
  });
}

function sortSessions(sessions: SecuritySession[]): SecuritySession[] {
  return [...sessions].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return Date.parse(b.lastActive) - Date.parse(a.lastActive);
  });
}

async function recordSecurityAudit(
  ctx: SecurityContext,
  action: string,
  target: { type: string; id: string },
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await auditService.recordAction(
      {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        actorUserId: ctx.userId,
      },
      {
        category: "auth",
        action,
        target,
        metadata,
      },
    );
  } catch (error) {
    console.warn("[security] failed to record audit event", {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export class DefaultSecurityService implements SecurityService {
  constructor(private readonly authApi: SupabaseAuthApi = new SupabaseAuthRestApi()) {}

  async listSessions(ctx: SecurityContext): Promise<SecuritySessionsResponse> {
    let sessions: SecuritySession[] = [];
    let canUseAuthSessions = false;

    if (isPostgresPersistenceEnabled()) {
      try {
        sessions = await listAuthSessions(ctx);
        canUseAuthSessions = true;
      } catch (error) {
        console.warn("[security] failed to list auth.sessions", error instanceof Error ? error.message : error);
      }
    }

    const current = currentSessionFromRequest(ctx);
    if (current && !sessions.some((session) => session.id === current.id)) {
      sessions.unshift(current);
    }

    return {
      sessions: sortSessions(sessions),
      total: sessions.length,
      capabilities: {
        canListOtherSessions: canUseAuthSessions,
        canRevokeSelectedSessions: canUseAuthSessions,
        canRevokeOtherSessions: true,
      },
    };
  }

  async updatePassword(ctx: SecurityContext, input: UpdatePasswordInput): Promise<void> {
    await this.authApi.updatePassword(ctx.accessToken, input);
    await recordSecurityAudit(ctx, "security.password.update", { type: "user", id: ctx.userId }, {
      provider: "supabase",
    });
  }

  async revokeSession(ctx: SecurityContext, sessionId: string): Promise<RevokeSessionResult> {
    if (ctx.sessionId && sessionId === ctx.sessionId) {
      await this.authApi.signOut(ctx.accessToken, "local");
      await recordSecurityAudit(ctx, "security.session.revoke_current", { type: "session", id: sessionId }, {
        provider: "supabase",
      });
      return { currentSessionRevoked: true };
    }

    if (!isPostgresPersistenceEnabled()) {
      throw new SecurityServiceError("Targeted session revocation requires Supabase session persistence.", 503, "session_revoke_unavailable");
    }

    if (!uuidSchema.safeParse(sessionId).success) {
      return { currentSessionRevoked: false };
    }

    const result = await queryPostgres<{ id: string }>(
      `DELETE FROM auth.sessions
        WHERE id = $1::uuid
          AND user_id::text = $2
        RETURNING id`,
      [sessionId, ctx.userId],
    );

    if (result.rowCount && result.rowCount > 0) {
      await recordSecurityAudit(ctx, "security.session.revoke", { type: "session", id: sessionId }, {
        provider: "supabase",
      });
    }

    return { currentSessionRevoked: false };
  }

  async revokeOtherSessions(ctx: SecurityContext): Promise<void> {
    await this.authApi.signOut(ctx.accessToken, "others");
    await recordSecurityAudit(ctx, "security.session.revoke_others", { type: "user", id: ctx.userId }, {
      provider: "supabase",
      currentSessionId: ctx.sessionId ?? null,
    });
  }
}

export const securityService = new DefaultSecurityService();
