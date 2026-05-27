import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";
import { emitStepUpRequired } from "../auth/stepUpEvents";

const BASE = `${getApiBasePath()}/mfa`;

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

function authHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return { ...extra, Authorization: `Bearer ${accessToken}` };
}

async function readError(res: Response, fallback: string): Promise<string> {
  const payload = (await res.json().catch(() => null)) as
    | { error?: string; code?: string; reason?: string }
    | null;
  // Surface backend-mandated step-up so the global modal pops without the
  // caller needing to know about MFA. The thrown error message still
  // carries "mfa_step_up_required" so `isStepUpRequired()` can detect it.
  if (res.status === 401 && payload?.error === "mfa_step_up_required") {
    emitStepUpRequired({ reason: payload.reason });
  }
  return payload?.error ?? payload?.reason ?? fallback;
}

export async function getMfaPolicy(accessToken: string): Promise<MfaPolicy> {
  const res = await trackedFetch(`${BASE}/policy`, {
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, `Failed to load MFA policy (${res.status})`));
  return res.json() as Promise<MfaPolicy>;
}

// ---- WebAuthn registration --------------------------------------------------

export async function beginWebauthnRegistration(accessToken: string): Promise<unknown> {
  const res = await trackedFetch(`${BASE}/webauthn/register/options`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, "Could not start passkey enrollment"));
  return res.json();
}

export async function finishWebauthnRegistration(
  accessToken: string,
  response: unknown,
  deviceName: string,
): Promise<{ credentialId: string }> {
  const res = await trackedFetch(`${BASE}/webauthn/register/verify`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ response, deviceName }),
  });
  if (!res.ok) throw new Error(await readError(res, "Passkey registration failed"));
  return res.json() as Promise<{ credentialId: string }>;
}

// ---- WebAuthn authentication (challenge / step-up) --------------------------

export async function beginWebauthnAuthentication(accessToken: string): Promise<unknown> {
  const res = await trackedFetch(`${BASE}/webauthn/auth/options`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, "Could not start passkey verification"));
  return res.json();
}

export async function finishWebauthnAuthentication(
  accessToken: string,
  response: unknown,
  credentialId: string,
): Promise<{ verified: true; expiresAt: number }> {
  const res = await trackedFetch(`${BASE}/webauthn/auth/verify`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ response, credentialId }),
  });
  if (!res.ok) throw new Error(await readError(res, "Passkey verification failed"));
  return res.json() as Promise<{ verified: true; expiresAt: number }>;
}

export async function removeWebauthnCredential(
  accessToken: string,
  credentialId: string,
): Promise<void> {
  const res = await trackedFetch(`${BASE}/webauthn/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Could not remove passkey"));
  }
}

// ---- TOTP -------------------------------------------------------------------

export interface TotpEnrollmentResponse {
  factorId: string;
  qrCodeSvg: string;
  secret: string;
  uri: string;
}

export async function enrollTotp(
  accessToken: string,
  friendlyName: string,
): Promise<TotpEnrollmentResponse> {
  const res = await trackedFetch(`${BASE}/totp/enroll`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ friendlyName }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not start TOTP enrollment"));
  return res.json() as Promise<TotpEnrollmentResponse>;
}

export async function verifyTotpEnrollment(
  accessToken: string,
  factorId: string,
  code: string,
): Promise<void> {
  const res = await trackedFetch(`${BASE}/totp/verify`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ factorId, code }),
  });
  if (!res.ok) throw new Error(await readError(res, "TOTP verification failed"));
}

export async function removeTotpFactor(accessToken: string, factorId: string): Promise<void> {
  const res = await trackedFetch(`${BASE}/totp/${encodeURIComponent(factorId)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await readError(res, "Could not remove TOTP factor"));
  }
}

// ---- Recovery codes ---------------------------------------------------------

export async function regenerateRecoveryCodes(accessToken: string): Promise<RecoveryCodesIssued> {
  const res = await trackedFetch(`${BASE}/recovery-codes/regenerate`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, "Could not generate recovery codes"));
  return res.json() as Promise<RecoveryCodesIssued>;
}

export async function consumeRecoveryCode(
  accessToken: string,
  code: string,
): Promise<{ verified: true; expiresAt: number }> {
  const res = await trackedFetch(`${BASE}/recovery-codes/consume`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(await readError(res, "Recovery code rejected"));
  return res.json() as Promise<{ verified: true; expiresAt: number }>;
}
