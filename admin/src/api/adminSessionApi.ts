import { apiRequest, ApiError } from "../lib/apiClient";

export interface AdminSession {
  user_id: string;
  email: string | null;
  is_platform_admin: true;
}

/** Confirms the signed-in user is a platform admin (no AAL2 required). */
export async function fetchAdminSession(): Promise<AdminSession> {
  return apiRequest<AdminSession>("/api/admin-console/session");
}

/** Returns true when the AAL2 attestation cookie is accepted by dev-api. */
export async function probeStepUp(): Promise<boolean> {
  try {
    await apiRequest<{ ok: true }>("/api/admin-console/step-up-probe");
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false;
    throw err;
  }
}
