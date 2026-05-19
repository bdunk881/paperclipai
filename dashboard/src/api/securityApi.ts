import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();
const SECURITY_PATH = "/security";

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

export interface UpdatePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface RevokeSessionResponse {
  currentSessionRevoked: boolean;
}

function authHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return {
    ...extra,
    Authorization: `Bearer ${accessToken}`,
  };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const payload = await res.json().catch(() => null) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function listSecuritySessions(accessToken: string): Promise<SecuritySessionsResponse> {
  const res = await trackedFetch(`${BASE}${SECURITY_PATH}/sessions`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to load active sessions: ${res.status}`));
  }
  return res.json() as Promise<SecuritySessionsResponse>;
}

export async function updatePassword(input: UpdatePasswordInput, accessToken: string): Promise<void> {
  const res = await trackedFetch(`${BASE}${SECURITY_PATH}/password`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to update password: ${res.status}`));
  }
}

export async function revokeSecuritySession(id: string, accessToken: string): Promise<RevokeSessionResponse> {
  const res = await trackedFetch(`${BASE}${SECURITY_PATH}/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to revoke session: ${res.status}`));
  }
  return res.json() as Promise<RevokeSessionResponse>;
}

export async function revokeOtherSecuritySessions(accessToken: string): Promise<void> {
  const res = await trackedFetch(`${BASE}${SECURITY_PATH}/sessions/revoke-others`, {
    method: "POST",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to revoke other sessions: ${res.status}`));
  }
}
