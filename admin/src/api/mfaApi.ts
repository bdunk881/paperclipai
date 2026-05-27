import { getAccessToken } from "../lib/supabase";
import { emitStepUpRequired } from "../auth/stepUpEvents";

function resolveBaseUrl(): string {
  const explicit = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return "";
}

const BASE = `${resolveBaseUrl()}/api/mfa`;

export interface MfaWebauthnDevice {
  credentialId: string;
  deviceName: string | null;
  transports: string[];
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MfaPolicy {
  hasWebauthn: boolean;
  hasTotp: boolean;
  hasAnyFactor: boolean;
  hasRecoveryCodes: boolean;
  enrollmentCompletedAt: string | null;
  lastVerifiedAt: string | null;
  lastVerifiedMethod: "webauthn" | "totp" | "recovery_code" | null;
  recoveryCodesIssuedAt: string | null;
  webauthnDevices: MfaWebauthnDevice[];
}

export interface RecoveryCodesIssued {
  codes: string[];
  count: number;
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => null)) as
    | { error?: string; code?: string; reason?: string }
    | null;
  if (res.status === 401 && payload?.error === "mfa_step_up_required") {
    emitStepUpRequired({ reason: payload.reason });
  }
  return payload?.error ?? payload?.reason ?? fallback;
}

export async function getMfaPolicy(): Promise<MfaPolicy> {
  const res = await fetch(`${BASE}/policy`, {
    headers: await authHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, `Failed to load MFA policy (${res.status})`));
  return res.json() as Promise<MfaPolicy>;
}

export async function beginWebauthnRegistration(): Promise<unknown> {
  const res = await fetch(`${BASE}/webauthn/register/options`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, "Could not start passkey enrollment"));
  return res.json();
}

export async function finishWebauthnRegistration(
  response: unknown,
  deviceName: string,
): Promise<{ credentialId: string }> {
  const res = await fetch(`${BASE}/webauthn/register/verify`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ response, deviceName }),
  });
  if (!res.ok) throw new Error(await readError(res, "Passkey registration failed"));
  return res.json() as Promise<{ credentialId: string }>;
}

export async function beginWebauthnAuthentication(): Promise<unknown> {
  const res = await fetch(`${BASE}/webauthn/auth/options`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, "Could not start passkey verification"));
  return res.json();
}

export async function finishWebauthnAuthentication(
  response: unknown,
  credentialId: string,
): Promise<{ verified: true; expiresAt: number }> {
  const res = await fetch(`${BASE}/webauthn/auth/verify`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ response, credentialId }),
  });
  if (!res.ok) throw new Error(await readError(res, "Passkey verification failed"));
  return res.json() as Promise<{ verified: true; expiresAt: number }>;
}

export async function removeWebauthnCredential(credentialId: string): Promise<void> {
  const res = await fetch(`${BASE}/webauthn/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
    headers: await authHeaders(),
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Could not remove passkey"));
  }
}

export interface TotpEnrollmentResponse {
  factorId: string;
  qrCodeSvg: string;
  secret: string;
  uri: string;
}

export async function enrollTotp(friendlyName: string): Promise<TotpEnrollmentResponse> {
  const res = await fetch(`${BASE}/totp/enroll`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ friendlyName }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not start TOTP enrollment"));
  return res.json() as Promise<TotpEnrollmentResponse>;
}

export async function verifyTotpEnrollment(factorId: string, code: string): Promise<void> {
  const res = await fetch(`${BASE}/totp/verify`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ factorId, code }),
  });
  if (!res.ok) throw new Error(await readError(res, "TOTP verification failed"));
}

export async function removeTotpFactor(factorId: string): Promise<void> {
  const res = await fetch(`${BASE}/totp/${encodeURIComponent(factorId)}`, {
    method: "DELETE",
    headers: await authHeaders(),
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Could not remove TOTP factor"));
  }
}

export async function regenerateRecoveryCodes(): Promise<RecoveryCodesIssued> {
  const res = await fetch(`${BASE}/recovery-codes/regenerate`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, "Could not generate recovery codes"));
  return res.json() as Promise<RecoveryCodesIssued>;
}

export async function consumeRecoveryCode(
  code: string,
): Promise<{ verified: true; expiresAt: number }> {
  const res = await fetch(`${BASE}/recovery-codes/consume`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(await readError(res, "Recovery code rejected"));
  return res.json() as Promise<{ verified: true; expiresAt: number }>;
}
